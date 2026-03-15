// netlify/functions/agency-serve-plan.js v2
// Plan renderer — reads dashboardJSON from Firestore, renders full marketing plan
// Handles both new format (tagline/adAngles/roadmap.phase) and old format
import https from 'https';
import crypto from 'crypto';

function tok() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const b64 = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now = Math.floor(Date.now()/1000);
    const h = b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const p = b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const s = b64(crypto.createSign('RSA-SHA256').update(h+'.'+p).sign(key));
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${s}`;
    const r = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error(d));});
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

function fsGet(path, token) {
  return new Promise((resolve,reject)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); r.end();
  });
}

function fromFS(v) {
  if(!v) return null;
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return Number(v.integerValue);
  if('booleanValue' in v) return v.booleanValue;
  if('nullValue' in v) return null;
  if('arrayValue' in v) return (v.arrayValue.values||[]).map(fromFS);
  if('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,val])=>[k,fromFS(val)]));
  return null;
}

function esc(v) { return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function renderPlan(j, client, agency, agencyId, clientId) {
  const brand = agency.brandName||agency.name||'Your Agency';
  const color = agency.brandColor||'#f97316';
  const dark  = '#0a0a0f';
  const s = esc;

  // ── Ad Angles ───────────────────────────────────────────────────────────────
  const adsHTML = (j.adAngles||[]).map(a => {
    const label = a.angleLabel || a.angle || '';
    const cards = (a.ads||[]).map(ad => `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:12px">
        ${ad.title?`<div style="font-size:11px;font-weight:700;color:#999;text-transform:uppercase;margin-bottom:8px">${s(ad.title)}</div>`:''}
        <p style="font-weight:800;font-size:1.05rem;color:#111;margin:0 0 10px">${s(ad.headline||'')}</p>
        <p style="color:#444;line-height:1.75;font-size:.92rem;margin:0 0 10px">${s(ad.primaryText||'')}</p>
        ${ad.description?`<p style="color:#888;font-size:.82rem;margin:0 0 8px;font-style:italic">${s(ad.description)}</p>`:''}
        ${ad.cta?`<span style="background:${color};color:#fff;padding:6px 14px;border-radius:6px;font-weight:700;font-size:.82rem;display:inline-block">${s(ad.cta)}</span>`:''}
      </div>`).join('');
    return `<div style="margin-bottom:28px">
      <div style="background:${color}20;border-left:3px solid ${color};padding:5px 12px;display:inline-block;font-size:.78rem;font-weight:700;margin-bottom:10px;border-radius:0 4px 4px 0;color:${dark}">${s(label)}</div>
      ${cards}</div>`;
  }).join('');

  // ── Roadmap ──────────────────────────────────────────────────────────────────
  const rmHTML = (j.roadmap||[]).map(r => `
    <div style="display:flex;gap:18px;padding:14px 0;border-bottom:1px solid #f0f0f0">
      <div style="font-weight:700;color:${color};min-width:90px;font-size:.82rem;flex-shrink:0;padding-top:2px">${s(r.phase||r.week||'')}</div>
      <div><div style="font-weight:700;margin-bottom:4px">${s(r.title||'')}</div><div style="color:#666;font-size:.88rem;line-height:1.6">${s(r.desc||'')}</div></div>
    </div>`).join('');

  // ── Targeting ────────────────────────────────────────────────────────────────
  const tgt = j.targeting||{};
  const tgtHTML = Object.entries(tgt).filter(([,v])=>v&&(Array.isArray(v)?v.length:true)).map(([k,v])=>{
    const items = Array.isArray(v)?v:(typeof v==='object'?(v.items||[]):[String(v)]);
    if(!items.length) return '';
    const label = k.charAt(0).toUpperCase()+k.slice(1).replace(/([A-Z])/g,' $1');
    return `<div style="margin-bottom:14px">
      <div style="font-size:.68rem;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">${s(label)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${items.map(i=>`<span style="background:#f3f4f6;border-radius:20px;padding:3px 10px;font-size:.78rem">${s(i)}</span>`).join('')}</div>
    </div>`;
  }).join('');

  // ── Avatar ───────────────────────────────────────────────────────────────────
  const av = j.avatar||{};
  const avatarHTML = (av.whoTheyAre||av.painPoints) ? `
    <div class="card">
      <div class="card-title">👤 Ideal Client${av.name?` — ${s(av.name)}`:''}</div>
      ${av.whoTheyAre?`<p style="margin:0 0 10px;color:#444;line-height:1.7">${s(av.whoTheyAre)}</p>`:''}
      ${av.painPoints?`<p style="margin:0 0 10px;color:#444;line-height:1.7"><strong>Pain:</strong> ${s(av.painPoints)}</p>`:''}
      ${av.desires?`<p style="margin:0 0 10px;color:#444;line-height:1.7"><strong>Wants:</strong> ${s(av.desires)}</p>`:''}
      ${(av.qualifiers||[]).length?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">${av.qualifiers.map(q=>`<span style="background:#dcfce7;color:#166534;border-radius:20px;padding:3px 10px;font-size:.75rem;font-weight:600">✓ ${s(q)}</span>`).join('')}</div>`:''}
      ${(av.disqualifiers||[]).length?`<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">${av.disqualifiers.map(q=>`<span style="background:#fee2e2;color:#991b1b;border-radius:20px;padding:3px 10px;font-size:.75rem;font-weight:600">✗ ${s(q)}</span>`).join('')}</div>`:''}
    </div>` : '';

  // ── Qualification Script ──────────────────────────────────────────────────────
  const qs = j.qualificationScript||{};
  const scriptHTML = (qs.opening||(qs.questions||[]).length) ? `
    <div class="card">
      <div class="card-title">📞 Qualification Script</div>
      ${qs.opening?`<div style="background:#f8fafc;border-left:3px solid ${color};padding:12px 14px;border-radius:0 6px 6px 0;margin-bottom:14px;font-style:italic;color:#333;line-height:1.7">"${s(qs.opening)}"</div>`:''}
      ${(qs.questions||[]).map((q,i)=>`<div style="background:#f9fafb;border-radius:8px;padding:11px 14px;margin-bottom:8px"><strong>Q${i+1}:</strong> ${s(q.q||q)}${q.why?`<div style="font-size:.75rem;color:#888;margin-top:3px">Why: ${s(q.why)}</div>`:''}</div>`).join('')}
      ${(qs.objections||[]).length?`<div style="margin-top:14px">${(qs.objections||[]).map(o=>`<div style="background:#fff8f0;border-radius:8px;padding:11px 14px;margin-bottom:8px"><div style="color:#dc2626;font-size:.85rem;margin-bottom:5px">❌ "${s(o.obj)}"</div><div style="color:#166534;font-size:.85rem">✅ ${s(o.response)}</div></div>`).join('')}</div>`:''}
    </div>` : '';

  // ── Positioning ───────────────────────────────────────────────────────────────
  const posHTML = (j.positioning||[]).length ? `
    <div class="card">
      <div class="card-title">🏆 Positioning</div>
      ${(j.positioning||[]).map(p=>`<div style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong style="color:${color}">${s(p.tip||'')}</strong><div style="color:#555;font-size:.88rem;margin-top:3px;line-height:1.6">${s(p.desc||'')}</div></div>`).join('')}
    </div>` : '';

  // ── KPIs ──────────────────────────────────────────────────────────────────────
  const kpiHTML = j.kpis ? `
    <div class="card">
      <div class="card-title">📊 Projections</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">
        ${Object.entries(j.kpis).map(([k,v])=>`
          <div style="background:#f8fafc;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:.95rem;font-weight:800;color:${color}">${s(v)}</div>
            <div style="font-size:.62rem;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-top:3px">${k.replace(/([A-Z])/g,' $1').trim()}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // ── Funnel ────────────────────────────────────────────────────────────────────
  const funnelHTML = (j.funnelSteps||[]).length ? `
    <div class="card">
      <div class="card-title">🔁 Funnel Steps</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${(j.funnelSteps||[]).map((f,i)=>`
          <div style="background:#f8fafc;border-radius:10px;padding:12px 14px;flex:1;min-width:140px">
            <div style="font-size:1.2rem;margin-bottom:4px">${s(f.icon||'')}</div>
            <div style="font-weight:700;font-size:.82rem">${s(f.step||'')}</div>
            <div style="font-size:.75rem;color:#666;margin-top:3px;line-height:1.5">${s(f.desc||'')}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // ── Executive Summary / Tagline ───────────────────────────────────────────────
  const hasError = (j.tagline||j.executiveSummary||'').toLowerCase().includes('issue') ||
                   (j.tagline||j.executiveSummary||'').toLowerCase().includes('failed');
  const summaryHTML = (j.tagline||j.executiveSummary) ? `
    <div class="card" ${hasError?'style="border:2px solid #fbbf24;background:#fffbeb"':''}>
      <div class="card-title">${hasError?'⚠️ Generation Issue':'✨ Campaign Overview'}</div>
      <p style="font-size:1rem;line-height:1.8;color:#333;margin:0 0 ${hasError?'16px':'0'}">${s(j.tagline||j.executiveSummary)}</p>
      ${hasError?`<a href="javascript:history.back()" style="display:inline-block;background:#f97316;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;font-size:.88rem;margin-right:8px">← Go Back</a>
      <span style="font-size:.8rem;color:#888">Or contact support to regenerate this plan.</span>`:''}
    </div>` : '';

  // ── Stats bar ────────────────────────────────────────────────────────────────
  const stats = [
    client.adBudget    && [`$${s(client.adBudget)}/day`, 'Budget'],
    client.adPlatforms && [s(client.adPlatforms),        'Platforms'],
    client.industry    && [s(client.industry),           'Industry'],
    (client.goal90||client.goal90Days) && [s((client.goal90||client.goal90Days).slice(0,35)), '90-Day Goal'],
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${s(client.businessName||'Marketing Plan')} — ${s(brand)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',system-ui,sans-serif;background:#f3f4f6;color:#111}
.hdr{background:linear-gradient(135deg,${color},${color}cc);color:#fff;padding:32px 40px}
.hdr-brand{font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.85;margin-bottom:6px}
.hdr h1{font-size:1.8rem;font-weight:800}
.hdr-sub{opacity:.85;font-size:.9rem;margin-top:4px}
.hdr-tagline{margin-top:10px;opacity:.9;font-style:italic;font-size:.92rem}
.stats{background:#fff;border-bottom:1px solid #e5e7eb;display:flex;flex-wrap:wrap;padding:0 40px}
.stat{padding:14px 20px 14px 0;margin-right:20px;border-right:1px solid #e5e7eb}
.stat:last-child{border:none}
.stat-v{font-size:.95rem;font-weight:800;color:${color}}
.stat-l{font-size:.6rem;color:#888;text-transform:uppercase;letter-spacing:.08em;margin-top:2px}
.nav{background:#fff;border-bottom:1px solid #e5e7eb;padding:0 40px;display:flex;gap:2px;overflow-x:auto;position:sticky;top:0;z-index:10;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.nav a{padding:13px 14px;font-size:.78rem;font-weight:600;color:#666;text-decoration:none;white-space:nowrap;border-bottom:2px solid transparent}
.nav a:hover{color:#111;border-color:${color}}
.wrap{max-width:900px;margin:0 auto;padding:28px 20px}
.card{background:#fff;border-radius:12px;padding:22px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.card-title{font-size:.9rem;font-weight:800;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid ${color}}
footer{text-align:center;padding:32px;font-size:.75rem;color:#aaa;border-top:1px solid #e5e7eb;background:#fff;margin-top:10px}
@media(max-width:600px){.hdr,.stats,.nav{padding-left:16px;padding-right:16px}.wrap{padding:16px 12px}}
</style>
</head>
<body>
<div class="hdr">
  <div class="hdr-brand">${s(brand)}</div>
  <h1>${s(client.businessName||'Your Business')}</h1>
  <div class="hdr-sub">AI Marketing Command Center · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>
  ${j.tagline?`<div class="hdr-tagline">${s(j.tagline)}</div>`:''}
</div>
${stats.length?`<div class="stats">${stats.map(([v,l])=>`<div class="stat"><div class="stat-v">${v}</div><div class="stat-l">${l}</div></div>`).join('')}</div>`:''}
<nav class="nav">
  ${summaryHTML?'<a href="#overview">Overview</a>':''}
  ${avatarHTML?'<a href="#avatar">Avatar</a>':''}
  ${funnelHTML?'<a href="#funnel">Funnel</a>':''}
  ${adsHTML?'<a href="#ads">Ad Copy</a>':''}
  ${tgtHTML?'<a href="#targeting">Targeting</a>':''}
  ${rmHTML?'<a href="#roadmap">Roadmap</a>':''}
  ${scriptHTML?'<a href="#script">Script</a>':''}
  ${posHTML?'<a href="#positioning">Positioning</a>':''}
  ${kpiHTML?'<a href="#kpis">KPIs</a>':''}
</nav>
<div class="wrap">
  ${summaryHTML?`<div id="overview">${summaryHTML}</div>`:''}
  ${avatarHTML?`<div id="avatar">${avatarHTML}</div>`:''}
  ${funnelHTML?`<div id="funnel">${funnelHTML}</div>`:''}
  ${adsHTML?`<div id="ads"><div class="card"><div class="card-title">🎯 Ad Copy</div>${adsHTML}</div></div>`:''}
  ${tgtHTML?`<div id="targeting"><div class="card"><div class="card-title">👥 Audience Targeting</div>${tgtHTML}</div></div>`:''}
  ${rmHTML?`<div id="roadmap"><div class="card"><div class="card-title">📅 90-Day Roadmap</div>${rmHTML}</div></div>`:''}
  ${scriptHTML?`<div id="script">${scriptHTML}</div>`:''}
  ${posHTML?`<div id="positioning">${posHTML}</div>`:''}
  ${kpiHTML?`<div id="kpis">${kpiHTML}</div>`:''}
  <div class="card" style="text-align:center;padding:36px;background:linear-gradient(135deg,#fff,#fafafa);border:2px solid ${color}30">
    <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:8px">Ready to Launch? 🚀</h2>
    <p style="color:#666;margin-bottom:18px">Your Marketing Command Center for ${s(client.businessName||'your business')} is live.</p>
    ${agency.bookingUrl?`<a href="${s(agency.bookingUrl)}" style="background:${color};color:#fff;padding:11px 28px;border-radius:50px;text-decoration:none;font-weight:700;font-size:.92rem;display:inline-block;margin-right:8px">📅 Schedule Strategy Call</a>`:''}
    <button onclick="regeneratePlan()" style="background:#f3f4f6;color:#444;border:1px solid #e5e7eb;padding:10px 20px;border-radius:50px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:inherit">⚡ Regenerate Plan</button>
  </div>
  <script>
  function regeneratePlan() {
    if(!confirm('Regenerate this marketing plan? This will take ~20 seconds.')) return;
    const btn = document.querySelector('button[onclick="regeneratePlan()"]');
    btn.textContent = '⏳ Regenerating...'; btn.disabled = true;
    fetch('/api/agency/process-plan', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        agencyId: '${agencyId}', clientId: '${clientId}',
        firstName: '${s(client.firstName||'')}', lastName: '${s(client.lastName||'')}',
        email: '${s(client.clientEmail||'')}', businessName: '${s(client.businessName||'')}',
        phone: '${s(client.phone||'')}', industry: '${s(client.industry||'')}',
        primaryService: '${s(client.primaryService||'')}', adBudget: '${s(client.adBudget||'')}',
        adPlatforms: '${s(client.adPlatforms||'')}', goal90Days: '${s(client.goal90||client.goal90Days||'')}',
        standOut: '${s(client.standOut||'')}', promotions: '${s(client.promotions||'')}',
        serviceDetails: '${s(client.serviceDetails||'')}', idealCustomer: '${s(client.idealCustomer||'')}',
        qualifyingQuestions: '${s(client.qualifyingQuestions||'')}', avgCustomerValue: '${s(client.avgCustomerValue||'')}',
        workedWell: '${s(client.workedWell||'')}',
      })
    }).then(r => r.json()).then(d => {
      if(d.success) { setTimeout(() => location.reload(), 25000); btn.textContent = '⏳ Generating (~25s)...'; }
      else { btn.textContent = '❌ Failed — try again'; btn.disabled = false; }
    }).catch(() => { btn.textContent = '❌ Error — try again'; btn.disabled = false; });
  }
  </script>
</div>
<footer>${s(brand)} · Marketing Command Center · ${s(client.businessName||'')}</footer>
</body>
</html>`;
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const agencyId = parts[1];
  const clientId = parts[2];

  const H = {'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-cache'};

  if (!agencyId || !clientId) {
    return new Response('<html><body style="font-family:sans-serif;padding:40px"><h2>Invalid URL</h2></body></html>', {status:400,headers:H});
  }

  try {
    const token = await tok();

    // Get client doc
    const clientDoc = await fsGet(`agencies/${agencyId}/clients/${clientId}`, token);
    if (!clientDoc.fields) {
      return new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="10"><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f3f4f6;text-align:center}.box{background:#fff;border-radius:16px;padding:48px 40px;max-width:460px;box-shadow:0 4px 24px rgba(0,0,0,.08)}.spinner{width:40px;height:40px;border:3px solid #eee;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 20px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spinner"></div><h2 style="font-size:1.3rem;font-weight:800;color:#111;margin-bottom:8px">Building Your Plan...</h2><p style="color:#666;line-height:1.6;font-size:.9rem">Your AI marketing plan is being generated. This page refreshes every 10 seconds.</p><p style="color:#aaa;font-size:.8rem;margin-top:12px">Taking longer than expected? Check your email — we'll send it when ready.</p></div></body></html>`, {status:200,headers:H});
    }

    const client = {};
    for (const [k,v] of Object.entries(clientDoc.fields)) client[k] = fromFS(v);

    const dj = client.dashboardJSON;
    if (!dj || dj === '{}') {
      return new Response(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="10"><style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f3f4f6;text-align:center}.box{background:#fff;border-radius:16px;padding:48px 40px;max-width:460px;box-shadow:0 4px 24px rgba(0,0,0,.08)}.spinner{width:40px;height:40px;border:3px solid #eee;border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 20px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spinner"></div><h2 style="font-size:1.3rem;font-weight:800;color:#111;margin-bottom:8px">Building Your Plan...</h2><p style="color:#666;line-height:1.6;font-size:.9rem">Your AI marketing plan is being generated. This page refreshes every 10 seconds.</p><p style="color:#aaa;font-size:.8rem;margin-top:12px">Taking longer than expected? Check your email — we'll send it when ready.</p></div></body></html>`, {status:200,headers:H});
    }

    let json = {};
    try { json = JSON.parse(dj); } catch(e) { json = {}; }

    // Get agency branding
    const agencyDoc = await fsGet(`agencies/${agencyId}`, token);
    const agency = {};
    if (agencyDoc.fields) for (const [k,v] of Object.entries(agencyDoc.fields)) agency[k] = fromFS(v);

    return new Response(renderPlan(json, client, agency, agencyId, clientId), {status:200, headers:H});

  } catch(e) {
    console.error('[serve-plan]', e.message);
    return new Response(`<html><body style="font-family:sans-serif;padding:40px"><h2>Error</h2><p>${e.message}</p></body></html>`, {status:500,headers:H});
  }
};

export const config = {
  path: '/plans/:agencyId/:clientId',
};
