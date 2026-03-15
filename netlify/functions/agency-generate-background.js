// netlify/functions/agency-generate-background.js
// Background function — 15 min timeout, returns 202 immediately, runs Claude in background
import https from 'https';
import crypto from 'crypto';

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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No token'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function toFS(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean') return {booleanValue:v};
  if (typeof v==='number') return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if (typeof v==='string') return {stringValue:v};
  if (Array.isArray(v)) return {arrayValue:{values:v.map(toFS)}};
  if (typeof v==='object') return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,val])=>[k,toFS(val)]))}};
  return {stringValue:String(v)};
}

function fromFS(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  if ('arrayValue'   in v) return (v.arrayValue.values||[]).map(fromFS);
  if ('mapValue'     in v) return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,val])=>[k,fromFS(val)]));
  return null;
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

function extractDoc(doc) {
  if (!doc||!doc.fields) return null;
  const o={};
  for (const [k,v] of Object.entries(doc.fields)) o[k]=fromFS(v);
  o.id=(doc.name||'').split('/').pop();
  return o;
}

async function fsGet(col, id) {
  const t = await getToken();
  const d = await fsHttp('GET',`${BASE()}/${col}/${id}`,null,t);
  return d.error?null:extractDoc(d);
}

async function fsSetSub(agencyId, sub, docId, data) {
  const t = await getToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsHttp('PATCH',`${BASE()}/agencies/${agencyId}/${sub}/${docId}`,{fields},t);
}

function callClaude(prompt) {
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify({model:'claude-opus-4-6',max_tokens:4096,messages:[{role:'user',content:prompt}]});
    const r = https.request({hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{const j=JSON.parse(d);resolve(j.content?.[0]?.text||'')}catch(e){reject(e)}});
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

function saveToGitHub(slug, agencyId, html) {
  return new Promise((resolve, reject)=>{
    if (!process.env.GITHUB_TOKEN) { reject(new Error('No GITHUB_TOKEN')); return; }
    const encoded = Buffer.from(html).toString('base64');
    // First check if file exists to get its sha (required for update)
    const checkReq = https.request({
      hostname:'api.github.com',
      path:`/repos/rayanfarajj/astroai-backend/contents/public/plans/${agencyId}/${slug}.html`,
      method:'GET',
      headers:{'Authorization':`token ${process.env.GITHUB_TOKEN}`,'User-Agent':'AstroAI'}
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        let sha = '';
        try { sha = JSON.parse(d).sha || ''; } catch(e) {}
        const bodyObj = {message:`Plan: ${agencyId}/${slug}`, content: encoded};
        if (sha) bodyObj.sha = sha;
        const body = JSON.stringify(bodyObj);
        const putReq = https.request({
          hostname:'api.github.com',
          path:`/repos/rayanfarajj/astroai-backend/contents/public/plans/${agencyId}/${slug}.html`,
          method:'PUT',
          headers:{'Authorization':`token ${process.env.GITHUB_TOKEN}`,'User-Agent':'AstroAI','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
        }, res2 => { let d2=''; res2.on('data',c=>d2+=c); res2.on('end',()=>resolve()); });
        putReq.on('error', reject); putReq.write(body); putReq.end();
      });
    });
    checkReq.on('error', reject); checkReq.end();
  });
}

function buildPlanHTML(json, data, agency) {
  const s = v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const brand = agency.brandName||agency.name||'Astro AI';
  const color = agency.brandColor||'#00d9a3';
  const ads = (json.adAngles||[]).map(a=>`<div style="margin-bottom:20px"><div style="background:rgba(0,0,0,.06);border-radius:20px;padding:3px 12px;display:inline-block;font-size:.75rem;font-weight:700;margin-bottom:8px">${s(a.angleLabel)}</div>${(a.ads||[]).map(ad=>`<div style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;padding:14px;margin-bottom:8px"><p style="font-weight:700;margin-bottom:6px">${s(ad.headline||'')}</p><p style="margin:0 0 6px;line-height:1.6;font-size:.9rem">${s(ad.primaryText||'')}</p><p style="color:${color};font-weight:700;font-size:.85rem">${s(ad.cta||'')}</p></div>`).join('')}</div>`).join('');
  const rm = (json.roadmap||[]).map(r=>`<div style="display:flex;gap:16px;padding:10px 0;border-bottom:1px solid #eee"><div style="font-weight:700;color:${color};min-width:80px;font-size:.85rem">${s(r.week||'')}</div><div><b>${s(r.title||'')}</b><p style="font-size:.85rem;color:#555;margin-top:2px">${s(r.desc||'')}</p></div></div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${s(data.businessName)} — Marketing Plan</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;color:#222;background:#fff;font-size:15px}.header{background:${color};color:#fff;padding:28px 32px}.header h1{font-size:1.5rem;font-weight:800;margin-bottom:4px}.container{max-width:860px;margin:0 auto;padding:32px 24px}.section{margin-bottom:32px}.stitle{font-size:1rem;font-weight:800;border-bottom:2px solid ${color};padding-bottom:8px;margin-bottom:16px}footer{text-align:center;padding:24px;font-size:.8rem;color:#aaa;border-top:1px solid #eee;margin-top:40px}</style></head><body><div class="header"><div style="font-size:.8rem;opacity:.8;margin-bottom:4px">${s(brand)}</div><h1>${s(data.businessName)}</h1><p style="opacity:.85;font-size:.9rem">AI Marketing Plan · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p></div><div class="container"><div class="section"><div class="stitle">Executive Summary</div><p style="line-height:1.75;color:#444">${s(json.executiveSummary||'')}</p></div><div class="section"><div class="stitle">Ad Copy</div>${ads}</div><div class="section"><div class="stitle">90-Day Roadmap</div>${rm}</div></div><footer>Powered by ${s(brand)} · Astro AI Platform</footer></body></html>`;
}

function buildPrompt(d, agency) {
  return `You are an expert digital marketing strategist. Generate a comprehensive AI marketing plan. Return ONLY valid JSON, no markdown.

Business: ${d.businessName} | Industry: ${d.industry} | Service: ${d.primaryService}
Budget: $${d.adBudget}/mo | Platforms: ${d.adPlatforms} | Goal: ${d.goal90Days}

Return this exact JSON:
{"executiveSummary":"2-3 sentences","adAngles":[{"angleLabel":"Empathy","ads":[{"title":"Version A","primaryText":"3-4 sentences","headline":"short headline","description":"one line","cta":"Book Now"}]},{"angleLabel":"Pain Points","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."},{"title":"Version B","primaryText":"...","headline":"...","description":"...","cta":"..."}]},{"angleLabel":"Proof","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."}]},{"angleLabel":"Curiosity","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."}]},{"angleLabel":"Retargeting","ads":[{"title":"Warm Lead","primaryText":"...","headline":"...","description":"...","cta":"..."}]}],"targeting":{"demographics":["Age 28-55","Homeowners"],"interests1":{"label":"Primary","items":["relevant interest"]},"interests2":{"label":"Secondary","items":["relevant interest"]},"behaviors":["Recent movers"],"custom":["Website visitors"],"lookalike":["1% lookalike"]},"roadmap":[{"week":"Week 1-2","title":"Foundation","desc":"Setup tracking"},{"week":"Week 3-4","title":"Launch","desc":"Activate ads"},{"week":"Week 5-8","title":"Optimize","desc":"Scale winners"},{"week":"Week 9-12","title":"Scale","desc":"Expand audiences"}],"qualificationScript":{"opening":"Hi [Name], calling about your interest.","questions":[{"q":"What is your main challenge?","why":"Pain point"}],"objections":[{"obj":"Need to think","response":"What concern can I address now?"}]},"kpis":{"cpl":"$15-35","ctr":"1.5-3%","roas":"3-5x"}}`;
}

export default async (req) => {
  let data;
  try { data = await req.json(); } catch { return; }

  const { agencyId, clientId, planUrl, portalUrl } = data;
  if (!agencyId || !clientId) return;

  try {
    const agency = await fsGet('agencies', agencyId);
    if (!agency) { console.error('[bg] Agency not found:', agencyId); return; }

    // Generate plan
    console.log('[bg] Generating plan for', data.businessName);
    const rawJSON = await callClaude(buildPrompt(data, agency));
    let dashJSON = {};
    try {
      const cleaned = rawJSON.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
      dashJSON = JSON.parse(cleaned);
    } catch(e) {
      const m = rawJSON.match(/\{[\s\S]*\}/);
      if (m) try { dashJSON = JSON.parse(m[0]); } catch(e2) {}
    }

    // Save HTML to GitHub (non-critical — don't let failure kill the plan)
    try {
      await saveToGitHub(clientId, agencyId, buildPlanHTML(dashJSON, data, agency));
      console.log('[bg] Plan HTML saved to GitHub');
    } catch(ghErr) {
      console.log('[bg] GitHub save failed (non-fatal):', ghErr.message);
    }

    // Update client record
    const clientData = {
      agencyId, clientId,
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
    };
    await fsSetSub(agencyId, 'clients', clientId, clientData);
    console.log('[bg] Client updated');

    // Send welcome email
    try {
      const { createTransport } = await import('nodemailer');
      const t = createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
      const brand = agency.brandName||agency.name||'Astro AI';
      const color = agency.brandColor||'#00d9a3';
      await t.sendMail({
        from:`"${brand}" <${process.env.GMAIL_USER}>`,
        to:data.email,
        subject:`🎉 Your AI Marketing Plan is Ready, ${data.firstName}!`,
        html:`<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px"><h2 style="color:${color}">${brand}</h2><p>Hi ${data.firstName},</p><p>Your plan for <strong>${data.businessName}</strong> is ready!</p><a href="${planUrl}" style="background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-top:16px">📊 View My Plan</a><p style="margin-top:16px"><a href="${portalUrl}">👤 Go to Your Portal</a></p></div>`,
      });
      console.log('[bg] Email sent to', data.email);
    } catch(e) { console.error('[bg] Email failed:', e.message); }

  } catch(e) {
    console.error('[bg] Error:', e.message, e.stack);
  }
};
// No config export — background functions use file name suffix "-background"
