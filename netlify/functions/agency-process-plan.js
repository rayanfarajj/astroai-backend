// netlify/functions/agency-process-plan.js
// Handles onboarding form submission:
// 1. Saves client to Firestore immediately
// 2. Calls Claude synchronously (within 26s timeout)  
// 3. Saves dashboardJSON + dashboardUrl to Firestore
// 4. Returns planUrl to browser
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── FIREBASE ──────────────────────────────────────────────────
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
  o.id=(r.name||'').split('/').pop();
  return o;
}

async function fsSet(path, data) {
  const t = await getToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsHttp('PATCH',`${BASE()}/${path}`,{fields},t);
}

// ── CLAUDE ────────────────────────────────────────────────────
function callClaude(prompt) {
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify({
      model:'claude-sonnet-4-6',  // faster than opus, still high quality
      max_tokens:4000,
      messages:[{role:'user',content:prompt}]
    });
    const r = https.request({
      hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const j=JSON.parse(d);
          if(j.error) reject(new Error(j.error.message||JSON.stringify(j.error)));
          else resolve(j.content?.[0]?.text||'');
        } catch(e){reject(e)}
      });
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

function buildPrompt(d) {
  return `You are an expert digital marketing strategist. Generate a comprehensive AI marketing plan for the business below. Return ONLY valid JSON with no markdown, no backticks, no explanation.

Business: ${d.businessName}
Industry: ${d.industry}
Service: ${d.primaryService}
Monthly Ad Budget: $${d.adBudget}
Platforms: ${d.adPlatforms}
90-Day Goal: ${d.goal90Days}

Return exactly this JSON structure:
{"executiveSummary":"2-3 sentence overview","adAngles":[{"angleLabel":"Empathy","ads":[{"title":"Version A","headline":"Short headline under 40 chars","primaryText":"3-4 sentence ad copy","description":"One line description","cta":"Call to action"}]},{"angleLabel":"Pain Points","ads":[{"title":"Version A","headline":"...","primaryText":"...","description":"...","cta":"..."},{"title":"Version B","headline":"...","primaryText":"...","description":"...","cta":"..."}]},{"angleLabel":"Proof/Results","ads":[{"title":"Version A","headline":"...","primaryText":"...","description":"...","cta":"..."}]},{"angleLabel":"Curiosity","ads":[{"title":"Version A","headline":"...","primaryText":"...","description":"...","cta":"..."}]},{"angleLabel":"Retargeting","ads":[{"title":"Warm Lead","headline":"...","primaryText":"...","description":"...","cta":"..."}]}],"targeting":{"demographics":["Age 28-55","Homeowners"],"interests1":{"label":"Primary Interests","items":["interest 1","interest 2"]},"interests2":{"label":"Secondary Interests","items":["interest 1"]},"behaviors":["relevant behavior"],"custom":["Website visitors"],"lookalike":["1% lookalike from customer list"]},"roadmap":[{"week":"Week 1-2","title":"Foundation","desc":"Setup tracking pixels, audiences, and campaign structure"},{"week":"Week 3-4","title":"Launch","desc":"Activate all ad sets with A/B testing"},{"week":"Week 5-8","title":"Optimize","desc":"Kill underperformers, scale winners"},{"week":"Week 9-12","title":"Scale","desc":"Expand audiences and increase budget on top performers"}],"qualificationScript":{"opening":"Hi [Name], I saw you were interested in [service] — quick question...","questions":[{"q":"What's your biggest challenge right now with [area]?","why":"Identifies pain point"},{"q":"Have you tried any solutions before?","why":"Qualifies budget/commitment"},{"q":"What would success look like in 90 days?","why":"Sets expectations"}],"objections":[{"obj":"Need to think about it","response":"Totally understand — what specific concern can I address right now?"},{"obj":"Too expensive","response":"What's the cost of NOT solving this problem over the next 6 months?"}]},"kpis":{"cpl":"$15-45","ctr":"1.5-3.5%","roas":"3-6x","conversionRate":"2-5%"}}`;
}

// ── HANDLER ───────────────────────────────────────────────────
export default async (req) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});
  if (req.method!=='POST')    return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  let data;
  try { data=await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  const {agencyId} = data;
  if (!agencyId) return new Response(JSON.stringify({error:'agencyId required'}),{status:400,headers:CORS});

  const required = ['firstName','lastName','email','businessName','industry','primaryService','adBudget','adPlatforms','goal90Days'];
  for(const f of required) {
    if(!data[f]) return new Response(JSON.stringify({error:`${f} is required`}),{status:400,headers:CORS});
  }

  try {
    // 1. Verify agency exists
    const agency = await fsGet(`agencies/${agencyId}`);
    if (!agency) return new Response(JSON.stringify({error:'Agency not found'}),{status:404,headers:CORS});

    // 2. Generate client ID and URLs
    const slug      = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-'+Date.now().toString(36);
    const planUrl   = `https://marketingplan.astroaibots.com/plans/${agencyId}/${slug}`;
    const portalUrl = `https://marketingplan.astroaibots.com/onboard/portal?a=${agencyId}&s=${slug}`;
    const now       = new Date().toISOString();

    // 3. Save initial client record (status: new, no plan yet)
    const baseClient = {
      agencyId, clientId:slug,
      firstName:data.firstName, lastName:data.lastName,
      clientName:`${data.firstName} ${data.lastName}`.trim(),
      clientEmail:data.email, businessName:data.businessName,
      phone:data.phone||'', industry:data.industry,
      primaryService:data.primaryService, adBudget:data.adBudget,
      adPlatforms:data.adPlatforms, serviceAreaType:data.serviceAreaType||'',
      serviceDetails:data.serviceDetails||'', website:data.website||'',
      companySize:data.companySize||'', goal90:data.goal90Days,
      status:'new', createdAt:now, dashboardUrl:'', dashboardJSON:'{}', notes:'',
      tags: data.tags||'', leadSource: data.leadSource||'',
    };
    await fsSet(`agencies/${agencyId}/clients/${slug}`, baseClient);
    console.log('[process-plan] Client saved, clientId:', slug);

    // 4. Call Claude to generate plan
    console.log('[process-plan] Calling Claude for:', data.businessName);
    let dashJSON = {};
    try {
      const rawJSON = await callClaude(buildPrompt(data));
      console.log('[process-plan] Claude returned', rawJSON.length, 'chars');
      // Parse the JSON response
      try {
        const cleaned = rawJSON.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
        dashJSON = JSON.parse(cleaned);
      } catch(parseErr) {
        // Try extracting JSON block
        const match = rawJSON.match(/\{[\s\S]*\}/);
        if (match) {
          try { dashJSON = JSON.parse(match[0]); }
          catch(e2) { console.error('[process-plan] JSON parse failed:', e2.message); }
        }
      }
      console.log('[process-plan] Plan parsed, keys:', Object.keys(dashJSON).join(','));
    } catch(claudeErr) {
      console.error('[process-plan] Claude failed:', claudeErr.message);
      // Still save the client, plan can be regenerated
    }

    // 5. Update client with plan data
    const updatedClient = {
      ...baseClient,
      status: 'active',
      dashboardUrl: planUrl,
      dashboardJSON: JSON.stringify(dashJSON),
      generatedAt: new Date().toISOString(),
    };
    await fsSet(`agencies/${agencyId}/clients/${slug}`, updatedClient);
    console.log('[process-plan] Client updated with plan');

    // 6. Send welcome email (non-blocking)
    const sendEmail = async () => {
      try {
        const { createTransport } = await import('nodemailer');
        const t = createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
        const brand = agency.brandName||agency.name||'Astro AI';
        const color = agency.brandColor||'#00d9a3';
        await t.sendMail({
          from:`"${brand}" <${process.env.GMAIL_USER}>`,
          to:data.email,
          subject:`Your AI Marketing Plan is Ready, ${data.firstName}!`,
          html:`<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px"><h2 style="color:${color}">${brand}</h2><p>Hi ${data.firstName},</p><p>Your marketing plan for <strong>${data.businessName}</strong> is ready!</p><a href="${planUrl}" style="background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin:16px 0">View Your Plan</a><p><a href="${portalUrl}">Go to Your Portal</a></p></div>`,
        });
        console.log('[process-plan] Email sent to', data.email);
      } catch(e) { console.error('[process-plan] Email error:', e.message); }
    };
    sendEmail(); // fire and forget

    // 7. Return success immediately
    return new Response(JSON.stringify({success:true, clientId:slug, planUrl, portalUrl}),{status:200,headers:CORS});

  } catch(err) {
    console.error('[process-plan] ERROR:', err.message, err.stack);
    return new Response(JSON.stringify({error:err.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/agency/process-plan' };
