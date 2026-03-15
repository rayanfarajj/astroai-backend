// netlify/functions/agency-serve-plan.js
// Serves the HTML plan directly from Firestore — no GitHub/redeploy needed
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

function buildPlanHTML(json, client, agency) {
  const s = v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const brand = agency.brandName||agency.name||'Astro AI';
  const color = agency.brandColor||'#00d9a3';
  const ads = (json.adAngles||[]).map(a=>`<div style="margin-bottom:24px"><div style="background:rgba(0,0,0,.06);border-radius:20px;padding:3px 14px;display:inline-block;font-size:.75rem;font-weight:700;margin-bottom:10px">${s(a.angleLabel)}</div>${(a.ads||[]).map(ad=>`<div style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:10px"><p style="font-weight:700;font-size:1rem;margin-bottom:8px">${s(ad.headline||'')}</p><p style="margin:0 0 8px;line-height:1.7;color:#333">${s(ad.primaryText||'')}</p><p style="color:#888;font-size:.85rem;margin-bottom:6px">${s(ad.description||'')}</p><p style="color:${color};font-weight:700">${s(ad.cta||'')}</p></div>`).join('')}</div>`).join('');
  const rm = (json.roadmap||[]).map(r=>`<div style="display:flex;gap:20px;padding:12px 0;border-bottom:1px solid #f0f0f0"><div style="font-weight:700;color:${color};min-width:90px;font-size:.85rem;padding-top:2px">${s(r.week||'')}</div><div><div style="font-weight:700;font-size:.95rem;margin-bottom:4px">${s(r.title||'')}</div><div style="color:#666;font-size:.9rem;line-height:1.5">${s(r.desc||'')}</div></div></div>`).join('');
  const tgt = json.targeting||{};
  const tgtHTML = [
    ['Demographics', tgt.demographics],
    [(tgt.interests1||{}).label||'Primary Interests', (tgt.interests1||{}).items],
    [(tgt.interests2||{}).label||'Secondary Interests', (tgt.interests2||{}).items],
    ['Behaviors', tgt.behaviors],
  ].filter(([,items])=>items&&items.length).map(([lbl,items])=>`<div style="margin-bottom:12px"><div style="font-size:.7rem;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:6px">${s(lbl)}</div><div style="display:flex;flex-wrap:wrap;gap:6px">${items.map(i=>`<span style="background:${color}15;color:${color};border:1px solid ${color}30;border-radius:20px;padding:3px 10px;font-size:.8rem;font-weight:600">${s(i)}</span>`).join('')}</div></div>`).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${s(client.businessName)} — AI Marketing Plan</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;color:#222;background:#f8f9fa;font-size:15px}.header{background:${color};color:#fff;padding:32px;background:linear-gradient(135deg,${color},${color}dd)}.header-brand{font-size:.85rem;opacity:.8;margin-bottom:6px}.header h1{font-size:1.6rem;font-weight:800;margin-bottom:4px}.header p{opacity:.85;font-size:.9rem}.container{max-width:860px;margin:0 auto;padding:32px 24px}.card{background:#fff;border-radius:12px;padding:24px;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.section-title{font-size:1rem;font-weight:800;color:#111;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid ${color};display:flex;align-items:center;gap:8px}.summary{line-height:1.8;color:#444;font-size:.95rem}footer{text-align:center;padding:32px;font-size:.8rem;color:#aaa;border-top:1px solid #eee;margin-top:20px;background:#fff}</style></head><body><div class="header"><div class="header-brand">${s(brand)}</div><h1>${s(client.businessName)}</h1><p>AI Marketing Plan · Generated ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p></div><div class="container">${json.executiveSummary?`<div class="card"><div class="section-title">📊 Executive Summary</div><p class="summary">${s(json.executiveSummary)}</p></div>`:''}<div class="card"><div class="section-title">🎯 Ad Copy</div>${ads}</div>${tgtHTML?`<div class="card"><div class="section-title">👥 Audience Targeting</div>${tgtHTML}</div>`:''}<div class="card"><div class="section-title">📅 90-Day Roadmap</div>${rm}</div></div><footer>Powered by ${s(brand)} · Astro AI Platform</footer></body></html>`;
}

export default async (req) => {
  const url      = new URL(req.url);
  const parts    = url.pathname.split('/').filter(Boolean);
  // Path: /plans/:agencyId/:clientId
  const agencyId = parts[1] || '';
  const clientId = (parts[2]||'').replace(/\.html$/,'');

  if (!agencyId || !clientId) {
    return new Response('<h1>Plan not found</h1>', {status:404,headers:{'Content-Type':'text/html'}});
  }

  try {
    const token = await getToken();

    // Get client from agency subcollection
    const doc = await fsHttp('GET', `${BASE()}/agencies/${agencyId}/clients/${clientId}`, null, token);
    if (!doc.fields) {
      return new Response(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Plan Not Ready Yet</h2><p style="color:#666;margin-top:12px">Your marketing plan is still being generated. Check your email in a few minutes!</p><p style="margin-top:20px"><a href="javascript:location.reload()" style="color:#00d9a3">↺ Refresh</a></p></body></html>`, {status:200,headers:{'Content-Type':'text/html'}});
    }

    const get = k => doc.fields[k]?.stringValue || '';
    const dashboardJSON = get('dashboardJSON');

    if (!dashboardJSON || dashboardJSON === '{}') {
      return new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="10"><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f9fa;text-align:center}.box{background:#fff;border-radius:16px;padding:48px 40px;max-width:460px;box-shadow:0 4px 24px rgba(0,0,0,.08)}.spinner{width:40px;height:40px;border:3px solid #eee;border-top-color:#00d9a3;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 20px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spinner"></div><h2 style="font-size:1.3rem;font-weight:800;color:#111;margin-bottom:8px">Building Your Plan...</h2><p style="color:#666;line-height:1.6;font-size:.9rem">Your AI marketing plan is being generated right now. This page refreshes every 10 seconds automatically.</p><p style="margin-top:12px;font-size:.8rem;color:#aaa">We will also send it to your email when ready.</p></div></body></html>`, {status:200,headers:{'Content-Type':'text/html;charset=UTF-8'}});
    }

    const client = {};
    for (const [k,v] of Object.entries(doc.fields)) client[k] = fromFS(v);

    // Get agency branding
    const agencyDoc = await fsHttp('GET', `${BASE()}/agencies/${agencyId}`, null, token);
    const agency = {};
    if (agencyDoc.fields) {
      for (const [k,v] of Object.entries(agencyDoc.fields)) agency[k] = fromFS(v);
    }

    let planJSON = {};
    try { planJSON = JSON.parse(dashboardJSON); } catch(e) {}

    const html = buildPlanHTML(planJSON, client, agency);
    return new Response(html, {status:200, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}});

  } catch(e) {
    console.error('[agency-serve-plan]', e.message);
    return new Response(`<html><body style="font-family:sans-serif;padding:40px"><h2>Error loading plan</h2><p>${e.message}</p></body></html>`, {status:500,headers:{'Content-Type':'text/html'}});
  }
};

export const config = {
  path: '/plans/:agencyId/:clientId',
  preferStatic: true,
};
