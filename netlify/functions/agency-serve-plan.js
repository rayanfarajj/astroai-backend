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
  const s = v => String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const brand = agency.brandName || agency.name || 'Astro AI';
  const color = agency.brandColor || '#00d9a3';

  // ── Ad Angles ─────────────────────────────────────────────────────────────
  const adsHTML = (json.adAngles||[]).map(a => {
    const adCards = (a.ads||[]).map(ad => `
      <div style="background:#f9f9f9;border:1px solid #eee;border-radius:10px;padding:18px;margin-bottom:12px">
        ${ad.title?`<div style="font-size:.7rem;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:8px">${s(ad.title)}</div>`:''}
        <p style="font-weight:800;font-size:1.05rem;color:#111;margin-bottom:10px">${s(ad.headline||'')}</p>
        <p style="margin:0 0 10px;line-height:1.75;color:#444;font-size:.92rem">${s(ad.primaryText||'')}</p>
        ${ad.description?`<p style="color:#888;font-size:.82rem;margin-bottom:8px;font-style:italic">${s(ad.description)}</p>`:''}
        ${ad.cta?`<div style="display:inline-block;background:${color};color:#fff;padding:7px 16px;border-radius:6px;font-weight:700;font-size:.82rem">${s(ad.cta)}</div>`:''}
      </div>`).join('');
    return `<div style="margin-bottom:28px">
      <div style="background:${color}22;border-left:4px solid ${color};border-radius:6px;padding:6px 14px;display:inline-flex;align-items:center;gap:8px;font-size:.78rem;font-weight:700;margin-bottom:12px;color:#333">
        ${s(a.angleLabel||'')}${a.angle?` — <span style="font-weight:400;font-style:italic">${s(a.angle)}</span>`:''}
      </div>${adCards}</div>`;
  }).join('');

  // ── Roadmap — handles both {phase, title, desc} and {week, title, desc} ───
  const rmHTML = (json.roadmap||[]).map(r => `
    <div style="display:flex;gap:20px;padding:14px 0;border-bottom:1px solid #f0f0f0">
      <div style="font-weight:700;color:${color};min-width:100px;font-size:.82rem;padding-top:3px;flex-shrink:0">${s(r.phase||r.week||'')}</div>
      <div><div style="font-weight:700;font-size:.95rem;margin-bottom:5px">${s(r.title||'')}</div>
      <div style="color:#666;font-size:.88rem;line-height:1.6">${s(r.desc||'')}</div></div>
    </div>`).join('');

  // ── Targeting ─────────────────────────────────────────────────────────────
  const tgt = json.targeting || {};
  const tgtItems = Object.entries(tgt)
    .filter(([,v]) => Array.isArray(v) ? v.length : v)
    .map(([k, v]) => {
      const items = Array.isArray(v) ? v : (typeof v === 'object' ? (v.items||[]) : [v]);
      const label = k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g,' $1');
      return `<div style="margin-bottom:14px">
        <div style="font-size:.72rem;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">${s(label)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${items.map(i=>`<span style="background:#f3f4f6;border-radius:20px;padding:3px 10px;font-size:.8rem">${s(i)}</span>`).join('')}</div>
      </div>`;
    }).join('');

  // ── Avatar ────────────────────────────────────────────────────────────────
  const av = json.avatar || {};
  const avatarHTML = (av.whoTheyAre || av.painPoints || av.desires) ? `
    <div class="card">
      <div class="section-title">👤 Dream Client Avatar${av.name?` — ${s(av.name)}`:''}</div>
      ${av.whoTheyAre?`<div style="margin-bottom:12px"><strong style="font-size:.78rem;color:#888;text-transform:uppercase">Who They Are</strong><p style="margin-top:4px;line-height:1.7;color:#444;font-size:.92rem">${s(av.whoTheyAre)}</p></div>`:''}
      ${av.painPoints?`<div style="margin-bottom:12px"><strong style="font-size:.78rem;color:#888;text-transform:uppercase">Pain Points</strong><p style="margin-top:4px;line-height:1.7;color:#444;font-size:.92rem">${s(av.painPoints)}</p></div>`:''}
      ${av.desires?`<div style="margin-bottom:12px"><strong style="font-size:.78rem;color:#888;text-transform:uppercase">What They Want</strong><p style="margin-top:4px;line-height:1.7;color:#444;font-size:.92rem">${s(av.desires)}</p></div>`:''}
      ${(av.qualifiers||[]).length?`<div style="margin-bottom:8px"><strong style="font-size:.78rem;color:green;text-transform:uppercase">✅ Qualifiers</strong><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">${(av.qualifiers||[]).map(q=>`<span style="background:#dcfce7;color:#166534;border-radius:20px;padding:3px 10px;font-size:.78rem;font-weight:600">${s(q)}</span>`).join('')}</div></div>`:''}
      ${(av.disqualifiers||[]).length?`<div><strong style="font-size:.78rem;color:#dc2626;text-transform:uppercase">❌ Disqualifiers</strong><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">${(av.disqualifiers||[]).map(q=>`<span style="background:#fee2e2;color:#991b1b;border-radius:20px;padding:3px 10px;font-size:.78rem;font-weight:600">${s(q)}</span>`).join('')}</div></div>`:''}
    </div>` : '';

  // ── Qualification Script ──────────────────────────────────────────────────
  const qs = json.qualificationScript || {};
  const scriptHTML = (qs.opening || (qs.questions||[]).length) ? `
    <div class="card">
      <div class="section-title">📞 Qualification Script</div>
      ${qs.opening?`<div style="background:#f8fafc;border-left:4px solid ${color};padding:14px 16px;border-radius:4px;margin-bottom:16px;font-size:.9rem;line-height:1.7;color:#333;font-style:italic">"${s(qs.opening)}"</div>`:''}
      ${(qs.questions||[]).length?`<div style="margin-bottom:14px">${(qs.questions||[]).map((q,i)=>`
        <div style="background:#f9f9f9;border-radius:8px;padding:12px 14px;margin-bottom:8px;border-left:3px solid ${color}">
          <div style="font-weight:700;font-size:.88rem;margin-bottom:4px">Q${i+1}: ${s(q.q)}</div>
          ${q.why?`<div style="font-size:.78rem;color:#888">Why: ${s(q.why)}</div>`:''}
        </div>`).join('')}</div>`:''}
      ${(qs.objections||[]).length?`<div><div style="font-weight:700;font-size:.82rem;color:#555;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Objection Handling</div>${(qs.objections||[]).map(o=>`
        <div style="background:#fff8f0;border-radius:8px;padding:12px 14px;margin-bottom:8px">
          <div style="color:#dc2626;font-size:.85rem;margin-bottom:6px">❌ "${s(o.obj)}"</div>
          <div style="color:#166534;font-size:.85rem">✅ ${s(o.response)}</div>
        </div>`).join('')}</div>`:''}
    </div>` : '';

  // ── Positioning ───────────────────────────────────────────────────────────
  const posHTML = (json.positioning||[]).length ? `
    <div class="card">
      <div class="section-title">🏆 Positioning Strategy</div>
      ${(json.positioning||[]).map((p,i)=>`
        <div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #f0f0f0">
          <div style="font-family:monospace;font-size:1.6rem;font-weight:700;color:#e5e7eb;flex-shrink:0;line-height:1">${String(i+1).padStart(2,'0')}</div>
          <div><div style="font-weight:700;color:${color};margin-bottom:4px">${s(p.tip||'')}</div>
          <div style="font-size:.88rem;color:#555;line-height:1.6">${s(p.desc||'')}</div></div>
        </div>`).join('')}
    </div>` : '';

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpiHTML = json.kpis ? `
    <div class="card">
      <div class="section-title">📊 Performance Projections</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
        ${Object.entries(json.kpis).map(([k,v])=>`
          <div style="background:#f8fafc;border-radius:10px;padding:14px;text-align:center">
            <div style="font-size:1rem;font-weight:800;color:${color}">${s(v)}</div>
            <div style="font-size:.68rem;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-top:4px">${k.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase())}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // ── Tagline / Executive Summary ───────────────────────────────────────────
  const summaryHTML = (json.tagline || json.executiveSummary) ? `
    <div class="card">
      <div class="section-title">✨ Campaign Overview</div>
      <p class="summary" style="font-size:1rem;line-height:1.8;color:#333">${s(json.tagline||json.executiveSummary)}</p>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${s(client.businessName)} — Marketing Command Center</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',system-ui,sans-serif;color:#222;background:#f3f4f6;font-size:15px}
.header{background:linear-gradient(135deg,${color},${color}cc);color:#fff;padding:32px 40px}
.header-brand{font-size:.8rem;opacity:.85;margin-bottom:6px;font-weight:600;letter-spacing:.05em}
.header h1{font-size:1.8rem;font-weight:800;margin-bottom:4px}
.header p{opacity:.85;font-size:.9rem}
.nav-bar{background:#fff;border-bottom:1px solid #e5e7eb;padding:0 40px;display:flex;gap:2px;overflow-x:auto;position:sticky;top:0;z-index:10;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.nav-bar a{padding:14px 16px;font-size:.78rem;font-weight:600;color:#666;text-decoration:none;white-space:nowrap;border-bottom:2px solid transparent;transition:all .15s}
.nav-bar a:hover{color:#111;border-color:${color}}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;padding:28px 40px;background:#fff;border-bottom:1px solid #e5e7eb}
.stat{text-align:center}
.stat-v{font-size:1.3rem;font-weight:800;color:${color}}
.stat-l{font-size:.65rem;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-top:2px}
.container{max-width:900px;margin:0 auto;padding:32px 24px}
.card{background:#fff;border-radius:14px;padding:24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)}
.section-title{font-size:.95rem;font-weight:800;color:#111;margin-bottom:18px;padding-bottom:10px;border-bottom:2px solid ${color};display:flex;align-items:center;gap:8px}
.summary{line-height:1.8;color:#444}
footer{text-align:center;padding:40px;font-size:.78rem;color:#aaa;border-top:1px solid #e5e7eb;margin-top:20px}
@media(max-width:600px){.header{padding:24px}.stats{padding:20px}.container{padding:20px 16px}}
</style>
</head>
<body>
<div class="header">
  <div class="header-brand">${s(brand)} — Marketing Command Center</div>
  <h1>${s(client.businessName||'Your Business')}</h1>
  <p>Prepared for ${s((client.firstName||'')+' '+(client.lastName||'')).trim()||s(client.clientName||'')} · ${s(client.industry||'')} · Generated ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
  ${json.tagline?`<p style="margin-top:8px;opacity:.9;font-style:italic;font-size:.92rem">${s(json.tagline)}</p>`:''}
</div>
<nav class="nav-bar">
  ${summaryHTML?'<a href="#overview">Overview</a>':''}
  ${avatarHTML?'<a href="#avatar">Avatar</a>':''}
  ${adsHTML?'<a href="#ads">Ad Copy</a>':''}
  ${tgtItems?'<a href="#targeting">Targeting</a>':''}
  ${rmHTML?'<a href="#roadmap">Roadmap</a>':''}
  ${scriptHTML?'<a href="#script">Script</a>':''}
  ${posHTML?'<a href="#positioning">Positioning</a>':''}
  ${kpiHTML?'<a href="#kpis">KPIs</a>':''}
</nav>
<div class="stats">
  ${client.adBudget?`<div class="stat"><div class="stat-v">$${s(client.adBudget)}/day</div><div class="stat-l">Ad Budget</div></div>`:''}
  ${client.adPlatforms?`<div class="stat"><div class="stat-v">${s(client.adPlatforms)}</div><div class="stat-l">Platforms</div></div>`:''}
  ${client.avgCustomerValue?`<div class="stat"><div class="stat-v">$${s(client.avgCustomerValue)}</div><div class="stat-l">Avg Job Value</div></div>`:''}
  ${client.ageGroups?`<div class="stat"><div class="stat-v">${s(client.ageGroups)}</div><div class="stat-l">Target Ages</div></div>`:''}
  ${client.goal90||client.goal90Days?`<div class="stat"><div class="stat-v" style="font-size:.8rem">${s(client.goal90||client.goal90Days).slice(0,40)}</div><div class="stat-l">90-Day Goal</div></div>`:''}
</div>
<div class="container">
  ${summaryHTML?`<div id="overview">${summaryHTML}</div>`:''}
  ${avatarHTML?`<div id="avatar">${avatarHTML}</div>`:''}
  ${adsHTML?`<div id="ads"><div class="card"><div class="section-title">🎯 Ad Copy — ${(json.adAngles||[]).length} Angles</div>${adsHTML}</div></div>`:''}
  ${tgtItems?`<div id="targeting"><div class="card"><div class="section-title">👥 Audience Targeting</div>${tgtItems}</div></div>`:''}
  ${rmHTML?`<div id="roadmap"><div class="card"><div class="section-title">📅 90-Day Roadmap</div>${rmHTML}</div></div>`:''}
  ${scriptHTML?`<div id="script">${scriptHTML}</div>`:''}
  ${posHTML?`<div id="positioning">${posHTML}</div>`:''}
  ${kpiHTML?`<div id="kpis">${kpiHTML}</div>`:''}
  <div class="card" style="text-align:center;padding:40px;background:linear-gradient(135deg,#fff,#f8fafc);border:2px solid ${color}33">
    <h2 style="font-size:1.4rem;font-weight:800;margin-bottom:10px">Ready to Launch? 🚀</h2>
    <p style="color:#666;margin-bottom:20px">Your Marketing Command Center for ${s(client.businessName||'your business')} is live.</p>
    <a href="${agency.bookingUrl||'#'}" style="display:inline-block;background:${color};color:#fff;padding:12px 32px;border-radius:50px;text-decoration:none;font-weight:700;font-size:.95rem">📅 Schedule Strategy Call</a>
  </div>
</div>
<footer>Marketing Command Center · ${s(client.businessName||'')} · Powered by ${s(brand)}</footer>
</body>
</html>`;
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
