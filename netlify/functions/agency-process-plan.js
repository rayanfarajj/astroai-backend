// netlify/functions/agency-process-plan.js
// POST /api/agency/process-plan
// Generates an AI marketing plan and saves it under /agencies/{agencyId}/clients/{clientId}
// Uses SHARED Anthropic + OpenAI keys (Tier 1 model)

const https      = require('https');
const { fsGet, fsSetSub, fsGetSub } = require('./_firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  'Content-Type': 'application/json',
};

// ── CLAUDE PROMPT ──────────────────────────────────────────────
function buildPrompt(d, agency) {
  return `You are an expert digital marketing strategist. Generate a comprehensive AI marketing plan for the following business. Return ONLY valid JSON, no markdown, no explanation.

BUSINESS INFO:
- Business Name: ${d.businessName}
- Owner: ${d.firstName} ${d.lastName}
- Industry: ${d.industry}
- Primary Service: ${d.primaryService}
- Monthly Ad Budget: $${d.adBudget}
- Ad Platforms: ${d.adPlatforms}
- Service Area: ${d.serviceAreaType} — ${d.serviceDetails}
- Website: ${d.website || 'none'}
- Team Size: ${d.companySize}
- 90-Day Goal: ${d.goal90Days}
- Agency: ${agency.name}

Return this exact JSON structure:
{
  "executiveSummary": "2-3 sentence overview",
  "adAngles": [
    {
      "angleLabel": "Empathy",
      "ads": [
        {"title":"Version A","primaryText":"3-4 compelling sentences","headline":"short punchy headline under 40 chars","description":"one line benefit statement","cta":"Book Free Estimate"}
      ]
    },
    {"angleLabel":"Pain Points","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."},{"title":"Version B","primaryText":"...","headline":"...","description":"...","cta":"..."}]},
    {"angleLabel":"Proof","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."}]},
    {"angleLabel":"Curiosity","ads":[{"title":"Version A","primaryText":"...","headline":"...","description":"...","cta":"..."}]},
    {"angleLabel":"Retargeting","ads":[{"title":"Warm Lead","primaryText":"...","headline":"...","description":"...","cta":"..."},{"title":"Last Chance","primaryText":"...","headline":"...","description":"...","cta":"..."}]}
  ],
  "targeting": {
    "demographics": ["Age 28-55","Homeowners","HHI $60k+"],
    "interests1": {"label":"Primary Interests","items":["Home Improvement","Property Management","..."]},
    "interests2": {"label":"Secondary Interests","items":["DIY","Local Events","..."]},
    "behaviors": ["Recent movers","Online shoppers","..."],
    "custom": ["Website visitors","Email list","..."],
    "lookalike": ["1% lookalike of customers","..."]
  },
  "roadmap": [
    {"week":"Week 1-2","title":"Foundation","desc":"Set up tracking, build audiences, launch awareness campaigns"},
    {"week":"Week 3-4","title":"Launch","desc":"Activate all ad angles, A/B test creatives"},
    {"week":"Week 5-8","title":"Optimize","desc":"Kill underperformers, scale winners, add retargeting"},
    {"week":"Week 9-12","title":"Scale","desc":"Increase budget on proven winners, expand to lookalike audiences"}
  ],
  "qualificationScript": {
    "opening": "Hi [Name], this is [Agent] from ${d.businessName}. I'm reaching out because you expressed interest in our services — do you have 2 minutes?",
    "transition": "Great! I have a few quick questions to make sure we're the right fit for you.",
    "questions": [
      {"q":"What's the main challenge you're trying to solve right now?","why":"Uncover pain point"},
      {"q":"Have you worked with a company like ours before?","why":"Gauge experience"},
      {"q":"What's your timeline for getting this handled?","why":"Qualify urgency"},
      {"q":"Do you own or rent your property?","why":"Qualify decision maker"},
      {"q":"What's most important to you — price, speed, or quality?","why":"Uncover priority"}
    ],
    "objections": [
      {"obj":"I need to think about it","response":"Totally understand. What specific concern can I address right now to help you decide?"},
      {"obj":"It's too expensive","response":"I get that. Let me ask — what would it cost you NOT to fix this? Most clients find the ROI pays for itself in the first month."},
      {"obj":"I'm already working with someone","response":"That's great! Are you 100% happy with their results? We work with a lot of clients who came to us after their first agency underdelivered."}
    ]
  },
  "kpis": {
    "cpl": "Target cost per lead: $15-$35",
    "ctr": "Target CTR: 1.5-3%",
    "roas": "Target ROAS: 3-5x",
    "monthlyLeads": "Projected leads/month: 40-80"
  }
}`;
}

// ── CALL CLAUDE ─────────────────────────────────────────────────
async function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          resolve(r.content?.[0]?.text || '');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ── SAVE TO GITHUB ──────────────────────────────────────────────
async function saveToGitHub(slug, agencyId, html) {
  const path    = `public/plans/${agencyId}/${slug}.html`;
  const content = Buffer.from(html).toString('base64');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message: `Plan: ${agencyId}/${slug}`, content });
    const req  = https.request({
      hostname: 'api.github.com',
      path: `/repos/rayanfarajj/astroai-backend/contents/${path}`,
      method: 'PUT',
      headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'AstroAI', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

// ── BUILD PLAN HTML ─────────────────────────────────────────────
function buildPlanHTML(json, data, agency) {
  const safe   = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const brand  = agency.brandName || agency.name || 'Astro AI';
  const color  = agency.brandColor || '#00d9a3';

  const adSections = (json.adAngles || []).map(angle => `
    <div class="angle-section">
      <div class="angle-label" style="background:rgba(0,0,0,.06);border-radius:20px;padding:4px 14px;display:inline-block;font-size:.75rem;font-weight:700;color:#444;margin-bottom:12px">${safe(angle.angleLabel)}</div>
      ${(angle.ads || []).map(ad => `
        <div class="ad-card" style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:10px">
          <div class="ad-card-body">
            <div style="font-size:.68rem;font-weight:700;color:#999;margin-bottom:8px;text-transform:uppercase">${safe(ad.title||'')}</div>
            <p style="margin:0 0 8px;font-size:.85rem;line-height:1.6;color:#333">${safe(ad.primaryText||'')}</p>
            <p class="headline" style="font-weight:700;font-size:.9rem;color:#111;margin:6px 0">${safe(ad.headline||'')}</p>
            <p style="font-size:.8rem;color:#555;margin:4px 0">${safe(ad.description||'')}</p>
            <p style="font-size:.78rem;color:${color};font-weight:700;margin:6px 0">${safe(ad.cta||'')}</p>
          </div>
          <button onclick="copyAd(this)" style="margin-top:10px;padding:5px 12px;background:${color};color:#fff;border:none;border-radius:5px;font-size:.72rem;cursor:pointer">📋 Copy</button>
        </div>`).join('')}
    </div>`).join('');

  const roadmapHTML = (json.roadmap || []).map(r =>
    `<div style="display:flex;gap:16px;padding:12px 0;border-bottom:1px solid #eee">
      <div style="font-weight:700;color:${color};min-width:80px;font-size:.78rem">${safe(r.week||'')}</div>
      <div><div style="font-weight:700;font-size:.85rem">${safe(r.title||'')}</div><div style="font-size:.8rem;color:#555;margin-top:2px">${safe(r.desc||'')}</div></div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safe(data.businessName)} — Marketing Plan | ${safe(brand)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222;background:#fff;font-size:14px}
.header{background:${color};color:#fff;padding:28px 32px}
.header h1{font-size:1.5rem;font-weight:800;margin-bottom:4px}
.header p{opacity:.85;font-size:.9rem}
.container{max-width:860px;margin:0 auto;padding:32px 24px}
.section{margin-bottom:32px}
.section-title{font-size:1rem;font-weight:800;color:#111;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid ${color}}
.badge{background:${color}20;color:${color};border-radius:20px;padding:3px 10px;font-size:.72rem;font-weight:700;display:inline-block;margin:3px}
.kpi-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.kpi-card{background:#f5f5f5;border-radius:8px;padding:14px}
.kpi-val{font-size:1.1rem;font-weight:800;color:${color}}
.kpi-lbl{font-size:.7rem;color:#777;margin-top:2px}
footer{text-align:center;padding:24px;font-size:.72rem;color:#aaa;border-top:1px solid #eee;margin-top:40px}
</style>
</head>
<body>
<div class="header">
  <div style="font-size:.8rem;opacity:.7;margin-bottom:4px">${safe(brand)}</div>
  <h1>${safe(data.businessName)}</h1>
  <p>AI Marketing Plan · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
</div>
<div class="container">
  <div class="section">
    <div class="section-title">Executive Summary</div>
    <p style="line-height:1.75;color:#444">${safe(json.executiveSummary||'')}</p>
  </div>
  <div class="section">
    <div class="section-title">Ad Copy</div>
    ${adSections}
  </div>
  <div class="section">
    <div class="section-title">Audience Targeting</div>
    ${Object.entries(json.targeting || {}).map(([k,v]) => {
      const items = Array.isArray(v) ? v : (v?.items || []);
      const label = v?.label || k.replace(/([A-Z])/g,' $1').trim();
      if (!items.length) return '';
      return `<div style="margin-bottom:12px"><div style="font-size:.7rem;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:6px">${safe(label)}</div>${items.map(i=>`<span class="badge">${safe(i)}</span>`).join('')}</div>`;
    }).join('')}
  </div>
  <div class="section">
    <div class="section-title">90-Day Roadmap</div>
    ${roadmapHTML}
  </div>
  ${json.kpis ? `<div class="section">
    <div class="section-title">Target KPIs</div>
    <div class="kpi-grid">
      ${Object.entries(json.kpis).map(([,v])=>`<div class="kpi-card"><div class="kpi-val">${safe(String(v).split(':')[1]||v)}</div><div class="kpi-lbl">${safe(String(v).split(':')[0])}</div></div>`).join('')}
    </div>
  </div>` : ''}
</div>
<footer>Powered by ${safe(brand)} · Astro AI Platform</footer>
<script>
function copyAd(btn){
  const body=btn.closest('.ad-card-body');
  const ps=[...body.querySelectorAll('p')].map(p=>p.textContent);
  navigator.clipboard.writeText(ps.join('\\n\\n')).then(()=>{btn.textContent='✅ Copied!';setTimeout(()=>btn.textContent='📋 Copy',2000)});
}
</script>
</body>
</html>`;
}

// ── SEND WELCOME EMAIL ──────────────────────────────────────────
async function sendWelcome(agency, client, planUrl, portalUrl) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({ service:'gmail', auth:{ user:process.env.GMAIL_USER, pass:process.env.GMAIL_PASS } });
  const brand = agency.brandName || agency.name || 'Astro AI';
  const color = agency.brandColor || '#00d9a3';
  await transporter.sendMail({
    from: `"${brand}" <${process.env.GMAIL_USER}>`,
    to: client.clientEmail,
    subject: `🎉 Your AI Marketing Plan is Ready, ${client.firstName}!`,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
      <h2 style="color:${color}">${brand}</h2>
      <p>Hi ${client.firstName},</p>
      <p>Your personalized AI marketing plan for <strong>${client.businessName}</strong> is ready!</p>
      ${agency.welcomeMsg ? `<p>${agency.welcomeMsg}</p>` : ''}
      <div style="margin:24px 0">
        <a href="${planUrl}" style="background:${color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin-right:12px">📊 View Plan</a>
        <a href="${portalUrl}" style="background:#f5f5f5;color:#333;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">👤 Your Portal</a>
      </div>
      <p style="color:#888;font-size:12px">Powered by Astro AI · ${brand}</p>
    </div>`,
  });
}

// ── MAIN ────────────────────────────────────────────────────────
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };

  let data;
  try { data = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { agencyId } = data;
  if (!agencyId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'agencyId required' }) };

  // Validate required fields
  const required = ['firstName','lastName','email','businessName','industry','primaryService','adBudget','adPlatforms','goal90Days'];
  for (const f of required) {
    if (!data[f]) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `${f} is required` }) };
  }

  try {
    const agency = await fsGet('agencies', agencyId);
    if (!agency) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Agency not found' }) };
    if (agency.status === 'suspended') return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'Agency suspended' }) };

    // Build client record
    const clientId = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)
      + '-' + Date.now().toString(36);

    const clientData = {
      agencyId,
      clientId,
      firstName:      data.firstName,
      lastName:       data.lastName,
      clientName:     `${data.firstName} ${data.lastName}`.trim(),
      clientEmail:    data.email,
      businessName:   data.businessName,
      phone:          data.phone || '',
      industry:       data.industry,
      primaryService: data.primaryService,
      adBudget:       data.adBudget,
      adPlatforms:    data.adPlatforms,
      serviceAreaType:data.serviceAreaType || '',
      serviceDetails: data.serviceDetails || '',
      website:        data.website || '',
      companySize:    data.companySize || '',
      goal90:         data.goal90Days,
      status:         'new',
      statusLabel:    '🆕 New',
      createdAt:      new Date().toISOString(),
      dashboardURL:   '',
      dashboardJSON:  '{}',
      notes:          '',
    };

    // Save initial record immediately
    await fsSetSub(agencyId, 'clients', clientId, clientData);

    // Generate AI plan
    console.log(`[agency-process-plan] Generating plan for ${data.businessName} (agency: ${agencyId})`);
    const rawJSON = await callClaude(buildPrompt(data, agency));

    let dashJSON = {};
    try {
      const cleaned = rawJSON.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim();
      dashJSON = JSON.parse(cleaned);
    } catch(e) {
      console.error('[agency-process-plan] JSON parse failed:', e.message);
      // Try extracting JSON block
      const m = rawJSON.match(/\{[\s\S]*\}/);
      if (m) { try { dashJSON = JSON.parse(m[0]); } catch(e2) {} }
    }

    // Build HTML plan
    const planHTML   = buildPlanHTML(dashJSON, data, agency);
    const planSlug   = clientId;
    const planUrl    = `https://marketingplan.astroaibots.com/plans/${agencyId}/${planSlug}.html`;
    const portalUrl  = `https://marketingplan.astroaibots.com/onboard/portal?a=${agencyId}&s=${clientId}`;

    // Save plan to GitHub
    try { await saveToGitHub(planSlug, agencyId, planHTML); } 
    catch(e) { console.error('[agency-process-plan] GitHub save failed:', e.message); }

    // Update client record with plan data
    await fsSetSub(agencyId, 'clients', clientId, {
      ...clientData,
      dashboardUrl:  planUrl,
      dashboardJSON: JSON.stringify(dashJSON),
      status:        'active',
      statusLabel:   '📋 Plan Ready',
      generatedAt:   new Date().toISOString(),
    });

    // Update agency client count
    await fsGet('agencies', agencyId).then(a => {
      if (a) fsGet('agencies', agencyId).then(ag => {
        // Simple: just let it be, count dynamically
      });
    }).catch(() => {});

    // Send welcome email
    try { await sendWelcome(agency, { ...clientData, firstName: data.firstName }, planUrl, portalUrl); }
    catch(e) { console.error('[agency-process-plan] Welcome email failed:', e.message); }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, clientId, planUrl, portalUrl }) };

  } catch(err) {
    console.error('[agency-process-plan]', err.message, err.stack);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
