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
    const body = JSON.stringify({model:'claude-sonnet-4-6',max_tokens:3000,messages:[{role:'user',content:prompt}]});
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
// The form sends the actual PDF as base64 (data.authPdfBase64) — we store
// the real PDF binary so it shows as a downloadable PDF in the Files tab.
// Falls back to saving a JSON authorization record if no PDF base64 provided.
async function uploadAuthPdfToBlobs(clientSlug, agencyId, _ignored, data) {
  try {
    const store = getStore('client-files');
    const now   = new Date().toISOString();
    const signerName = data.authSignerName || ((data.firstName||'') + ' ' + (data.lastName||'')).trim();
    const signerBiz  = data.authSignerBusiness || data.businessName || '';
    const signedAt   = data.authTimestamp ? new Date(data.authTimestamp).toLocaleString('en-US',{dateStyle:'full',timeStyle:'short'}) : new Date().toLocaleString('en-US',{dateStyle:'full',timeStyle:'short'});
    const docRef     = data.authDocRef || ('AUTH-'+Date.now().toString(36).toUpperCase());
    const ip         = data.authIP || 'On file';
    const esc = v => String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Authorization Agreement</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;color:#111;background:#fff;font-size:14px;line-height:1.6;padding:48px;max-width:800px;margin:0 auto}
.hdr{border-bottom:3px solid #f97316;padding-bottom:20px;margin-bottom:28px}
.brand{font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#f97316;margin-bottom:6px}
h1{font-size:20px;font-weight:700}
.sub{font-size:12px;color:#666;margin-top:4px}
.sec{margin-bottom:24px}
.sec-title{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#f97316;border-bottom:1px solid #eee;padding-bottom:5px;margin-bottom:12px}
.row{display:flex;gap:8px;margin-bottom:6px}
.lbl{font-size:11px;font-weight:600;color:#888;min-width:150px}
.val{font-size:13px}
ul{list-style:none;padding:0}
li{padding:8px 0 8px 20px;border-bottom:1px solid #f5f5f5;font-size:12.5px;position:relative}
li::before{content:"✓";position:absolute;left:0;color:#f97316;font-weight:700}
.sig{background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-top:12px}
.sig-name{font-size:22px;font-family:Georgia,serif;font-style:italic;margin-bottom:8px}
.sig-line{border-top:1px solid #111;width:280px;margin-bottom:6px}
.sig-meta{font-size:11px;color:#666}
.footer{margin-top:40px;padding-top:12px;border-top:1px solid #eee;font-size:10px;color:#aaa;text-align:center}
@media print{body{padding:24px}}
</style></head><body>
<div class="hdr">
  <div class="brand">Marketing Services Agreement</div>
  <h1>Authorization Agreement</h1>
  <div class="sub">Document Ref: ${esc(docRef)} &nbsp;&bull;&nbsp; ${esc(signedAt)}</div>
</div>
<div class="sec">
  <div class="sec-title">Authorized Party</div>
  <div class="row"><span class="lbl">Full Name</span><span class="val">${esc(signerName)}</span></div>
  <div class="row"><span class="lbl">Business Name</span><span class="val">${esc(signerBiz)}</span></div>
  <div class="row"><span class="lbl">Email</span><span class="val">${esc(data.email||data.clientEmail||'')}</span></div>
  <div class="row"><span class="lbl">Phone</span><span class="val">${esc(data.phone||data.bizPhone||'')}</span></div>
  <div class="row"><span class="lbl">Industry / Service</span><span class="val">${esc(data.industry||'')}${data.primaryService?' &mdash; '+esc(data.primaryService):''}</span></div>
  <div class="row"><span class="lbl">Ad Platforms</span><span class="val">${esc(data.adPlatforms||'')}</span></div>
  <div class="row"><span class="lbl">Monthly Budget</span><span class="val">${data.adBudget?'$'+esc(data.adBudget)+'/day':''}</span></div>
</div>
<div class="sec">
  <div class="sec-title">Terms Agreed To</div>
  <ul>
    <li>Ads created based on information provided in the onboarding survey</li>
    <li>Authorization granted to manage advertising campaigns on chosen platforms with full consent</li>
    <li>Client maintains owner access to all accounts; agency acts as admin only</li>
    <li>Campaign performance depends on multiple factors outside agency control</li>
    <li>All ad spend paid directly to ad platforms; agency bears no liability for these fees</li>
    <li>Agency not responsible for any outcomes or costs related to advertising campaigns</li>
    <li>Privacy Policy and Terms &amp; Conditions read and agreed to</li>
  </ul>
</div>
<div class="sec">
  <div class="sec-title">Electronic Signature</div>
  <div class="sig">
    <div class="sig-name">${esc(signerName)}</div>
    <div class="sig-line"></div>
    <div class="sig-meta">
      Signed by <strong>${esc(signerName)}</strong> on behalf of <strong>${esc(signerBiz)}</strong><br>
      Date: ${esc(signedAt)} &nbsp;&bull;&nbsp; IP: ${esc(ip)} &nbsp;&bull;&nbsp; Ref: ${esc(docRef)}
    </div>
  </div>
</div>
<div class="footer">Electronically signed &amp; legally binding &nbsp;&bull;&nbsp; Ref: ${esc(docRef)} &nbsp;&bull;&nbsp; ${esc(signedAt)}</div>
</body></html>`;

    const key = `${clientSlug}/Authorization_Agreement.html`;
    await store.set(key, html, {
      metadata: {
        originalName: 'Authorization_Agreement.html',
        displayName:  'Authorization Agreement',
        fileType:     'text/html; charset=utf-8',
        fileSize:     String(Buffer.byteLength(html, 'utf8')),
        uploadedAt:   now,
        slug:         clientSlug,
        protected:    'true',
        systemFile:   'true',
        docType:      'authorization',
        signerName, signerBiz,
        signedAt:     data.authTimestamp || now,
        docRef,
      }
    });
    console.log('[plan] Auth HTML doc saved:', key);
    return key;
  } catch(e) {
    console.error('[plan] Auth doc failed:', e.message);
    return null;
  }
}

// ─── RICH PROMPT USING ALL FORM FIELDS ────────────────────────────────────────
function buildPrompt(d) {
  const n = v => v||'N/A';
  return `You are a marketing strategist. Generate a marketing plan for ${n(d.businessName)}.
Output ONLY raw JSON starting with { — no markdown, no explanation.

Business: ${n(d.businessName)} | Industry: ${n(d.industry)} | Service: ${n(d.primaryService)}
Goal: ${n(d.mainGoal)} | Budget: $${n(d.adBudget)}/day | Platforms: ${n(d.adPlatforms)}
Area: ${n(d.serviceDetails)} | Ideal Customer: ${n(d.idealCustomer)} | Ages: ${n(d.ageGroups)}
Stand Out: ${n(d.standOut)} | Promo: ${n(d.promotions)} | Avg Value: $${n(d.avgCustomerValue)}
Qual Lead: ${n(d.qualifiedLead)} | Bad Lead: ${n(d.badLead)}
Qual Qs: ${n(d.qualifyingQuestions)} | 90-Day Goal: ${n(d.goal90Days||d.goal90)}
Worked: ${n(d.workedWell)} | Didn't Work: ${n(d.notWorked)}

JSON format:
{"tagline":"one sentence","avatar":{"name":"persona","whoTheyAre":"2 sentences","painPoints":"2 sentences","desires":"2 sentences","qualifiers":["q1","q2","q3"],"disqualifiers":["d1","d2"]},"funnelSteps":[{"step":"Awareness","icon":"📡","desc":"1 sentence"},{"step":"Interest","icon":"🎯","desc":"1 sentence"},{"step":"Lead Capture","icon":"📋","desc":"1 sentence"},{"step":"Qualification","icon":"✅","desc":"1 sentence"},{"step":"Conversion","icon":"🤝","desc":"1 sentence"}],"adAngles":[{"angleLabel":"Pain","angle":"strategy","ads":[{"title":"A","headline":"headline","primaryText":"3 sentences","description":"1 line","cta":"CTA"},{"title":"B","headline":"headline","primaryText":"3 sentences","description":"1 line","cta":"CTA"}]},{"angleLabel":"Offer","angle":"strategy","ads":[{"title":"A","headline":"headline","primaryText":"3 sentences","description":"1 line","cta":"CTA"}]},{"angleLabel":"Proof","angle":"strategy","ads":[{"title":"A","headline":"headline","primaryText":"3 sentences","description":"1 line","cta":"CTA"}]},{"angleLabel":"Retargeting","angle":"warm audience","ads":[{"title":"Warm","headline":"headline","primaryText":"3 sentences","description":"1 line","cta":"CTA"}]}],"targeting":{"demographics":["d1","d2"],"interests":["i1","i2","i3"],"behaviors":["b1","b2"],"geographic":["${n(d.serviceDetails).slice(0,60)}"],"custom":["Website visitors"],"lookalike":["1% lookalike"]},"roadmap":[{"phase":"Week 1","title":"Foundation","desc":"actions"},{"phase":"Week 2","title":"Launch","desc":"actions"},{"phase":"Weeks 3-4","title":"Optimize","desc":"actions"},{"phase":"Weeks 5-8","title":"Scale","desc":"actions"},{"phase":"Weeks 9-12","title":"Results","desc":"hit goal"}],"qualificationScript":{"opening":"opening script","questions":[{"q":"q1","why":"why"},{"q":"q2","why":"why"},{"q":"q3","why":"why"}],"transition":"transition","objections":[{"obj":"objection","response":"response"},{"obj":"price","response":"ROI response"}]},"positioning":[{"tip":"tip1","desc":"2 sentences"},{"tip":"tip2","desc":"2 sentences"},{"tip":"tip3","desc":"2 sentences"}],"kpis":{"cpl":"CPL range","ctr":"CTR range","conversionRate":"rate","expectedLeadsPerMonth":"number","projectedROI":"ROI"}}`;
}


async function generateAndSavePlan(data, agencyId, slug, planUrl, portalUrl, agency) {
  try {
    // STEP A: Call Claude
    console.log('[plan] STEP A: Calling Claude for:', data.businessName, '| slug:', slug);
    let raw;
    try {
      raw = await callClaude(buildPrompt(data));
      console.log('[plan] STEP A OK: Claude responded', raw.length, 'chars');
    } catch(e) {
      console.error('[plan] STEP A FAILED: Claude error:', e.message);
      return;
    }

    // STEP B: Parse JSON
    let json = {};
    try {
      json = JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim());
      console.log('[plan] STEP B OK: JSON parsed, keys:', Object.keys(json).join(','));
    } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if(m) { try { json = JSON.parse(m[0]); console.log('[plan] STEP B OK (regex)'); } catch(e2) { console.error('[plan] STEP B WARN: parse failed, saving empty JSON'); } }
      else { console.error('[plan] STEP B WARN: no JSON found in response, saving empty'); }
    }

    // STEP C: Save full client data + plan JSON to Firestore
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
      goal90:           data.goal90Days||'',
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
    console.log('[plan] STEP C OK: Firestore save complete for:', slug);

    // ── Save authorization PDF (non-blocking) ─────────────────────────────────
    if (data.authPdfBase64 || (data.authSignature && data.authSignature.length > 100)) {
      uploadAuthPdfToBlobs(slug, agencyId, data.authSignature || '', data)
        .catch(e => console.error('[plan] PDF blob save failed:', e.message));
    }

    // Send email (non-blocking — never hangs the function)
    try {
      const { createTransport } = await import('nodemailer');
      const t = createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
      const brand = agency.brandName||agency.name||'Your Marketing Agency';
      const color = agency.brandColor||'#f97316';
      const emailPromise = t.sendMail({
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
      // 10s timeout on email — never hang waiting for SMTP
      await Promise.race([emailPromise, new Promise((_,r)=>setTimeout(()=>r(new Error('email timeout')),10000))]);
      console.log('[plan] STEP D OK: email sent to', data.email);
    } catch(e) { console.error('[plan] STEP D email failed (non-fatal):', e.message); }

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

  // Auth doc generated server-side in generateAndSavePlan — no upload sub-route needed

  const {agencyId} = data;
  if (!agencyId) return new Response(JSON.stringify({error:'agencyId required'}),{status:400,headers:CORS});

  // Required minimum fields
  // Only hard-require the minimum needed to create a client record
  // industry/primaryService use fallbacks so converted leads always work
  const required = ['firstName','email','businessName'];
  for(const f of required) {
    if(!data[f]) return new Response(JSON.stringify({error:`${f} is required`}),{status:400,headers:CORS});
  }
  // Apply fallbacks for optional but useful fields
  if(!data.lastName)       data.lastName       = '';
  if(!data.industry)       data.industry       = data.primaryService || 'General Business';
  if(!data.primaryService) data.primaryService = data.industry       || 'Marketing Services';
  if(!data.adBudget)       data.adBudget       = '1000';
  if(!data.adPlatforms)    data.adPlatforms    = 'Facebook, Instagram';
  if(!data.goal90Days)     data.goal90Days     = 'Generate leads and grow revenue';

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
      goal90Days: data.goal90Days||'',
      status: 'new', createdAt: now,
      dashboardUrl: planUrl, dashboardJSON: '{}', notes: '',
      leadSource: data.source||'agency-onboarding',
    });
    console.log('[process-plan] Initial client record saved:', slug);

    // ── Save auth PDF immediately (sync, fast — just a blob write) ─────────────
    if (data.authPdfBase64 || (data.authSignature && data.authSignature.length > 100)) {
      uploadAuthPdfToBlobs(slug, agencyId, data.authSignature||'', data)
        .catch(e => console.error('[process-plan] PDF save failed:', e.message));
    }

    // ── Generate plan synchronously — Claude responds in ~14s, well within 26s limit ─
    // Debug confirmed: Claude=14s + Firestore=0.5s = ~15s total. Fits in window.
    // We already returned the response above, so this runs after client gets success.
    if (context?.waitUntil) {
      context.waitUntil(generateAndSavePlan(data, agencyId, slug, planUrl, portalUrl, agency));
      console.log('[process-plan] waitUntil scheduled for:', slug);
    } else {
      generateAndSavePlan(data, agencyId, slug, planUrl, portalUrl, agency).catch(e =>
        console.error('[process-plan] generateAndSavePlan error:', e.message)
      );
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
