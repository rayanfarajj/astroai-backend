// netlify/functions/agency-process-plan.js
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function ok(data)     { return new Response(JSON.stringify(data), { status: 200, headers: CORS }); }
function fail(msg, s=500) { return new Response(JSON.stringify({ error: msg }), { status: s, headers: CORS }); }

// ── FIREBASE (inline, no require) ──────────────────────────────
function getToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const b64   = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now   = Math.floor(Date.now()/1000);
    const hdr   = b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const pay   = b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const sig   = b64(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(key));
    const body  = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`;
    const req   = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error('No token')); });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function BASE() { return `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`; }

function toFS(val) {
  if (val === null || val === undefined) return {nullValue: null};
  if (typeof val === 'boolean') return {booleanValue: val};
  if (typeof val === 'number') return Number.isInteger(val) ? {integerValue: String(val)} : {doubleValue: val};
  if (typeof val === 'string') return {stringValue: val};
  if (Array.isArray(val)) return {arrayValue: {values: val.map(toFS)}};
  if (typeof val === 'object') return {mapValue: {fields: Object.fromEntries(Object.entries(val).map(([k,v])=>[k,toFS(v)]))}};
  return {stringValue: String(val)};
}

function fromFS(val) {
  if (!val) return null;
  if ('stringValue'  in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue'  in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue'    in val) return null;
  if ('arrayValue'   in val) return (val.arrayValue.values||[]).map(fromFS);
  if ('mapValue'     in val) return Object.fromEntries(Object.entries(val.mapValue.fields||{}).map(([k,v])=>[k,fromFS(v)]));
  return null;
}

function fsReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname:'firestore.googleapis.com', path, method,
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(bodyStr?{'Content-Length':Buffer.byteLength(bodyStr)}:{})}
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)}; }); });
    req.on('error',reject); if(bodyStr) req.write(bodyStr); req.end();
  });
}

function extractDoc(doc) {
  if (!doc || !doc.fields) return null;
  const out = {};
  for (const [k,v] of Object.entries(doc.fields)) out[k] = fromFS(v);
  out.id = (doc.name||'').split('/').pop();
  return out;
}

async function fsGet(col, id) {
  const token = await getToken();
  const doc   = await fsReq('GET', `${BASE()}/${col}/${id}`, null, token);
  return doc.error ? null : extractDoc(doc);
}

async function fsSetSub(agencyId, sub, docId, data) {
  const token  = await getToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsReq('PATCH', `${BASE()}/agencies/${agencyId}/${sub}/${docId}`, {fields}, token);
}

// ── CLAUDE ─────────────────────────────────────────────────────
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({model:'claude-opus-4-6',max_tokens:4096,messages:[{role:'user',content:prompt}]});
    const req  = https.request({
      hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{const r=JSON.parse(d);resolve(r.content?.[0]?.text||'')}catch(e){reject(e)}; }); });
    req.on('error',reject); req.write(body); req.end();
  });
}

// ── GITHUB ─────────────────────────────────────────────────────
function saveToGitHub(slug, agencyId, html) {
  return new Promise((resolve, reject) => {
    const content = Buffer.from(html).toString('base64');
    const body    = JSON.stringify({message:`Plan: ${agencyId}/${slug}`,content});
    const req     = https.request({
      hostname:'api.github.com',
      path:`/repos/rayanfarajj/astroai-backend/contents/public/plans/${agencyId}/${slug}.html`,
      method:'PUT',
      headers:{'Authorization':`token ${process.env.GITHUB_TOKEN}`,'User-Agent':'AstroAI','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.on('error',reject); req.write(body); req.end();
  });
}

// ── EMAIL ──────────────────────────────────────────────────────
async function sendWelcome(agency, client, planUrl) {
  try {
    const { createTransport } = await import('nodemailer');
    const t = createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
    const brand = agency.brandName || agency.name || 'Astro AI';
    const color = agency.brandColor || '#00d9a3';
    await t.sendMail({
      from:`"${brand}" <${process.env.GMAIL_USER}>`,
      to: client.clientEmail,
      subject:`🎉 Your AI Marketing Plan is Ready, ${client.firstName}!`,
      html:`<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
        <h2 style="color:${color}">${brand}</h2>
        <p>Hi ${client.firstName},</p>
        <p>Your personalized AI marketing plan for <strong>${client.businessName}</strong> is ready!</p>
        ${agency.welcomeMsg?`<p>${agency.welcomeMsg}</p>`:''}
        <a href="${planUrl}" style="background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px">📊 View My Plan</a>
        <p style="color:#888;font-size:12px;margin-top:24px">Powered by ${brand} · Astro AI Platform</p>
      </div>`,
    });
  } catch(e) { console.error('[welcome-email]', e.message); }
}

// ── PLAN HTML ──────────────────────────────────────────────────
function buildPlanHTML(json, data, agency) {
  const s    = v => String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const brand = agency.brandName || agency.name || 'Astro AI';
  const color = agency.brandColor || '#00d9a3';
  const ads   = (json.adAngles||[]).map(a=>`<div style="margin-bottom:20px"><div style="background:rgba(0,0,0,.06);border-radius:20px;padding:3px 12px;display:inline-block;font-size:.75rem;font-weight:700;margin-bottom:8px">${s(a.angleLabel)}</div>${(a.ads||[]).map(ad=>`<div style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;padding:14px;margin-bottom:8px"><div style="font-size:.68rem;color:#999;font-weight:700;margin-bottom:6px">${s(ad.title||'')}</div><p style="margin:0 0 6px;font-size:.85rem;line-height:1.6">${s(ad.primaryText||'')}</p><p style="font-weight:700;font-size:.9rem;margin:4px 0">${s(ad.headline||'')}</p><p style="font-size:.8rem;color:#555;margin:2px 0">${s(ad.description||'')}</p><p style="font-size:.78rem;color:${color};font-weight:700;margin:4px 0">${s(ad.cta||'')}</p></div>`).join('')}</div>`).join('');
  const rm    = (json.roadmap||[]).map(r=>`<div style="display:flex;gap:16px;padding:10px 0;border-bottom:1px solid #eee"><div style="font-weight:700;color:${color};min-width:80px;font-size:.78rem">${s(r.week||'')}</div><div><div style="font-weight:700;font-size:.85rem">${s(r.title||'')}</div><div style="font-size:.8rem;color:#555;margin-top:2px">${s(r.desc||'')}</div></div></div>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${s(data.businessName)} — Marketing Plan</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;color:#222;background:#fff;font-size:14px}.header{background:${color};color:#fff;padding:28px 32px}.header h1{font-size:1.5rem;font-weight:800;margin-bottom:4px}.container{max-width:860px;margin:0 auto;padding:32px 24px}.section{margin-bottom:32px}.section-title{font-size:1rem;font-weight:800;color:#111;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid ${color}}footer{text-align:center;padding:24px;font-size:.72rem;color:#aaa;border-top:1px solid #eee;margin-top:40px}</style></head><body><div class="header"><div style="font-size:.8rem;opacity:.7;margin-bottom:4px">${s(brand)}</div><h1>${s(data.businessName)}</h1><p>AI Marketing Plan · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p></div><div class="container"><div class="section"><div class="section-title">Executive Summary</div><p style="line-height:1.75;color:#444">${s(json.executiveSummary||'')}</p></div><div class="section"><div class="section-title">Ad Copy</div>${ads}</div><div class="section"><div class="section-title">90-Day Roadmap</div>${rm}</div></div><footer>Powered by ${s(brand)} · Astro AI Platform</footer></body></html>`;
}

// ── PROMPT ─────────────────────────────────────────────────────
function buildPrompt(d, agency) {
  return `You are an expert digital marketing strategist. Generate a comprehensive AI marketing plan. Return ONLY valid JSON, no markdown, no explanation.

BUSINESS: ${d.businessName} | Industry: ${d.industry} | Service: ${d.primaryService}
Budget: $${d.adBudget}/mo | Platforms: ${d.adPlatforms} | Goal: ${d.goal90Days}
Agency: ${agency.name || 'Astro AI'}

Return this exact JSON structure:
{"executiveSummary":"2-3 sentence overview","adAngles":[{"angleLabel":"Empathy","ads":[{"title":"Version A","primaryText":"3-4 sentences","headline":"short headline","description":"one line benefit","cta":"Book Free Estimate"}]},{"angleLabel":"Pain Points","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."},{"title":"Version B","primaryText":"...","headline":"...","description":"...","cta":"..."}]},{"angleLabel":"Proof","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."}]},{"angleLabel":"Curiosity","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."}]},{"angleLabel":"Retargeting","ads":[{"title":"Warm Lead","primaryText":"...","headline":"...","description":"...","cta":"..."}]}],"targeting":{"demographics":["Age 28-55","Homeowners"],"interests1":{"label":"Primary Interests","items":["Home Improvement"]},"interests2":{"label":"Secondary Interests","items":["DIY"]},"behaviors":["Recent movers"],"custom":["Website visitors"],"lookalike":["1% lookalike"]},"roadmap":[{"week":"Week 1-2","title":"Foundation","desc":"Set up tracking, build audiences"},{"week":"Week 3-4","title":"Launch","desc":"Activate all ad angles"},{"week":"Week 5-8","title":"Optimize","desc":"Kill underperformers, scale winners"},{"week":"Week 9-12","title":"Scale","desc":"Expand to lookalike audiences"}],"qualificationScript":{"opening":"Hi [Name], this is [Agent] calling about your interest in our services.","questions":[{"q":"What's your main challenge right now?","why":"Uncover pain point"},{"q":"What's your timeline?","why":"Qualify urgency"}],"objections":[{"obj":"I need to think about it","response":"What specific concern can I address right now?"}]},"kpis":{"cpl":"Target CPL: $15-35","ctr":"Target CTR: 1.5-3%","roas":"Target ROAS: 3-5x"}}`;
}

// ── HANDLER ────────────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')   return fail('POST only', 405);

  let data;
  try { data = await req.json(); } catch { return fail('Invalid JSON', 400); }

  const { agencyId } = data;
  if (!agencyId) return fail('agencyId required', 400);

  const required = ['firstName','lastName','email','businessName','industry','primaryService','adBudget','adPlatforms','goal90Days'];
  for (const f of required) if (!data[f]) return fail(`${f} is required`, 400);

  try {
    const agency = await fsGet('agencies', agencyId);
    if (!agency) return fail('Agency not found', 404);

    const clientId = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50) + '-' + Date.now().toString(36);
    const clientData = {
      agencyId, clientId,
      firstName: data.firstName, lastName: data.lastName,
      clientName: `${data.firstName} ${data.lastName}`.trim(),
      clientEmail: data.email, businessName: data.businessName,
      phone: data.phone||'', industry: data.industry,
      primaryService: data.primaryService, adBudget: data.adBudget,
      adPlatforms: data.adPlatforms, serviceAreaType: data.serviceAreaType||'',
      serviceDetails: data.serviceDetails||'', website: data.website||'',
      companySize: data.companySize||'', goal90: data.goal90Days,
      status: 'new', createdAt: new Date().toISOString(),
      dashboardUrl: '', dashboardJSON: '{}', notes: '',
    };

    await fsSetSub(agencyId, 'clients', clientId, clientData);

    const rawJSON = await callClaude(buildPrompt(data, agency));
    let dashJSON = {};
    try {
      const cleaned = rawJSON.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
      dashJSON = JSON.parse(cleaned);
    } catch(e) {
      const m = rawJSON.match(/\{[\s\S]*\}/);
      if (m) try { dashJSON = JSON.parse(m[0]); } catch(e2) {}
    }

    const planHTML  = buildPlanHTML(dashJSON, data, agency);
    const planUrl   = `https://marketingplan.astroaibots.com/plans/${agencyId}/${clientId}.html`;
    const portalUrl = `https://marketingplan.astroaibots.com/onboard/portal?a=${agencyId}&s=${clientId}`;

    try { await saveToGitHub(clientId, agencyId, planHTML); } catch(e) { console.error('[github]', e.message); }

    await fsSetSub(agencyId, 'clients', clientId, {
      ...clientData, dashboardUrl: planUrl,
      dashboardJSON: JSON.stringify(dashJSON),
      status: 'active', generatedAt: new Date().toISOString(),
    });

    try { await sendWelcome(agency, { ...clientData, firstName: data.firstName }, planUrl); } catch(e) { console.error('[email]', e.message); }

    return ok({ success: true, clientId, planUrl, portalUrl });

  } catch(err) {
    console.error('[agency-process-plan]', err.message);
    return fail(err.message);
  }
};

export const config = { path: '/api/agency/process-plan' };
