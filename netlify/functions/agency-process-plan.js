// netlify/functions/agency-process-plan.js
// Uses context.waitUntil() to run Claude AFTER returning the response to browser
import https from 'https';
import crypto from 'crypto';
import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function getToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
    const b64   = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now   = Math.floor(Date.now()/1000);
    const hdr   = b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const pay   = b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const sig   = b64(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(key));
    const body  = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`;
    const req   = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('Firebase token failed'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function toFS(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean')    return {booleanValue:v};
  if (typeof v==='number')     return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if (typeof v==='string')     return {stringValue:v};
  if (Array.isArray(v))        return {arrayValue:{values:v.map(toFS)}};
  if (typeof v==='object')     return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,val])=>[k,toFS(val)]))}};
  return {stringValue:String(v)};
}

function fsHttp(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s = body?JSON.stringify(body):null;
    const r = https.request({hostname:'firestore.googleapis.com',path,method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); if(s)r.write(s); r.end();
  });
}

async function fsGet(path) {
  const t = await getToken();
  const r = await fsHttp('GET',`${BASE()}/${path}`,null,t);
  if (!r.fields) return null;
  const o={};
  for(const[k,v]of Object.entries(r.fields)){
    if('stringValue' in v) o[k]=v.stringValue;
    else if('integerValue' in v) o[k]=Number(v.integerValue);
    else if('booleanValue' in v) o[k]=v.booleanValue;
    else o[k]=null;
  }
  return o;
}

async function fsSet(path, data) {
  const t = await getToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsHttp('PATCH',`${BASE()}/${path}`,{fields},t);
}

function callClaude(prompt) {
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify({model:'claude-sonnet-4-6',max_tokens:8000,messages:[{role:'user',content:prompt}]});
    const r = https.request({
      hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const j=JSON.parse(d);
          if(j.error) { reject(new Error(j.error.message||JSON.stringify(j.error))); return; }
          const text=j.content?.[0]?.text||'';
          if(!text) { reject(new Error('Empty Claude response: '+d.slice(0,200))); return; }
          resolve(text);
        } catch(e){reject(e)}
      });
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

// ─── UPLOAD AUTH PDF TO NETLIFY BLOBS (protected, download-only) ─────────────
async function uploadAuthPdfToBlobs(clientSlug, agencyId, authSignature, data) {
  try {
    if (!authSignature) return null;
    // authSignature is a base64 PNG of the drawn signature from canvas
    // We store it + a JSON record as the "authorization document" in Blobs
    const store = getStore('client-files');

    // Build a compact authorization record as JSON (no jsPDF on server)
    const authRecord = {
      type:               'authorization',
      documentRef:        data.authDocRef || '',
      signerName:         data.authSignerName || (data.firstName + ' ' + data.lastName).trim(),
      signerBusiness:     data.authSignerBusiness || data.businessName || '',
      signedAt:           data.authTimestamp || new Date().toISOString(),
      ipAddress:          data.authIP || '',
      userAgent:          data.authUserAgent || '',
      agreedTerms:        true,
      signatureImageB64:  authSignature,   // base64 PNG of drawn sig
      agencyId,
      clientSlug,
    };

    const key = `${clientSlug}/authorization-agreement-${Date.now()}.json`;
    await store.set(key, JSON.stringify(authRecord), {
      metadata: {
        originalName: 'Authorization_Agreement.pdf',
        displayName:  'Authorization Agreement',
        fileType:     'application/json',
        fileSize:     String(Buffer.byteLength(JSON.stringify(authRecord))),
        uploadedAt:   new Date().toISOString(),
        slug:         clientSlug,
        protected:    'true',        // ← download-only, no delete in UI
        systemFile:   'true',        // ← auto-generated by system
        docType:      'authorization',
      }
    });

    console.log('[plan] Auth PDF saved to Blobs:', key);
    return key;
  } catch(e) {
    console.error('[plan] Auth PDF upload failed:', e.message);
    return null;
  }
}

// ─── RICH PROMPT USING ALL FORM FIELDS ────────────────────────────────────────
function buildPrompt(d) {
  const n = v => v || 'N/A';
  return `You are an elite digital marketing strategist building a personalized Marketing Command Center for a new agency client. Use ALL the client data below to generate deeply customized, specific content — not generic templates.

CRITICAL: Output ONLY valid JSON. No markdown fences, no explanation, no preamble. Start with { and end with }.

━━━ CLIENT DATA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CONTACT & BUSINESS:
• Name: ${n(d.firstName)} ${n(d.lastName)}
• Business: ${n(d.businessName)}
• Industry: ${n(d.industry)}
• Company Size: ${n(d.companySize)}
• Website: ${n(d.website)}
• Primary Service to Promote: ${n(d.primaryService)}
• Business Description: ${n(d.bizDescription)}

OFFER & POSITIONING:
• Main Advertising Goal: ${n(d.mainGoal)}
• Average Customer/Job Value: $${n(d.avgCustomerValue)}
• What Makes Them Stand Out: ${n(d.standOut)}
• Current Promotions/Specials: ${n(d.promotions)}

TARGET AUDIENCE:
• Ideal Customer: ${n(d.idealCustomer)}
• Age Groups: ${n(d.ageGroups)}
• Gender Preference: ${n(d.genderPref) || 'No preference'}
• Language: ${n(d.language)}
• Common Interests/Behaviors: ${n(d.interests)}

SERVICE AREA:
• Area Type: ${n(d.serviceAreaType)}
• Specific Area: ${n(d.serviceDetails)}

LEAD QUALIFICATION:
• Highly Qualified Lead Looks Like: ${n(d.qualifiedLead)}
• Bad Fit / Disqualifications: ${n(d.badLead)}
• Top 3 Qualifying Questions: ${n(d.qualifyingQuestions)}
• Top 3 Disqualifying Questions: ${n(d.disqualifyingQuestions)}

LEAD HANDOFF:
• Where Leads Are Sent: ${n(d.leadDestination)}
• Response Time: ${n(d.responseTime)}
• Dedicated Follow-Up Person: ${n(d.dedicatedPerson)}

MARKETING HISTORY:
• Paid Ads Before: ${n(d.paidAdsBefore)}
• Platforms Used: ${n(d.platformsUsedBefore)}
• What Worked: ${n(d.workedWell)}
• What Didn't Work: ${n(d.notWorked)}

90-DAY GOALS:
• Main 90-Day Goal: ${n(d.goal90Days)}
• Limitations/Avoid: ${n(d.limitations)}
• Priorities: ${n(d.priorities)}
• Custom Lead Q1: ${n(d.customQ1)}
• Custom Lead Q2: ${n(d.customQ2)}
• Custom Lead Q3: ${n(d.customQ3)}

AD BUDGET & PLATFORMS:
• Daily Budget: ${n(d.adBudget)}
• Open to Scaling: ${n(d.budgetIncrease)}
• Platforms to Run: ${n(d.adPlatforms)}

━━━ OUTPUT JSON SCHEMA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate this exact JSON structure with deeply personalized content for ${n(d.businessName)}:

{
  "tagline": "One punchy sentence describing what ${n(d.businessName)} does and who they help",

  "avatar": {
    "name": "A made-up persona name for their ideal customer (e.g. 'Stressed Steve the Homeowner')",
    "whoTheyAre": "2-3 sentences about the ideal customer using the info provided — be specific to their industry/service area",
    "painPoints": "2-3 sentences about the specific pain points this business solves",
    "desires": "2-3 sentences about what the ideal customer truly wants",
    "qualifiers": ["qualifier based on their input 1", "qualifier 2", "qualifier 3", "qualifier 4"],
    "disqualifiers": ["disqualifier based on their input 1", "disqualifier 2", "disqualifier 3"]
  },

  "funnelSteps": [
    {"step": "Awareness", "icon": "📡", "desc": "One sentence specific to their platform and audience"},
    {"step": "Interest", "icon": "🎯", "desc": "One sentence about hook/angle for this specific service"},
    {"step": "Lead Capture", "icon": "📋", "desc": "One sentence about their specific lead form/landing approach"},
    {"step": "Qualification", "icon": "✅", "desc": "One sentence using their actual qualifying questions"},
    {"step": "Conversion", "icon": "🤝", "desc": "One sentence about their close/handoff process"}
  ],

  "adAngles": [
    {
      "angleLabel": "Empathy / Pain",
      "angle": "One sentence describing this angle strategy",
      "ads": [
        {"title": "Version A", "headline": "Specific headline for ${n(d.businessName)}", "primaryText": "3-4 sentence ad copy addressing pain points, using their specific offer/promo", "description": "One line benefit", "cta": "Strong CTA"},
        {"title": "Version B", "headline": "Alternative headline", "primaryText": "3-4 sentence variation", "description": "One line", "cta": "CTA"}
      ]
    },
    {
      "angleLabel": "Offer / Value",
      "angle": "One sentence about leading with their specific offer: ${n(d.promotions)}",
      "ads": [
        {"title": "Version A", "headline": "Offer-focused headline", "primaryText": "3-4 sentences leading with their promotion/special offer", "description": "One line", "cta": "CTA"},
        {"title": "Version B", "headline": "Value headline", "primaryText": "3-4 sentence variation", "description": "One line", "cta": "CTA"}
      ]
    },
    {
      "angleLabel": "Proof / Results",
      "angle": "One sentence about social proof angle for their industry",
      "ads": [
        {"title": "Version A", "headline": "Results-focused headline", "primaryText": "3-4 sentences with implied proof and results relevant to their service", "description": "One line", "cta": "CTA"}
      ]
    },
    {
      "angleLabel": "Curiosity / Hook",
      "angle": "One sentence about pattern-interrupt hook",
      "ads": [
        {"title": "Version A", "headline": "Pattern-interrupt headline", "primaryText": "3-4 sentences opening with curiosity, relevant to their industry", "description": "One line", "cta": "CTA"}
      ]
    },
    {
      "angleLabel": "Retargeting",
      "angle": "Warm audience who already engaged — higher-intent message",
      "ads": [
        {"title": "Warm Lead", "headline": "Follow-up headline for warm audience", "primaryText": "3-4 sentences for people who already showed interest — address hesitation, reinforce value", "description": "One line", "cta": "CTA"}
      ]
    }
  ],

  "targeting": {
    "demographics": ["Specific demographic 1 based on their audience data", "demographic 2", "demographic 3"],
    "interests": ["Specific interest 1 from their form data", "interest 2", "interest 3", "interest 4", "interest 5"],
    "behaviors": ["Behavior 1 relevant to their service", "behavior 2", "behavior 3"],
    "geographic": ["Geographic targeting based on their service area: ${n(d.serviceAreaType)} — ${n(d.serviceDetails)}"],
    "custom": ["Website visitors (retargeting)", "Engaged with page", "Custom audience suggestion specific to their business"],
    "lookalike": ["1% lookalike of customer list", "2-3% lookalike for broader reach"]
  },

  "roadmap": [
    {"phase": "Week 1", "title": "Foundation & Setup", "desc": "2 sentences of specific actions based on their platforms (${n(d.adPlatforms)}) and goals"},
    {"phase": "Week 2", "title": "Launch & Test", "desc": "2 sentences about launching the first campaigns with their budget ($${n(d.adBudget)})"},
    {"phase": "Weeks 3-4", "title": "Data & Optimization", "desc": "2 sentences about analyzing data, killing losers, scaling winners"},
    {"phase": "Weeks 5-6", "title": "Audience Expansion", "desc": "2 sentences about broadening audiences and adding ad angles"},
    {"phase": "Weeks 7-8", "title": "Scale What Works", "desc": "2 sentences about scaling winning campaigns and budgets"},
    {"phase": "Weeks 9-12", "title": "90-Day Milestone: ${n(d.goal90Days).slice(0,40)}", "desc": "2 sentences about hitting their specific 90-day goal"}
  ],

  "qualificationScript": {
    "opening": "2-3 sentence opening script specific to ${n(d.businessName)} — use their industry and service in the opening",
    "questions": [
      {"q": "${n(d.customQ1) || 'First qualifying question based on their input: ' + n(d.qualifyingQuestions)}", "why": "Why this question matters for their specific business"},
      {"q": "Second qualifying question based on their inputs", "why": "Why this question matters"},
      {"q": "Third qualifying question", "why": "Why this question matters"},
      {"q": "Budget/timeline qualifier specific to their service", "why": "Qualifies readiness"},
      {"q": "Decision maker confirmation", "why": "Avoids wasting time on non-decision makers"}
    ],
    "transition": "2 sentence transition to the close/next steps specific to their process (${n(d.leadDestination)})",
    "objections": [
      {"obj": "Most common objection for their industry", "response": "Specific rebuttal using their standout factor: ${n(d.standOut).slice(0,80)}"},
      {"obj": "Price objection", "response": "Response using their avg job value ($${n(d.avgCustomerValue)}) and ROI framing"},
      {"obj": "Need to think about it", "response": "Urgency-based response using their specific offer/promo"}
    ]
  },

  "positioning": [
    {"tip": "Lead With Your Unique Edge", "desc": "2 sentences about how to position their specific differentiator: ${n(d.standOut).slice(0,100)}"},
    {"tip": "Own Your Service Area", "desc": "2 sentences about dominating their specific geographic market: ${n(d.serviceDetails).slice(0,80)}"},
    {"tip": "Leverage What Already Works", "desc": "2 sentences building on their past marketing wins: ${n(d.workedWell).slice(0,80)}"},
    {"tip": "Promote Your Best Offer Front and Center", "desc": "2 sentences about leading with: ${n(d.promotions).slice(0,100)}"},
    {"tip": "Speed is Your Competitive Advantage", "desc": "2 sentences about their ${n(d.responseTime)} response time as a differentiator vs competitors who are slow"}
  ],

  "kpis": {
    "cpl": "Estimated cost per lead range for ${n(d.industry)} on ${n(d.adPlatforms)} at $${n(d.adBudget)}/day",
    "ctr": "Expected CTR range for this industry",
    "conversionRate": "Expected lead form conversion rate",
    "expectedLeadsPerMonth": "Estimated monthly leads at this budget",
    "projectedROI": "ROI projection based on $${n(d.avgCustomerValue)} avg job value"
  }
}

Remember: Every field must be SPECIFIC to ${n(d.businessName)} — their industry, their service area, their promotions, their audience. Never use generic placeholder text.`;
}

// ─── SAVE ALL FORM DATA + GENERATE HTML PLAN ─────────────────────────────────
async function generateAndSavePlan(data, agencyId, slug, planUrl, portalUrl, agency) {
  try {
    console.log('[plan] Calling Claude for:', data.businessName);
    const raw = await callClaude(buildPrompt(data));
    console.log('[plan] Claude responded:', raw.length, 'chars');

    let json = {};
    try {
      json = JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim());
    } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if(m) try { json = JSON.parse(m[0]); } catch(e2) { console.error('[plan] JSON parse failed:', e2.message); }
    }
    console.log('[plan] Parsed keys:', Object.keys(json).join(','));

    // Save full client data + plan JSON to Firestore
    await fsSet(`agencies/${agencyId}/clients/${slug}`, {
      agencyId,
      clientId: slug,
      // Contact
      firstName:        data.firstName||'',
      lastName:         data.lastName||'',
      clientName:       `${data.firstName||''} ${data.lastName||''}`.trim(),
      clientEmail:      data.email||'',
      phone:            data.phone||'',
      bizPhone:         data.bizPhone||'',
      smsConsent:       data.smsConsent||'',
      // Mailing
      mailingAddr1:     data.mailingAddr1||'',
      mailingAddr2:     data.mailingAddr2||'',
      mailingCity:      data.mailingCity||'',
      mailingState:     data.mailingState||'',
      mailingZip:       data.mailingZip||'',
      // Business
      businessName:     data.businessName||'',
      website:          data.website||'',
      companySize:      data.companySize||'',
      industry:         data.industry||'',
      primaryService:   data.primaryService||'',
      bizDescription:   data.bizDescription||'',
      // Offer
      mainGoal:         data.mainGoal||'',
      avgCustomerValue: data.avgCustomerValue||'',
      standOut:         data.standOut||'',
      promotions:       data.promotions||'',
      // Audience
      idealCustomer:    data.idealCustomer||'',
      ageGroups:        data.ageGroups||'',
      genderPref:       data.genderPref||'',
      language:         data.language||'',
      interests:        data.interests||'',
      // Service area
      serviceAreaType:  data.serviceAreaType||'',
      serviceDetails:   data.serviceDetails||'',
      // Lead qual
      qualifiedLead:    data.qualifiedLead||'',
      badLead:          data.badLead||'',
      qualifyingQuestions:    data.qualifyingQuestions||'',
      disqualifyingQuestions: data.disqualifyingQuestions||'',
      // Lead handoff
      leadDestination:  data.leadDestination||'',
      leadEmail:        data.leadEmail||'',
      leadPhone:        data.leadPhone||'',
      responseTime:     data.responseTime||'',
      dedicatedPerson:  data.dedicatedPerson||'',
      // Past marketing
      paidAdsBefore:    data.paidAdsBefore||'',
      platformsUsedBefore: data.platformsUsedBefore||'',
      workedWell:       data.workedWell||'',
      notWorked:        data.notWorked||'',
      // Goals
      goal90Days:       data.goal90Days||'',
      limitations:      data.limitations||'',
      priorities:       data.priorities||'',
      customQ1:         data.customQ1||'',
      customQ2:         data.customQ2||'',
      customQ3:         data.customQ3||'',
      // Budget
      adBudget:         data.adBudget||'',
      budgetIncrease:   data.budgetIncrease||'',
      openToUpgrade:    data.openToUpgrade||'',
      // Platforms & access
      adPlatforms:      data.adPlatforms||'',
      accessMethod:     data.accessMethod||'',
      // Referral
      referralBonus:    data.referralBonus||'',
      referralContact:  data.referralContact||'',
      finalNotes:       data.finalNotes||'',
      referralFriendName:  data.referralFriendName||'',
      referralFriendEmail: data.referralFriendEmail||'',
      referralFriendPhone: data.referralFriendPhone||'',
      // Authorization
      authorizationAgreed:  data.authorizationAgreed||'',
      authSignerName:       data.authSignerName||'',
      authSignerBusiness:   data.authSignerBusiness||'',
      authTimestamp:        data.authTimestamp||'',
      authIP:               data.authIP||'',
      authUserAgent:        data.authUserAgent||'',
      authDocRef:           data.authDocRef||'',
      // Plan
      status:           'active',
      createdAt:        data._createdAt||new Date().toISOString(),
      generatedAt:      new Date().toISOString(),
      dashboardUrl:     planUrl,
      dashboardJSON:    JSON.stringify(json),
      notes:            '',
      tags:             data.tags||'',
      leadSource:       data.source||'agency-onboarding',
    });
    console.log('[plan] Full data saved to Firestore:', slug);

    // ── Save authorization PDF to Blobs (protected, download-only) ───────────
    if (data.authSignature && data.authSignature.length > 100) {
      await uploadAuthPdfToBlobs(slug, agencyId, data.authSignature, data);
    }

    // Send email with plan link
    try {
      const { createTransport } = await import('nodemailer');
      const t = createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
      const brand = agency.brandName||agency.name||'Your Marketing Agency';
      const color = agency.brandColor||'#f97316';
      await t.sendMail({
        from:`"${brand}" <${process.env.GMAIL_USER}>`,
        to: data.email,
        subject: `Your Marketing Command Center is Ready, ${data.firstName}!`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0a0a0f;color:#eeeef2">
          <div style="background:linear-gradient(135deg,${color},${color}cc);padding:24px;border-radius:12px;margin-bottom:24px">
            <h2 style="margin:0;color:#fff;font-size:22px">${brand}</h2>
          </div>
          <p style="font-size:16px">Hi ${data.firstName},</p>
          <p>Your personalized Marketing Command Center for <strong>${data.businessName}</strong> is ready!</p>
          <p style="color:#888">It includes your custom ad copy, targeting strategy, 90-day roadmap, and qualification script — all built specifically for your business.</p>
          <a href="${planUrl}" style="background:${color};color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin:20px 0;font-size:15px">🚀 View My Marketing Plan</a>
          <p style="font-size:13px;color:#666;margin-top:24px">Questions? Reply to this email or visit your portal: <a href="${portalUrl}" style="color:${color}">${portalUrl}</a></p>
        </div>`,
      });
      console.log('[plan] Email sent to', data.email);
    } catch(e) { console.error('[plan] Email failed:', e.message); }

  } catch(err) {
    console.error('[plan] Generation failed:', err.message, err.stack);
  }
}

export default async (req, context) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});
  if (req.method!=='POST')    return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  let data;
  try { data=await req.json(); }
  catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  const {agencyId} = data;
  if (!agencyId) return new Response(JSON.stringify({error:'agencyId required'}),{status:400,headers:CORS});

  // Required minimum fields
  const required = ['firstName','lastName','email','businessName','industry','primaryService'];
  for(const f of required) {
    if(!data[f]) return new Response(JSON.stringify({error:`${f} is required`}),{status:400,headers:CORS});
  }

  try {
    const agency = await fsGet(`agencies/${agencyId}`);
    if (!agency) return new Response(JSON.stringify({error:'Agency not found'}),{status:404,headers:CORS});

    const slug      = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-'+Date.now().toString(36);
    const baseUrl   = agency.siteUrl || 'https://marketingplan.astroaibots.com';
    const planUrl   = `${baseUrl}/plans/${agencyId}/${slug}`;
    const portalUrl = `${baseUrl}/onboard/portal?a=${agencyId}&s=${slug}`;
    const now       = new Date().toISOString();
    data._createdAt = now;

    // Save initial client record immediately
    await fsSet(`agencies/${agencyId}/clients/${slug}`, {
      agencyId, clientId: slug,
      firstName: data.firstName, lastName: data.lastName,
      clientName: `${data.firstName} ${data.lastName}`.trim(),
      clientEmail: data.email, businessName: data.businessName,
      phone: data.phone||'', industry: data.industry,
      primaryService: data.primaryService,
      adBudget: data.adBudget||'', adPlatforms: data.adPlatforms||'',
      serviceAreaType: data.serviceAreaType||'', serviceDetails: data.serviceDetails||'',
      website: data.website||'', companySize: data.companySize||'',
      goal90: data.goal90Days||'',
      status: 'new', createdAt: now,
      dashboardUrl: planUrl, dashboardJSON: '{}', notes: '',
      leadSource: data.source||'agency-onboarding',
    });
    console.log('[process-plan] Initial client record saved:', slug);

    // Run Claude + full save in background after response
    if (context?.waitUntil) {
      context.waitUntil(generateAndSavePlan(data, agencyId, slug, planUrl, portalUrl, agency));
      console.log('[process-plan] waitUntil scheduled for:', slug);
    } else {
      generateAndSavePlan(data, agencyId, slug, planUrl, portalUrl, agency).catch(console.error);
    }

    return new Response(JSON.stringify({success:true, clientId:slug, planUrl, portalUrl}), {
      status: 200,
      headers: { ...CORS, 'Connection': 'close' }
    });

  } catch(err) {
    console.error('[process-plan] ERROR:', err.message);
    return new Response(JSON.stringify({error:err.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/agency/process-plan' };
