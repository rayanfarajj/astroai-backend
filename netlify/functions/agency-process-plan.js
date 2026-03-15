// netlify/functions/agency-process-plan.js
// Uses context.waitUntil() to return immediately while Claude generates in background
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
      model:'claude-sonnet-4-6',
      max_tokens:4000,
      messages:[{role:'user',content:prompt}]
    });
    const r = https.request({
      hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try{
          const j=JSON.parse(d);
          if(j.error) reject(new Error(j.error.message||JSON.stringify(j.error)));
          else resolve(j.content?.[0]?.text||'');
        }catch(e){reject(e)}
      });
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

function buildPrompt(d) {
  return `You are an expert digital marketing strategist. Generate a comprehensive AI marketing plan. Return ONLY valid JSON with no markdown, no backticks, no explanation.

Business: ${d.businessName}
Industry: ${d.industry}
Service: ${d.primaryService}
Monthly Ad Budget: $${d.adBudget}
Platforms: ${d.adPlatforms}
90-Day Goal: ${d.goal90Days}

Return this exact JSON:
{"executiveSummary":"2-3 sentence strategy overview","adAngles":[{"angleLabel":"Empathy","ads":[{"title":"Version A","headline":"Short headline under 40 chars","primaryText":"3-4 sentences of ad copy","description":"One line","cta":"Call to action"}]},{"angleLabel":"Pain Points","ads":[{"title":"Version A","headline":"...","primaryText":"...","description":"...","cta":"..."},{"title":"Version B","headline":"...","primaryText":"...","description":"...","cta":"..."}]},{"angleLabel":"Proof/Results","ads":[{"title":"Version A","headline":"...","primaryText":"...","description":"...","cta":"..."}]},{"angleLabel":"Curiosity","ads":[{"title":"Version A","headline":"...","primaryText":"...","description":"...","cta":"..."}]},{"angleLabel":"Retargeting","ads":[{"title":"Warm Lead","headline":"...","primaryText":"...","description":"...","cta":"..."}]}],"targeting":{"demographics":["Age 28-55","Homeowners"],"interests1":{"label":"Primary Interests","items":["interest 1","interest 2"]},"interests2":{"label":"Secondary Interests","items":["interest 1"]},"behaviors":["behavior 1"],"custom":["Website visitors"],"lookalike":["1% lookalike"]},"roadmap":[{"week":"Week 1-2","title":"Foundation","desc":"Setup tracking and campaign structure"},{"week":"Week 3-4","title":"Launch","desc":"Activate ads with A/B testing"},{"week":"Week 5-8","title":"Optimize","desc":"Scale winners, cut losers"},{"week":"Week 9-12","title":"Scale","desc":"Expand audiences and budget"}],"qualificationScript":{"opening":"Hi [Name], quick question about [service]...","questions":[{"q":"What is your biggest challenge right now?","why":"Identifies pain point"},{"q":"Have you tried solutions before?","why":"Qualifies commitment"}],"objections":[{"obj":"Need to think about it","response":"What specific concern can I address now?"}]},"kpis":{"cpl":"$15-45","ctr":"1.5-3.5%","roas":"3-6x","conversionRate":"2-5%"}}`;
}

// ── BACKGROUND WORK (runs after response is sent) ─────────────
async function generatePlanInBackground(data, slug, planUrl, portalUrl, agency) {
  try {
    console.log('[bg] Starting Claude generation for:', data.businessName);
    const raw = await callClaude(buildPrompt(data));
    console.log('[bg] Claude done, length:', raw.length);

    let dashJSON = {};
    try {
      dashJSON = JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim());
    } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if(m) try { dashJSON = JSON.parse(m[0]); } catch(e2) { console.error('[bg] JSON parse failed'); }
    }
    console.log('[bg] Parsed plan, keys:', Object.keys(dashJSON).join(','));

    // Save plan to Firestore
    await fsSet(`agencies/${data.agencyId}/clients/${slug}`, {
      agencyId:data.agencyId, clientId:slug,
      firstName:data.firstName, lastName:data.lastName,
      clientName:`${data.firstName} ${data.lastName}`.trim(),
      clientEmail:data.email, businessName:data.businessName,
      phone:data.phone||'', industry:data.industry,
      primaryService:data.primaryService, adBudget:data.adBudget,
      adPlatforms:data.adPlatforms, serviceAreaType:data.serviceAreaType||'',
      serviceDetails:data.serviceDetails||'', website:data.website||'',
      companySize:data.companySize||'', goal90:data.goal90Days,
      status:'active', createdAt:data.createdAt||new Date().toISOString(),
      dashboardUrl:planUrl, dashboardJSON:JSON.stringify(dashJSON),
      notes:'', generatedAt:new Date().toISOString(),
      tags:data.tags||'', leadSource:data.leadSource||'',
    });
    console.log('[bg] Firestore updated for:', slug);

    // Send welcome email
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
      console.log('[bg] Email sent to:', data.email);
    } catch(emailErr) { console.error('[bg] Email failed:', emailErr.message); }

    console.log('[bg] ALL DONE for:', data.businessName);
  } catch(err) {
    console.error('[bg] Generation failed:', err.message, err.stack?.slice(0,300));
  }
}

// ── HANDLER ───────────────────────────────────────────────────
export default async (req, context) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});
  if (req.method!=='POST')    return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  let data;
  try { data=await req.json(); }
  catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  const {agencyId} = data;
  if (!agencyId) return new Response(JSON.stringify({error:'agencyId required'}),{status:400,headers:CORS});

  const required = ['firstName','lastName','email','businessName','industry','primaryService','adBudget','adPlatforms','goal90Days'];
  for(const f of required) {
    if(!data[f]) return new Response(JSON.stringify({error:`${f} is required`}),{status:400,headers:CORS});
  }

  try {
    // 1. Verify agency
    const agency = await fsGet(`agencies/${agencyId}`);
    if (!agency) return new Response(JSON.stringify({error:'Agency not found'}),{status:404,headers:CORS});

    // 2. Generate IDs
    const slug      = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-'+Date.now().toString(36);
    const planUrl   = `https://marketingplan.astroaibots.com/plans/${agencyId}/${slug}`;
    const portalUrl = `https://marketingplan.astroaibots.com/onboard/portal?a=${agencyId}&s=${slug}`;

    // 3. Save initial client record immediately
    const now = new Date().toISOString();
    await fsSet(`agencies/${agencyId}/clients/${slug}`, {
      agencyId, clientId:slug,
      firstName:data.firstName, lastName:data.lastName,
      clientName:`${data.firstName} ${data.lastName}`.trim(),
      clientEmail:data.email, businessName:data.businessName,
      phone:data.phone||'', industry:data.industry,
      primaryService:data.primaryService, adBudget:data.adBudget,
      adPlatforms:data.adPlatforms, serviceAreaType:data.serviceAreaType||'',
      serviceDetails:data.serviceDetails||'', website:data.website||'',
      companySize:data.companySize||'', goal90:data.goal90Days,
      status:'new', createdAt:now,
      dashboardUrl:planUrl, dashboardJSON:'{}', notes:'',
      tags:data.tags||'', leadSource:data.leadSource||'',
    });
    console.log('[process-plan] Client saved:', slug);

    // 4. Use context.waitUntil() to run Claude AFTER response is sent
    // This avoids the 10s timeout — Claude call continues in background
    data.createdAt = now;
    context.waitUntil(generatePlanInBackground(data, slug, planUrl, portalUrl, agency));

    // 5. Return immediately
    return new Response(JSON.stringify({success:true, clientId:slug, planUrl, portalUrl}),{status:200,headers:CORS});

  } catch(err) {
    console.error('[process-plan] ERROR:', err.message);
    return new Response(JSON.stringify({error:err.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/agency/process-plan' };
