// netlify/functions/process-plan.js
// Heavy worker — does GPT + Claude + GitHub + PDF + Email
// Called by generate-plan.js via HTTP — has its own 180s timeout

const nodemailer = require('nodemailer');
const https      = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  'Content-Type':                 'application/json',
};

 ────────────────────────────────────────────
function callGPT(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 3000,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: `You are an elite digital marketing strategist at Astro A.I. Marketing. 
You create highly detailed, actionable, personalized marketing plans for small and medium businesses.
Your plans are professional, specific, and immediately usable.
Always write in clear sections with headers. Be specific — use the client's actual business name, service, location, and budget in every section.
Never use generic filler. Every recommendation must be tailored to THIS client.`,
        },
        { role: 'user', content: prompt },
      ],
    });

    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}


// ── Claude API call for Marketing Command Center HTML ─────
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.content[0].text);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── GitHub — save HTML file to repo/public/ ───────────────
function saveToGitHub(slug, html) {
  return new Promise((resolve, reject) => {
    const token  = process.env.GITHUB_TOKEN;
    const repo   = 'rayanfarajj/astroai-backend';
    const path   = `public/${slug}.html`;
    const content = Buffer.from(html, 'utf8').toString('base64');

    if (!token) {
      console.warn('GITHUB_TOKEN not set — skipping GitHub save');
      return resolve(null);
    }

    // First check if file exists to get its SHA (required for updates)
    const getOptions = {
      hostname: 'api.github.com',
      path:     `/repos/${repo}/contents/${path}`,
      method:   'GET',
      headers:  {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    'astroai-bots',
        'Accept':        'application/vnd.github+json',
      },
    };

    const doSave = (sha) => {
      const body = JSON.stringify({
        message: `Add marketing plan: ${slug}`,
        content,
        ...(sha ? { sha } : {}),
      });

      const putOptions = {
        hostname: 'api.github.com',
        path:     `/repos/${repo}/contents/${path}`,
        method:   'PUT',
        headers:  {
          'Authorization': `Bearer ${token}`,
          'User-Agent':    'astroai-bots',
          'Accept':        'application/vnd.github+json',
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(putOptions, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          console.log('GitHub save status:', res.statusCode);
          resolve(res.statusCode);
        });
      });
      req.on('error', e => { console.warn('GitHub save error:', e.message); resolve(null); });
      req.write(body);
      req.end();
    };

    // Try to get existing file SHA
    const getReq = https.request(getOptions, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            console.log('File exists, updating with SHA:', json.sha.slice(0,8));
            doSave(json.sha);
          } catch(e) { doSave(null); }
        } else {
          console.log('New file, creating...');
          doSave(null);
        }
      });
    });
    getReq.on('error', () => doSave(null));
    getReq.end();
  });
}

// ── Build Claude prompt — returns JSON content only ────────
function buildDashboardPrompt(d, planText) {
  const businessName  = d.businessName || d.authSignerBusiness || 'Your Business';
  const ownerName     = `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.authSignerName || 'Owner';
  const industry      = d.industry || 'N/A';
  const primaryService= d.primaryService || 'N/A';
  const bizDesc       = d.bizDescription || 'N/A';
  const companySize   = d.companySize || 'N/A';
  const website       = d.website || 'N/A';
  const serviceArea   = `${d.serviceAreaType || ''} — ${d.serviceDetails || 'N/A'}`;
  const idealCustomer = d.idealCustomer || 'N/A';
  const ageGroups     = d.ageGroups || 'N/A';
  const genderPref    = d.genderPref || 'All genders';
  const interests     = d.interests || 'N/A';
  const mainGoal      = d.mainGoal || 'N/A';
  const avgValue      = d.avgCustomerValue || 'N/A';
  const standOut      = d.standOut || 'N/A';
  const promotions    = d.promotions || 'N/A';
  const qualifiedLead = d.qualifiedLead || 'N/A';
  const badLead       = d.badLead || 'N/A';
  const qualifyingQs  = d.qualifyingQuestions || 'N/A';
  const disqualifyQs  = d.disqualifyingQuestions || 'N/A';
  const customQ1      = d.customQ1 || '';
  const customQ2      = d.customQ2 || '';
  const customQ3      = d.customQ3 || '';
  const paidBefore    = d.paidAdsBefore || 'N/A';
  const workedWell    = d.workedWell || 'N/A';
  const notWorked     = d.notWorked || 'N/A';
  const goal90        = d.goal90Days || 'N/A';
  const limitations   = d.limitations || 'N/A';
  const adBudget      = d.adBudget || 'N/A';
  const adPlatforms   = d.adPlatforms || 'N/A';
  const leadHandoff   = d.leadHandoff || 'N/A';
  const responseTime  = d.responseTime || 'N/A';
  const finalNotes    = d.finalNotes || 'N/A';

  return `You are generating content for a Marketing Command Center dashboard.

CRITICAL: Output ONLY a valid JSON object. No explanation. No markdown. No backticks. Just raw JSON.

The JSON must have exactly these keys:

{
  "tagline": "one sentence describing what ${businessName} does",
  "avatar": {
    "whoTheyAre": "2-3 sentences describing the ideal customer based on: ${idealCustomer}, ages ${ageGroups}, interests: ${interests}",
    "painPoints": "2-3 sentences about their problems your service solves",
    "desires": "2-3 sentences about what they want",
    "qualifiers": ["qualifier 1", "qualifier 2", "qualifier 3"],
    "disqualifiers": ["disqualifier 1", "disqualifier 2"]
  },
  "funnelSteps": [
    {"step": "Step name", "desc": "one sentence description"},
    {"step": "Step name", "desc": "one sentence description"},
    {"step": "Step name", "desc": "one sentence description"},
    {"step": "Step name", "desc": "one sentence description"},
    {"step": "Step name", "desc": "one sentence description"}
  ],
  "ads": [
    {"headline": "ad headline", "body": "2-3 sentence ad text", "cta": "CTA text"},
    {"headline": "ad headline", "body": "2-3 sentence ad text", "cta": "CTA text"},
    {"headline": "ad headline", "body": "2-3 sentence ad text", "cta": "CTA text"}
  ],
  "targeting": {
    "demographics": ["item1", "item2", "item3"],
    "interests": ["item1", "item2", "item3", "item4"],
    "behaviors": ["item1", "item2", "item3"],
    "custom": ["item1", "item2", "item3"],
    "lookalike": ["item1", "item2"]
  },
  "roadmap": [
    {"phase": "Week 1", "title": "phase title", "desc": "2 sentences of actions"},
    {"phase": "Week 2", "title": "phase title", "desc": "2 sentences of actions"},
    {"phase": "Weeks 3-4", "title": "phase title", "desc": "2 sentences of actions"},
    {"phase": "Weeks 5-6", "title": "phase title", "desc": "2 sentences of actions"},
    {"phase": "Weeks 7-8", "title": "phase title", "desc": "2 sentences of actions"},
    {"phase": "Weeks 9-12", "title": "phase title", "desc": "2 sentences of actions"}
  ],
  "qualificationScript": {
    "opening": "2-3 sentence opening script",
    "questions": [
      {"q": "question text", "why": "why ask this"},
      {"q": "question text", "why": "why ask this"},
      {"q": "question text", "why": "why ask this"},
      {"q": "question text", "why": "why ask this"},
      {"q": "question text", "why": "why ask this"}
    ],
    "transition": "2 sentence transition to close",
    "objections": [
      {"obj": "objection", "response": "response"},
      {"obj": "objection", "response": "response"}
    ]
  },
  "positioning": [
    {"tip": "tip title", "desc": "2 sentence description"},
    {"tip": "tip title", "desc": "2 sentence description"},
    {"tip": "tip title", "desc": "2 sentence description"},
    {"tip": "tip title", "desc": "2 sentence description"},
    {"tip": "tip title", "desc": "2 sentence description"}
  ]
}

CLIENT DATA:
Business: ${businessName} | Owner: ${ownerName} | Industry: ${industry}
Service: ${primaryService} | Description: ${bizDesc}
Size: ${companySize} | Website: ${website} | Area: ${serviceArea}
Goal: ${mainGoal} | Avg Value: $${avgValue} | Budget: $${adBudget}/day
Platforms: ${adPlatforms} | Stand Out: ${standOut} | Promos: ${promotions}
Ideal Customer: ${idealCustomer} | Ages: ${ageGroups} | Gender: ${genderPref}
Interests: ${interests} | Qualified Lead: ${qualifiedLead} | Bad Lead: ${badLead}
Qualifying Qs: ${qualifyingQs} | Disqualifying Qs: ${disqualifyQs}
Custom Q1: ${customQ1} | Custom Q2: ${customQ2} | Custom Q3: ${customQ3}
Paid Before: ${paidBefore} | Worked: ${workedWell} | Didn't Work: ${notWorked}
90-Day Goal: ${goal90} | Limitations: ${limitations} | Lead Handoff: ${leadHandoff}
Response Time: ${responseTime} | Notes: ${finalNotes}

MARKETING PLAN CONTEXT (use for ads, roadmap, positioning):
${planText}

Output only the JSON object now.`;
}

// ── Assemble full HTML from JSON content ───────────────────
function buildDashboardHTML(json, d) {
  const businessName = d.businessName || d.authSignerBusiness || 'Your Business';
  const ownerName    = `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.authSignerName || 'Owner';
  const industry     = d.industry || 'N/A';
  const primaryService = d.primaryService || 'N/A';
  const bizDesc      = d.bizDescription || 'N/A';
  const companySize  = d.companySize || 'N/A';
  const website      = d.website || '#';
  const serviceArea  = `${d.serviceAreaType || ''} — ${d.serviceDetails || 'N/A'}`;
  const adBudget     = d.adBudget || 'N/A';
  const adPlatforms  = d.adPlatforms || 'N/A';
  const avgValue     = d.avgCustomerValue || 'N/A';
  const ageGroups    = d.ageGroups || 'N/A';
  const goal90       = d.goal90Days || 'N/A';
  const generatedAt  = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  const funnelHTML = (json.funnelSteps||[]).map((s,i) => `
    <div class="funnel-step" style="width:${100 - i*12}%;opacity:${1 - i*0.1}">
      <div class="funnel-step-title">${s.step}</div>
      <div class="funnel-step-desc">${s.desc}</div>
    </div>`).join('');

  const adsHTML = (json.ads||[]).map((a,i) => `
    <div class="ad-card">
      <div class="ad-num">Ad ${i+1}</div>
      <div class="ad-headline">${a.headline}</div>
      <div class="ad-body">${a.body}</div>
      <div class="ad-cta">${a.cta}</div>
    </div>`).join('');

  const targetHTML = Object.entries(json.targeting||{}).map(([key, items]) => `
    <div class="target-card">
      <div class="target-label">${key.charAt(0).toUpperCase()+key.slice(1)}</div>
      <ul>${(items||[]).map(i => `<li>${i}</li>`).join('')}</ul>
    </div>`).join('');

  const roadmapHTML = (json.roadmap||[]).map(r => `
    <div class="tl-item">
      <div class="tl-phase">${r.phase}</div>
      <div class="tl-title">${r.title}</div>
      <div class="tl-desc">${r.desc}</div>
    </div>`).join('');

  const scriptQsHTML = (json.qualificationScript?.questions||[]).map((q,i) => `
    <div class="script-q">
      <div class="q-num">Q${i+1}</div>
      <div class="q-text">${q.q}</div>
      <div class="q-why">Why: ${q.why}</div>
    </div>`).join('');

  const objectionsHTML = (json.qualificationScript?.objections||[]).map(o => `
    <div class="objection">
      <div class="obj-text">❌ "${o.obj}"</div>
      <div class="obj-response">✅ ${o.response}</div>
    </div>`).join('');

  const positioningHTML = (json.positioning||[]).map((p,i) => `
    <div class="pos-card">
      <div class="pos-num">${String(i+1).padStart(2,'0')}</div>
      <div class="pos-tip">${p.tip}</div>
      <div class="pos-desc">${p.desc}</div>
    </div>`).join('');

  const qualifiersHTML = (json.avatar?.qualifiers||[]).map(q => `<span class="tag green">${q}</span>`).join('');
  const disqualifiersHTML = (json.avatar?.disqualifiers||[]).map(q => `<span class="tag red">${q}</span>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${businessName} — Marketing Command Center</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0f;--surface:#12121a;--surface2:#1a1a26;--surface3:#22222f;--border:rgba(255,255,255,0.08);--text:#eeeef2;--dim:#b0b0c8;--muted:#7e7e9a;--orange:#f97316;--orange-glow:rgba(249,115,22,0.2);--green:#1de9b6;--red:#ff6b6b;--radius:12px;--font:'DM Sans',sans-serif;--mono:'Space Mono',monospace;}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.6;overflow-x:hidden;}
::-webkit-scrollbar{width:5px;}::-webkit-scrollbar-track{background:var(--bg);}::-webkit-scrollbar-thumb{background:var(--surface3);border-radius:3px;}
/* NAV */
.nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(10,10,15,0.9);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 2rem;}
.nav-brand{font-family:var(--mono);font-size:0.8rem;font-weight:700;color:var(--orange);letter-spacing:0.05em;}
.nav-links{display:flex;gap:0.2rem;}
.nav-links a{color:var(--dim);text-decoration:none;font-size:0.72rem;font-weight:600;padding:0.35rem 0.7rem;border-radius:6px;transition:all 0.2s;}
.nav-links a:hover{color:var(--text);background:var(--surface2);}
/* HERO */
.hero{padding:100px 2rem 60px;max-width:1200px;margin:0 auto;position:relative;}
.hero::before{content:'';position:absolute;top:60px;left:50%;transform:translateX(-50%);width:500px;height:500px;background:radial-gradient(circle,var(--orange-glow) 0%,transparent 70%);pointer-events:none;}
.hero-label{font-family:var(--mono);font-size:0.65rem;color:var(--orange);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;}
.hero-label::before{content:'';width:7px;height:7px;background:var(--orange);border-radius:50%;animation:pulse 2s infinite;}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--orange-glow);}50%{opacity:0.7;box-shadow:0 0 0 8px transparent;}}
.hero h1{font-size:clamp(2rem,5vw,3.2rem);font-weight:700;line-height:1.15;margin-bottom:0.75rem;background:linear-gradient(135deg,var(--text) 0%,var(--dim) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.hero-sub{color:var(--dim);font-size:1rem;margin-bottom:2rem;}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;margin-top:2rem;}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;}
.stat-val{font-family:var(--mono);font-size:1.4rem;font-weight:700;color:var(--orange);margin-bottom:0.2rem;}
.stat-lbl{font-size:0.68rem;color:var(--dim);text-transform:uppercase;letter-spacing:0.08em;}
/* SECTIONS */
.section{max-width:1200px;margin:0 auto;padding:3rem 2rem;}
.sec-label{font-family:var(--mono);font-size:0.62rem;color:var(--orange);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:0.4rem;}
.sec-title{font-size:1.5rem;font-weight:700;margin-bottom:0.4rem;}
.sec-desc{color:var(--dim);font-size:0.85rem;margin-bottom:2rem;}
/* CARDS */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;transition:all 0.3s;}
.card:hover{border-color:rgba(249,115,22,0.25);transform:translateY(-2px);}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;}
/* PROFILE */
.detail-label{font-size:0.62rem;color:var(--orange);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:0.2rem;}
.detail-val{font-size:0.9rem;margin-bottom:1rem;}
.tag{display:inline-block;font-size:0.65rem;padding:0.25rem 0.6rem;border-radius:20px;margin:0.2rem;font-weight:500;}
.tag.green{background:rgba(29,233,182,0.1);color:var(--green);border:1px solid rgba(29,233,182,0.3);}
.tag.red{background:rgba(255,107,107,0.1);color:var(--red);border:1px solid rgba(255,107,107,0.3);}
.tag.orange{background:rgba(249,115,22,0.1);color:var(--orange);border:1px solid rgba(249,115,22,0.3);}
/* FUNNEL */
.funnel-wrap{display:flex;flex-direction:column;align-items:center;gap:4px;margin:2rem 0;}
.funnel-step{padding:1rem 2rem;border-radius:8px;text-align:center;background:linear-gradient(135deg,var(--orange),#ea580c);color:#fff;font-weight:600;transition:transform 0.2s;margin:0 auto;}
.funnel-step:hover{transform:scale(1.02);}
.funnel-step-title{font-size:0.9rem;font-weight:700;}
.funnel-step-desc{font-size:0.75rem;opacity:0.85;margin-top:0.2rem;}
/* ADS */
.ad-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;transition:all 0.3s;}
.ad-card:hover{border-color:rgba(249,115,22,0.3);transform:translateY(-2px);}
.ad-num{background:var(--orange);color:#fff;font-family:var(--mono);font-size:0.65rem;padding:0.4rem 1rem;font-weight:700;letter-spacing:0.1em;}
.ad-headline{font-size:1rem;font-weight:700;color:var(--orange);padding:1rem 1rem 0.5rem;}
.ad-body{font-size:0.82rem;color:var(--dim);padding:0 1rem 1rem;line-height:1.6;}
.ad-cta{margin:0 1rem 1rem;display:inline-block;background:var(--surface3);border:1px solid var(--border);padding:0.4rem 1rem;border-radius:6px;font-size:0.75rem;font-weight:600;color:var(--text);}
/* TARGETING */
.target-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;}
.target-label{font-size:0.65rem;color:var(--orange);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:0.75rem;}
.target-card ul{list-style:none;}
.target-card li{font-size:0.8rem;padding:0.3rem 0;padding-left:1rem;position:relative;color:var(--text);}
.target-card li::before{content:'';position:absolute;left:0;top:0.65rem;width:4px;height:4px;border-radius:50%;background:var(--orange);}
/* TIMELINE */
.timeline{position:relative;padding-left:2rem;}
.timeline::before{content:'';position:absolute;left:7px;top:0;bottom:0;width:2px;background:linear-gradient(180deg,var(--orange),#ea580c,var(--green));border-radius:2px;}
.tl-item{position:relative;margin-bottom:1.5rem;padding:1.25rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);transition:all 0.3s;}
.tl-item:hover{border-color:rgba(249,115,22,0.25);}
.tl-item::before{content:'';position:absolute;left:-2.15rem;top:1.4rem;width:11px;height:11px;border-radius:50%;border:2px solid var(--orange);background:var(--bg);}
.tl-phase{font-family:var(--mono);font-size:0.62rem;color:var(--orange);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.3rem;}
.tl-title{font-size:0.95rem;font-weight:600;margin-bottom:0.3rem;}
.tl-desc{font-size:0.8rem;color:var(--dim);line-height:1.6;}
/* SCRIPT */
.script-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;margin-bottom:1rem;}
.script-heading{font-size:0.7rem;color:var(--orange);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:0.75rem;}
.script-text{font-size:0.85rem;color:var(--dim);line-height:1.7;}
.script-q{background:var(--surface2);border-radius:8px;padding:1rem;margin-bottom:0.75rem;border-left:3px solid var(--orange);}
.q-num{font-family:var(--mono);font-size:0.6rem;color:var(--orange);font-weight:700;margin-bottom:0.3rem;}
.q-text{font-size:0.88rem;font-weight:600;margin-bottom:0.2rem;}
.q-why{font-size:0.75rem;color:var(--muted);}
.objection{background:var(--surface2);border-radius:8px;padding:1rem;margin-bottom:0.75rem;}
.obj-text{font-size:0.82rem;color:var(--red);margin-bottom:0.4rem;}
.obj-response{font-size:0.82rem;color:var(--green);}
/* POSITIONING */
.pos-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;position:relative;overflow:hidden;transition:all 0.3s;}
.pos-card:hover{border-color:rgba(249,115,22,0.3);transform:translateY(-2px);}
.pos-num{font-family:var(--mono);font-size:2.5rem;font-weight:700;color:var(--surface3);position:absolute;top:0.5rem;right:1rem;}
.pos-tip{font-size:0.95rem;font-weight:700;color:var(--orange);margin-bottom:0.5rem;padding-right:3rem;}
.pos-desc{font-size:0.82rem;color:var(--dim);line-height:1.6;}
/* NEXT STEPS */
.next-card{background:linear-gradient(135deg,var(--surface),var(--surface2));border:2px solid var(--orange);border-radius:20px;padding:3rem;text-align:center;}
.next-card h2{font-size:1.8rem;font-weight:700;margin-bottom:1rem;}
.next-card p{color:var(--dim);font-size:0.95rem;margin-bottom:2rem;max-width:500px;margin-left:auto;margin-right:auto;}
.btn-primary{display:inline-block;background:linear-gradient(135deg,var(--orange),#ea580c);color:#fff;font-size:1rem;font-weight:700;padding:1rem 3rem;border-radius:50px;text-decoration:none;box-shadow:0 10px 30px var(--orange-glow);transition:all 0.3s;}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 15px 40px var(--orange-glow);}
/* FOOTER */
.footer{text-align:center;padding:2.5rem 2rem;border-top:1px solid var(--border);margin-top:3rem;}
.footer p{font-size:0.72rem;color:var(--muted);}
/* FADE IN */
.fade{opacity:0;transform:translateY(20px);transition:opacity 0.6s ease,transform 0.6s ease;}
.fade.visible{opacity:1;transform:translateY(0);}
@media(max-width:768px){.nav-links{display:none;}.hero h1{font-size:1.8rem;}.section{padding:2rem 1rem;}}
</style>
</head>
<body>
<nav class="nav">
  <div class="nav-brand">⚡ ${businessName}</div>
  <div class="nav-links">
    <a href="#profile">Profile</a>
    <a href="#funnel">Funnel</a>
    <a href="#ads">Ads</a>
    <a href="#targeting">Targeting</a>
    <a href="#roadmap">Roadmap</a>
    <a href="#script">Script</a>
    <a href="#positioning">Positioning</a>
    <a href="#next">Next Steps</a>
  </div>
</nav>

<!-- HERO -->
<div class="hero fade">
  <div class="hero-label">Marketing Command Center — Live</div>
  <h1>${businessName}</h1>
  <p class="hero-sub">Prepared for ${ownerName} &nbsp;·&nbsp; ${industry} &nbsp;·&nbsp; Generated ${generatedAt}</p>
  <p class="hero-sub" style="font-size:0.85rem;color:var(--muted)">${json.tagline||''}</p>
  <div class="stats-row">
    <div class="stat"><div class="stat-val">$${adBudget}</div><div class="stat-lbl">Daily Ad Budget</div></div>
    <div class="stat"><div class="stat-val">${adPlatforms}</div><div class="stat-lbl">Platforms</div></div>
    <div class="stat"><div class="stat-val">$${avgValue}</div><div class="stat-lbl">Avg Job Value</div></div>
    <div class="stat"><div class="stat-val">${ageGroups}</div><div class="stat-lbl">Target Age Range</div></div>
    <div class="stat"><div class="stat-val">${serviceArea.split('—')[1]?.trim()||'Local'}</div><div class="stat-lbl">Service Area</div></div>
  </div>
</div>

<!-- PROFILE -->
<section class="section fade" id="profile">
  <div class="sec-label">01 / Client Profile</div>
  <div class="sec-title">Business Overview & Dream Client Avatar</div>
  <div class="grid2">
    <div class="card">
      <div class="detail-label">Business</div><div class="detail-val">${businessName}</div>
      <div class="detail-label">Owner</div><div class="detail-val">${ownerName}</div>
      <div class="detail-label">Industry</div><div class="detail-val">${industry}</div>
      <div class="detail-label">Primary Service</div><div class="detail-val">${primaryService}</div>
      <div class="detail-label">Description</div><div class="detail-val">${bizDesc}</div>
      <div class="detail-label">Team Size</div><div class="detail-val">${companySize}</div>
      <div class="detail-label">Website</div><div class="detail-val">${website}</div>
      <div class="detail-label">Service Area</div><div class="detail-val">${serviceArea}</div>
      <div class="detail-label">90-Day Goal</div><div class="detail-val">${goal90}</div>
    </div>
    <div class="card">
      <div class="detail-label">Who They Are</div><div class="detail-val">${json.avatar?.whoTheyAre||''}</div>
      <div class="detail-label">Pain Points</div><div class="detail-val">${json.avatar?.painPoints||''}</div>
      <div class="detail-label">What They Want</div><div class="detail-val">${json.avatar?.desires||''}</div>
      <div class="detail-label">Qualifiers ✅</div>
      <div class="detail-val">${qualifiersHTML}</div>
      <div class="detail-label">Disqualifiers ❌</div>
      <div class="detail-val">${disqualifiersHTML}</div>
    </div>
  </div>
</section>

<!-- FUNNEL -->
<section class="section fade" id="funnel">
  <div class="sec-label">02 / Funnel Architecture</div>
  <div class="sec-title">Lead-to-Sale Conversion Path</div>
  <div class="sec-desc">Your custom funnel based on ${adPlatforms} targeting ${ageGroups} in ${serviceArea.split('—')[1]?.trim()||'your area'}.</div>
  <div class="funnel-wrap">${funnelHTML}</div>
</section>

<!-- ADS -->
<section class="section fade" id="ads">
  <div class="sec-label">03 / Ad Copy</div>
  <div class="sec-title">Ready-to-Deploy Ad Creatives</div>
  <div class="sec-desc">Three tested angles for ${businessName}. Launch all three, kill losers after 72 hours, scale the winner.</div>
  <div class="grid3">${adsHTML}</div>
</section>

<!-- TARGETING -->
<section class="section fade" id="targeting">
  <div class="sec-label">04 / Targeting Strategy</div>
  <div class="sec-title">Audience Architecture</div>
  <div class="sec-desc">Layered targeting on ${adPlatforms} for maximum return on your $${adBudget}/day budget.</div>
  <div class="grid3">${targetHTML}</div>
</section>

<!-- ROADMAP -->
<section class="section fade" id="roadmap">
  <div class="sec-label">05 / 90-Day Roadmap</div>
  <div class="sec-title">Phase-by-Phase Execution Plan</div>
  <div class="sec-desc">Week-by-week actions to hit: ${goal90}</div>
  <div class="timeline">${roadmapHTML}</div>
</section>

<!-- SCRIPT -->
<section class="section fade" id="script">
  <div class="sec-label">06 / Lead Qualification Script</div>
  <div class="sec-title">Ready-to-Use Call Script</div>
  <div class="grid2">
    <div>
      <div class="script-box">
        <div class="script-heading">Opening</div>
        <div class="script-text">${json.qualificationScript?.opening||''}</div>
      </div>
      <div class="script-heading" style="margin:1.5rem 0 0.75rem;font-size:0.7rem;color:var(--orange);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Qualifying Questions</div>
      ${scriptQsHTML}
      <div class="script-box" style="margin-top:1rem;">
        <div class="script-heading">Transition to Close</div>
        <div class="script-text">${json.qualificationScript?.transition||''}</div>
      </div>
    </div>
    <div>
      <div class="script-heading" style="margin-bottom:0.75rem;font-size:0.7rem;color:var(--orange);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Objection Handling</div>
      ${objectionsHTML}
    </div>
  </div>
</section>

<!-- POSITIONING -->
<section class="section fade" id="positioning">
  <div class="sec-label">07 / Competitor Positioning</div>
  <div class="sec-title">5 Ways to Stand Above the Competition</div>
  <div class="grid2">${positioningHTML}</div>
</section>

<!-- NEXT STEPS -->
<section class="section fade" id="next">
  <div class="next-card">
    <h2>Ready to Launch?</h2>
    <p>Your Marketing Command Center for ${businessName} is live. Schedule your strategy call to get your campaigns running within 48 hours.</p>
    <a href="https://link.astroaibots.com/widget/booking/fp48fbNtkGyPlqJJWEUh" class="btn-primary">📅 Schedule Your Strategy Call</a>
  </div>
</section>

<footer class="footer">
  <p>Marketing Command Center — ${businessName} &nbsp;|&nbsp; Prepared by Astro A.I. Marketing &nbsp;|&nbsp; Generated ${generatedAt}</p>
</footer>

<script>
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if(e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.08 });
document.querySelectorAll('.fade').forEach(el => observer.observe(el));
</script>
</body>
</html>`;
}

// ── Build prompt from onboarding data ─────────────────────
function buildPrompt(d) {
  return `
Create a complete, highly personalized marketing plan for the following business. Use their exact details throughout every section.

═══════════════════════════════════════════════
BUSINESS PROFILE
═══════════════════════════════════════════════
Business Name:        ${d.businessName || d.authSignerBusiness || 'N/A'}
Owner:                ${d.firstName || ''} ${d.lastName || ''}
Industry:             ${d.industry || 'N/A'}
Primary Service:      ${d.primaryService || 'N/A'}
Business Description: ${d.bizDescription || 'N/A'}
Company Size:         ${d.companySize || 'N/A'}
Website:              ${d.website || 'N/A'}
Service Area:         ${d.serviceAreaType || ''} — ${d.serviceDetails || 'N/A'}
Language:             ${d.language || 'English'}

═══════════════════════════════════════════════
TARGET AUDIENCE
═══════════════════════════════════════════════
Ideal Customer:       ${d.idealCustomer || 'N/A'}
Age Groups:           ${d.ageGroups || 'N/A'}
Gender Preference:    ${d.genderPref || 'No preference'}
Interests/Behaviors:  ${d.interests || 'N/A'}

═══════════════════════════════════════════════
OFFER & POSITIONING
═══════════════════════════════════════════════
Main Advertising Goal:      ${d.mainGoal || 'N/A'}
Average Customer Value:     ${d.avgCustomerValue || 'N/A'}
What Makes Them Stand Out:  ${d.standOut || 'N/A'}
Current Promotions:         ${d.promotions || 'N/A'}

═══════════════════════════════════════════════
LEAD QUALIFICATION
═══════════════════════════════════════════════
Qualified Lead Looks Like:  ${d.qualifiedLead || 'N/A'}
Bad Lead / Disqualifiers:   ${d.badLead || 'N/A'}
Qualifying Questions:       ${d.qualifyingQuestions || 'N/A'}
Disqualifying Questions:    ${d.disqualifyingQuestions || 'N/A'}

═══════════════════════════════════════════════
PAST MARKETING
═══════════════════════════════════════════════
Paid Ads Before:      ${d.paidAdsBefore || 'N/A'}
Platforms Used:       ${d.platformsUsedBefore || 'N/A'}
What Worked:          ${d.workedWell || 'N/A'}
What Didn't Work:     ${d.notWorked || 'N/A'}

═══════════════════════════════════════════════
GOALS & BUDGET
═══════════════════════════════════════════════
90-Day Goal:          ${d.goal90Days || 'N/A'}
Limitations:          ${d.limitations || 'N/A'}
Priorities:           ${d.priorities || 'N/A'}
Ad Budget:            ${d.adBudget || 'N/A'} per day
Open to Scaling:      ${d.budgetIncrease || 'N/A'}
Chosen Platforms:     ${d.adPlatforms || 'N/A'}
Final Notes:          ${d.finalNotes || 'N/A'}

═══════════════════════════════════════════════

Now generate a complete marketing plan with EXACTLY these 7 sections. Use markdown-style headers (##) for each section:

## 1. TARGET AUDIENCE BREAKDOWN
Detailed profile of who we are targeting, including demographics, psychographics, pain points, motivations, and where they spend time online. Be specific to this business.

## 2. RECOMMENDED PLATFORMS & BUDGET ALLOCATION
Which platforms to run on and why, with specific daily/monthly budget splits. Include expected CPL (cost per lead) ranges based on industry benchmarks. Justify every recommendation.

## 3. 90-DAY CAMPAIGN STRATEGY
Week-by-week breakdown for the first 90 days. Phase 1 (testing), Phase 2 (optimization), Phase 3 (scaling). Include specific milestones and KPIs.

## 4. AD COPY SUGGESTIONS
Write 3 complete ad variations. Each must include:
- Headline (under 40 chars)
- Primary Text (2-3 sentences in marketing language, based on their actual offer and USP)
- Call to Action
Make the copy compelling, benefit-driven, and specific to their business.

## 5. HEADLINES & PRIMARY TEXT (MARKETING LANGUAGE)
Based on their answers, rewrite their offer and positioning in professional marketing language. Include 5 headline options and 3 primary text variations they can use across any platform.

## 6. LEAD QUALIFICATION SCRIPT
A complete, ready-to-use script for qualifying leads. Include opening, 5 qualifying questions (based on their answers), transition to appointment, and objection handling for the 2 most common objections in their industry.

## 7. COMPETITOR POSITIONING & DIFFERENTIATION TIPS
Based on their industry and what makes them stand out, provide 5 specific tactics to position them above competitors in their ads and messaging.

Be extremely specific. Use their business name, service, and location throughout. This plan should feel custom-built, not generic.
`.trim();
}

// ── HTML → PDF via PDFShift ─────────────────────────────

const PLAN_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10px;
    color: #1A1A2E;
    background: #fff;
    padding: 0;
  }

  /* ── PAGE BORDERS & CORNERS ── */
  .page-wrap {
    position: relative;
    min-height: 100vh;
    padding: 54px 60px 80px 60px;
  }
  .page-wrap::before {
    content: '';
    position: fixed;
    top: 12px; left: 12px; right: 12px; bottom: 12px;
    border: 0.5px solid #DDE1EA;
    pointer-events: none;
    z-index: 100;
  }
  .page-wrap::after {
    content: '';
    position: fixed;
    top: 15px; left: 15px; right: 15px; bottom: 15px;
    border: 0.25px solid #E8EBF2;
    pointer-events: none;
    z-index: 100;
  }

  /* Corner brackets */
  .corner { position: fixed; width: 22px; height: 22px; z-index: 101; }
  .corner::before, .corner::after { content: ''; position: absolute; background: #F97316; }
  .corner::before { height: 2px; width: 22px; }
  .corner::after  { width: 2px; height: 22px; }
  .corner.tl { top: 12px; left: 12px; }
  .corner.tr { top: 12px; right: 12px; transform: scaleX(-1); }
  .corner.bl { bottom: 12px; left: 12px; transform: scaleY(-1); }
  .corner.br { bottom: 12px; right: 12px; transform: scale(-1); }

  /* ── WATERMARK ── */
  .watermark {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(38deg);
    font-size: 52px;
    font-weight: 800;
    color: #000;
    opacity: 0.018;
    white-space: nowrap;
    pointer-events: none;
    z-index: 0;
    letter-spacing: 2px;
  }

  /* ── COVER HEADER ── */
  .cover-header {
    background: #080C28;
    margin: -54px -60px 0 -60px;
    padding: 30px 60px 0 60px;
  }
  .cover-header-inner {
    background: #080C28;
    padding-bottom: 0;
  }
  .company-name {
    font-size: 26px;
    font-weight: 800;
    color: #F97316;
    letter-spacing: -0.5px;
    line-height: 1.1;
  }
  .cover-subtitle {
    font-size: 11px;
    color: #B4C3D7;
    margin-top: 6px;
    font-weight: 400;
  }
  .cover-meta-bar {
    background: #0E1435;
    margin: 14px -60px 0 -60px;
    padding: 8px 60px;
    font-size: 8px;
    color: #6B7A9A;
    display: flex;
    justify-content: space-between;
  }
  .orange-rule {
    height: 3px;
    background: #F97316;
    margin: 0 -60px;
  }

  /* ── COVER BODY ── */
  .biz-name {
    font-size: 24px;
    font-weight: 800;
    color: #1A1A2E;
    margin-top: 28px;
    margin-bottom: 6px;
    letter-spacing: -0.5px;
  }
  .section-label {
    font-size: 8px;
    font-weight: 700;
    color: #6B7A9A;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 8px;
    margin-top: 20px;
  }

  /* ── INCLUDED TABLE ── */
  .inc-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .inc-table tr:nth-child(odd)  td.inc-body { background: #F8F9FC; }
  .inc-table tr:nth-child(even) td.inc-body { background: #FFFFFF; }
  .inc-table td { padding: 8px 10px; vertical-align: middle; }
  .inc-num {
    background: #080C28;
    color: #fff;
    font-weight: 700;
    font-size: 10px;
    width: 32px;
    text-align: center;
    border-left: 4px solid #F97316;
  }
  .inc-body { width: 100%; }
  .inc-title { font-size: 9.5px; font-weight: 700; color: #1A1A2E; }
  .inc-desc  { font-size: 8px; color: #6B7A9A; margin-top: 2px; }

  /* ── CONFIDENTIAL BOX ── */
  .conf-box {
    background: #F8F9FC;
    border-right: 3px solid #F97316;
    padding: 10px 14px;
    font-size: 8px;
    color: #6B7A9A;
    line-height: 1.6;
  }
  .conf-box b { color: #1A1A2E; }

  /* ── PAGE BREAK ── */
  .page-break { page-break-before: always; padding: 54px 0px 80px 0px; }

  /* ── RUNNING HEADER (inner pages) ── */
  .running-header {
    background: #080C28;
    margin: -54px -60px 28px -60px;
    padding: 8px 60px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #F97316;
  }
  .rh-co   { font-size: 8px; font-weight: 700; color: #F97316; }
  .rh-plan { font-size: 7px; color: #6B7A9A; }

  /* ── SECTION BAND ── */
  .section-band {
    background: #080C28;
    border-radius: 4px;
    padding: 8px 14px 8px 10px;
    display: flex;
    align-items: center;
    margin-bottom: 14px;
    border-left: 5px solid #F97316;
  }
  .band-num {
    background: #F97316;
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    width: 20px;
    height: 20px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: 10px;
    flex-shrink: 0;
  }
  .band-title {
    font-size: 10.5px;
    font-weight: 700;
    color: #fff;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* ── BODY TEXT ── */
  .body-text { font-size: 9.5px; line-height: 1.65; color: #1A1A2E; margin-bottom: 6px; text-align: justify; }
  .sub-head  { font-size: 10px; font-weight: 700; color: #F97316; margin: 10px 0 4px 0; }
  .bullet-list { margin: 4px 0 6px 0; padding: 0; list-style: none; }
  .bullet-list li {
    font-size: 9.5px;
    line-height: 1.6;
    color: #1A1A2E;
    padding-left: 14px;
    position: relative;
    margin-bottom: 3px;
  }
  .bullet-list li::before {
    content: '•';
    position: absolute;
    left: 2px;
    color: #F97316;
    font-size: 10px;
  }
  .num-list { margin: 4px 0 6px 0; padding: 0; list-style: none; counter-reset: nl; }
  .num-list li {
    font-size: 9.5px;
    line-height: 1.6;
    color: #1A1A2E;
    padding-left: 20px;
    position: relative;
    margin-bottom: 4px;
    counter-increment: nl;
  }
  .num-list li::before {
    content: counter(nl) '.';
    position: absolute;
    left: 0;
    font-weight: 700;
    color: #F97316;
  }

  /* ── AD CARDS ── */
  .ad-card {
    background: #F8F9FC;
    border: 0.5px solid #DDE1EA;
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .ad-card-top {
    background: #F97316;
    height: 4px;
  }
  .ad-card-body { padding: 12px 14px 14px; }
  .ad-badge {
    display: inline-block;
    background: #080C28;
    color: #fff;
    font-size: 7.5px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 3px;
    margin-bottom: 8px;
    letter-spacing: 0.5px;
  }
  .ad-headline { font-size: 13px; font-weight: 700; color: #080C28; margin-bottom: 6px; line-height: 1.2; }
  .ad-body-text { font-size: 9px; color: #444; line-height: 1.6; margin-bottom: 10px; }
  .ad-cta {
    display: inline-block;
    background: #F97316;
    color: #fff;
    font-size: 8px;
    font-weight: 700;
    padding: 5px 14px;
    border-radius: 4px;
    letter-spacing: 0.3px;
  }

  /* ── NEXT STEPS ── */
  .step-row {
    display: flex;
    margin-bottom: 8px;
    border-radius: 4px;
    overflow: hidden;
  }
  .step-num-box {
    background: #F97316;
    color: #fff;
    font-size: 18px;
    font-weight: 700;
    width: 52px;
    min-width: 52px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .step-body {
    background: #F8F9FC;
    padding: 12px 14px;
    flex: 1;
  }
  .step-title { font-size: 10.5px; font-weight: 700; color: #1A1A2E; margin-bottom: 3px; }
  .step-desc  { font-size: 8.5px; color: #6B7A9A; line-height: 1.5; }

  /* ── CONTACT CTA ── */
  .contact-row {
    display: flex;
    margin-top: 20px;
    border-radius: 4px;
    overflow: hidden;
  }
  .contact-left {
    background: #F8F9FC;
    border-left: 3px solid #F97316;
    padding: 16px 18px;
    flex: 1;
  }
  .contact-right {
    background: #F97316;
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    width: 120px;
    min-width: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 0 10px;
  }
  .contact-title { font-size: 11px; font-weight: 700; color: #1A1A2E; margin-bottom: 4px; }
  .contact-sub   { font-size: 9px; color: #6B7A9A; }

  /* ── FOOTER ── */
  .page-footer {
    position: fixed;
    bottom: 15px; left: 15px; right: 15px;
    background: #080C28;
    padding: 6px 22px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1.5px solid #F97316;
    z-index: 99;
  }
  .footer-left  { font-size: 7px; color: #6B7A9A; }
  .footer-right { font-size: 7px; font-weight: 700; color: #F97316; }

  /* thin divider */
  .thin-rule { border: none; border-top: 0.5px solid #DDE1EA; margin: 8px 0 10px; }
</style>
</head>
<body>

<div class="corner tl"></div>
<div class="corner tr"></div>
<div class="corner bl"></div>
<div class="corner br"></div>
<div class="watermark">ASTRO A.I. MARKETING</div>

<div class="page-footer">
  <span class="footer-left">CONFIDENTIAL &nbsp;|&nbsp; {{BUSINESS_NAME}} &nbsp;|&nbsp; info@astroaibots.com &nbsp;|&nbsp; astroaibots.com</span>
  <span class="footer-right">Astro A.I. Marketing</span>
</div>

<!-- ══════════════════════════════════════════ -->
<!-- COVER PAGE -->
<!-- ══════════════════════════════════════════ -->
<div class="page-wrap">
  <div class="cover-header">
    <div class="cover-header-inner">
      <div class="company-name">ASTRO A.I. MARKETING</div>
      <div class="cover-subtitle">Personalized Marketing Plan — Prepared Exclusively For You</div>
      <div class="cover-meta-bar">
        <span>Prepared for: <b style="color:#fff">{{CLIENT_NAME}}</b> &nbsp;|&nbsp; Generated: {{GENERATED_AT}}</span>
        <span>astroaibots.com</span>
      </div>
    </div>
    <div class="orange-rule"></div>
  </div>

  <div class="biz-name">{{BUSINESS_NAME}}</div>
  <div class="section-label">Your Personalized Plan Includes:</div>

  <table class="inc-table">
    <tr><td class="inc-num">1</td><td class="inc-body"><div class="inc-title">Target Audience Breakdown</div><div class="inc-desc">Demographics, psychographics &amp; online behavior profile</div></td></tr>
    <tr><td class="inc-num">2</td><td class="inc-body"><div class="inc-title">Platform &amp; Budget Strategy</div><div class="inc-desc">Ad channels, budget splits &amp; expected CPL ranges</div></td></tr>
    <tr><td class="inc-num">3</td><td class="inc-body"><div class="inc-title">90-Day Campaign Roadmap</div><div class="inc-desc">Phase-by-phase plan with milestones and KPIs</div></td></tr>
    <tr><td class="inc-num">4</td><td class="inc-body"><div class="inc-title">Ad Copy &amp; Headlines</div><div class="inc-desc">3 complete ad variations ready to deploy immediately</div></td></tr>
    <tr><td class="inc-num">5</td><td class="inc-body"><div class="inc-title">Lead Qualification Script</div><div class="inc-desc">Word-for-word call script with objection handling</div></td></tr>
    <tr><td class="inc-num">6</td><td class="inc-body"><div class="inc-title">Competitor Positioning Tips</div><div class="inc-desc">5 tactics to dominate your local market</div></td></tr>
  </table>

  <div class="conf-box">
    <b>CONFIDENTIAL:</b> This marketing plan was generated exclusively for {{BUSINESS_NAME}} by Astro A.I. Marketing.
    All strategies, ad copy, and recommendations are proprietary and intended solely for the named recipient.
  </div>
</div>

<!-- ══════════════════════════════════════════ -->
<!-- SECTIONS (injected by JS) -->
<!-- ══════════════════════════════════════════ -->
{{SECTIONS_HTML}}

<!-- ══════════════════════════════════════════ -->
<!-- CLOSING PAGE -->
<!-- ══════════════════════════════════════════ -->
<div class="page-break">
  <div class="running-header">
    <span class="rh-co">ASTRO A.I. MARKETING</span>
    <span class="rh-plan">Marketing Plan &mdash; {{BUSINESS_NAME}}</span>
  </div>

  <div class="section-band">
    <div class="band-num">8</div>
    <div class="band-title">Next Steps — Let's Get You Launched 🚀</div>
  </div>

  <div class="step-row">
    <div class="step-num-box">1</div>
    <div class="step-body">
      <div class="step-title">Review This Plan</div>
      <div class="step-desc">Read through each section. Highlight anything you want to discuss with your strategist.</div>
    </div>
  </div>
  <div class="step-row">
    <div class="step-num-box">2</div>
    <div class="step-body">
      <div class="step-title">Schedule Your Strategy Call</div>
      <div class="step-desc">Book a free call and walk through the plan together before anything goes live.</div>
    </div>
  </div>
  <div class="step-row">
    <div class="step-num-box">3</div>
    <div class="step-body">
      <div class="step-title">Campaign Launch</div>
      <div class="step-desc">We build your ads, targeting, and copy — and launch within days of your approval.</div>
    </div>
  </div>
  <div class="step-row">
    <div class="step-num-box">4</div>
    <div class="step-body">
      <div class="step-title">Weekly Performance Reports</div>
      <div class="step-desc">Every week: a clear report with leads generated, cost per lead, and results.</div>
    </div>
  </div>

  <div class="contact-row">
    <div class="contact-left">
      <div class="contact-title">Questions? We're here for you.</div>
      <div class="contact-sub">info@astroaibots.com &nbsp;|&nbsp; astroaibots.com</div>
    </div>
    <div class="contact-right">Schedule a Call &rarr;</div>
  </div>
</div>

</body>
</html>
`;

function planToHTML(planText, clientName, businessName, generatedAt) {
  const SEC_TITLES = [
    'Target Audience Breakdown',
    'Recommended Platforms &amp; Budget Allocation',
    '90-Day Campaign Strategy',
    'Ad Copy Suggestions',
    'Headlines &amp; Primary Text',
    'Lead Qualification Script',
    'Competitor Positioning &amp; Differentiation Tips',
  ];

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function parseSections(text) {
    const sections = []; let cur = null;
    for (const line of text.split('\n')) {
      const m = line.match(/^##\s+\d+\.\s+(.+)/);
      if (m) { if (cur) sections.push(cur); cur = { title: m[1].trim(), lines: [] }; }
      else if (cur) cur.lines.push(line);
    }
    if (cur) sections.push(cur);
    return sections;
  }

  function linesToHTML(lines) {
    let html = ''; let inBullet = false, inNum = false;
    function closeLists() {
      if (inBullet) { html += '</ul>'; inBullet = false; }
      if (inNum)    { html += '</ol>'; inNum = false; }
    }
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { closeLists(); continue; }

      // Handle ### headings from GPT
      if (line.startsWith('### ') || line.startsWith('## ')) {
        closeLists();
        const t = esc(line.replace(/^#+\s+/, ''));
        html += `<div class="sub-head">${t}</div>`;
        continue;
      }

      // Bold subheading **text** or line ending with colon
      if ((line.startsWith('**') && line.endsWith('**') && !line.slice(2,-2).includes('**')) ||
          (line.endsWith(':') && line.length < 70 && !line.startsWith('-') && !line.match(/^\d/))) {
        closeLists();
        const t = esc(line.replace(/\*\*/g,'').replace(/:$/,''));
        html += `<div class="sub-head">${t}</div>`;
        continue;
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        if (inNum) { html += '</ol>'; inNum = false; }
        if (!inBullet) { html += '<ul class="bullet-list">'; inBullet = true; }
        const t = esc(line.slice(2)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        html += `<li>${t}</li>`; continue;
      }
      const nm = line.match(/^(\d+)\.\s+(.+)/);
      if (nm) {
        if (inBullet) { html += '</ul>'; inBullet = false; }
        if (!inNum) { html += '<ol class="num-list">'; inNum = true; }
        const t = esc(nm[2]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        html += `<li>${t}</li>`; continue;
      }
      closeLists();
      const t = esc(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      html += `<p class="body-text">${t}</p>`;
    }
    closeLists(); return html;
  }

  function parseAds(bodyText) {
    // Split on any variation of "Ad Variation N" header
    const blocks = bodyText.split(/(?:\*\*)?(?:Ad Variation|AD VARIATION)\s*\d+(?:\*\*)?:?/i).filter(b=>b.trim());
    // If no blocks found, try splitting on ### 
    const finalBlocks = blocks.length > 1 ? blocks : bodyText.split(/###/).filter(b=>b.trim());
    return finalBlocks.slice(0,3).map((block, idx) => {
      const blines = block.split('\n').map(l=>l.trim()).filter(Boolean);
      let headline='', body='', cta='Learn More';
      for (const ln of blines) {
        const ll = ln.toLowerCase();
        if (ll.startsWith('headline:'))            headline = ln.split(':').slice(1).join(':').trim().replace(/[*"]/g,'');
        else if (ll.startsWith('primary text:'))   body = ln.split(':').slice(1).join(':').trim().replace(/\*\*/g,'').replace(/^["']|["']$/g,'');
        else if (ll.startsWith('call to action:')||ll.startsWith('cta:')) cta = ln.split(':').slice(1).join(':').trim().replace(/[*"]/g,'');
        else if (ll.startsWith('body:'))           body = ln.split(':').slice(1).join(':').trim().replace(/[*"]/g,'');
        else if (!headline && ln.length>5 && ln.length<80 && !ln.includes(':')) headline = ln.replace(/[*"#]/g,'').trim();
        else if (!body && ln.length>40) body = ln.replace(/\*\*/g,'').replace(/^["']|["']$/g,'');
      }
      if (!headline) headline = `Ad Variation ${idx+1}`;
      return { headline: esc(headline), body: esc(body), cta: esc(cta) };
    });
  }

  const sections = parseSections(planText);
  let sectionsHTML = '';
  sections.forEach((section, idx) => {
    const title = SEC_TITLES[idx] || esc(section.title);
    const bodyText = section.lines.join('\n');
    sectionsHTML += `
    <div class="page-break">
      <div class="running-header">
        <span class="rh-co">ASTRO A.I. MARKETING</span>
        <span class="rh-plan">Marketing Plan &mdash; ${esc(businessName)}</span>
      </div>
      <div class="section-band">
        <div class="band-num">${idx+1}</div>
        <div class="band-title">${title}</div>
      </div>`;
    if (idx === 3) {
      const ads = parseAds(bodyText);
      ads.forEach((ad, ai) => {
        sectionsHTML += `
        <div class="ad-card">
          <div class="ad-card-top"></div>
          <div class="ad-card-body">
            <div class="ad-badge">AD VARIATION ${ai+1}</div>
            <div class="ad-headline">${ad.headline || `Ad Variation ${ai+1}`}</div>
            <div class="ad-body-text">${ad.body}</div>
            <div class="ad-cta">${ad.cta}</div>
          </div>
        </div>`;
      });
    } else {
      sectionsHTML += linesToHTML(section.lines);
    }
    sectionsHTML += `</div>`;
  });

  return PLAN_HTML_TEMPLATE
    .replace(/{{CLIENT_NAME}}/g,   esc(clientName))
    .replace(/{{BUSINESS_NAME}}/g, esc(businessName))
    .replace(/{{GENERATED_AT}}/g,  esc(generatedAt))
    .replace('{{SECTIONS_HTML}}',  sectionsHTML);
}

function htmlToPDF(html) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      source:   html,
      landscape: false,
      format:   'Letter',
      margin:   { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });
    const auth = Buffer.from(`api:${process.env.PDFSHIFT_API_KEY}`).toString('base64');
    const options = {
      hostname: 'api.pdfshift.io',
      path:     '/v3/convert/pdf',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Basic ${auth}`,
        'Content-Length':  Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200 && res.statusCode !== 201) {
          return reject(new Error(`PDFShift ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0,200)}`));
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function buildPlanPDF(planText, clientName, businessName, generatedAt) {
  const html = planToHTML(planText, clientName, businessName, generatedAt);
  return await htmlToPDF(html);
}


// ── Client HTML email template ─────────────────────────────
function buildClientEmail(clientName, businessName, dashboardUrl) {
  const firstName = (clientName || '').split(' ')[0] || 'there';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#080c28;padding:36px 40px 28px;">
          <div style="font-size:22px;font-weight:800;color:#f97316;">ASTRO A.I. MARKETING</div>
          <div style="font-size:13px;color:#b4c3d7;margin-top:6px;">Your Personalized Marketing Plan is Ready</div>
          <div style="height:3px;background:#f97316;margin-top:18px;border-radius:2px;"></div>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <p style="font-size:16px;color:#1a1a2e;font-weight:700;margin:0 0 12px;">Hi ${firstName}! 👋</p>
          <p style="font-size:14px;color:#444;line-height:1.7;margin:0 0 16px;">
            Thank you for completing your onboarding with <strong>Astro A.I. Marketing</strong>. We've reviewed everything you shared about <strong>${businessName}</strong> and our AI has generated a fully personalized marketing plan just for your business.
          </p>
          <p style="font-size:14px;color:#444;line-height:1.7;margin:0 0 24px;">Your marketing plan is attached to this email as a PDF. It includes:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${[
              ['🎯','Target Audience Breakdown','A detailed profile of your ideal customers'],
              ['📊','Platform & Budget Strategy','Where to run ads and how to allocate your budget'],
              ['📅','90-Day Campaign Roadmap','Week-by-week plan with milestones and KPIs'],
              ['✍️','Ad Copy & Headlines','Ready-to-use ads written in professional marketing language'],
              ['📋','Lead Qualification Script','A complete script to close more leads'],
              ['🏆','Competitor Positioning Tips','How to stand out and dominate your market'],
            ].map(([icon,title,desc]) => `
            <tr>
              <td width="44" style="padding:6px 0;vertical-align:top;">
                <div style="width:36px;height:36px;background:#fff7ed;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">${icon}</div>
              </td>
              <td style="padding:6px 0 6px 10px;vertical-align:top;">
                <div style="font-size:13px;font-weight:700;color:#1a1a2e;">${title}</div>
                <div style="font-size:12px;color:#888;margin-top:2px;">${desc}</div>
              </td>
            </tr>`).join('')}
          </table>
          <p style="font-size:14px;color:#444;line-height:1.7;margin:0 0 28px;">
            Our team will be in touch within <strong>3–5 business days</strong> to walk you through the plan and get your first campaign live.
          </p>
          <div style="text-align:center;margin-bottom:16px;">
            <a href="${dashboardUrl}" style="display:inline-block;background:#f97316;color:#fff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;margin-bottom:10px;">
              🚀 Open Your Marketing Command Center
            </a>
          </div>
          <div style="text-align:center;margin-bottom:28px;">
            <a href="https://link.astroaibots.com/widget/booking/fp48fbNtkGyPlqJJWEUh" style="display:inline-block;background:#080c28;color:#f97316;font-size:13px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;border:2px solid #f97316;">
              📅 Schedule Your Strategy Call
            </a>
          </div>
          <p style="font-size:12px;color:#aaa;line-height:1.6;margin:0;">
            Questions? Reply to this email or reach us at <a href="mailto:info@astroaibots.com" style="color:#f97316;">info@astroaibots.com</a>
          </p>
        </td></tr>
        <tr><td style="background:#080c18;padding:20px 40px;text-align:center;">
          <div style="font-size:11px;color:#4a5568;">© ${new Date().getFullYear()} Astro A.I. Marketing &nbsp;|&nbsp; astroaibots.com</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}



exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const clientName   = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.authSignerName || 'Client';
  const businessName = data.businessName || data.authSignerBusiness || 'Your Business';
  const clientEmail  = data.email;

  if (!clientEmail) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No client email provided' }) };
  }

  try {
    // ── Step 1: Generate marketing plan via GPT-4o ────────
    console.log('[process-plan] Generating plan for:', businessName);
    const planText = await callGPT(buildPrompt(data));
    console.log('[process-plan] Plan generated, length:', planText.length);

    // ── Step 2: Generate dashboard JSON via Claude ────────
    console.log('[process-plan] Generating dashboard JSON...');
    const rawJSON = await callClaude(buildDashboardPrompt(data, planText));
    console.log('[process-plan] Claude JSON length:', rawJSON.length);

    let dashboardJSON = {};
    try {
      const cleaned = rawJSON.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'').trim();
      dashboardJSON = JSON.parse(cleaned);
      console.log('[process-plan] JSON parsed OK, keys:', Object.keys(dashboardJSON).join(', '));
    } catch(e) {
      console.error('[process-plan] JSON parse error:', e.message, rawJSON.slice(0,200));
    }

    const dashboardHTML = buildDashboardHTML(dashboardJSON, data);
    console.log('[process-plan] HTML assembled, length:', dashboardHTML.length);

    // ── Step 3: Save to GitHub ────────────────────────────
    const slug         = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const dashboardUrl = `https://marketingplan.astroaibots.com/${slug}`;
    await saveToGitHub(slug, dashboardHTML);
    console.log('[process-plan] Dashboard saved:', dashboardUrl);

    // ── Step 4: Build PDF ─────────────────────────────────
    const generatedAt   = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const planPDFBuffer = await buildPlanPDF(planText, clientName, businessName, generatedAt);
    const planPDFBase64 = planPDFBuffer.toString('base64');
    const planFilename  = `AstroAI_MarketingPlan_${businessName.replace(/\s+/g,'_').slice(0,30)}_${new Date().toISOString().slice(0,10)}.pdf`;
    console.log('[process-plan] PDF built, size:', planPDFBuffer.length);

    // ── Step 5: Send emails ───────────────────────────────
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });

    await Promise.all([
      transporter.sendMail({
        from:        `"Astro A.I. Onboarding" <${process.env.GMAIL_USER}>`,
        to:          'info@astroaibots.com',
        subject:     `Marketing Plan Ready — ${clientName} (${businessName})`,
        html:        `<p>Plan generated for <b>${clientName}</b> at <b>${businessName}</b>.</p><p><b>Dashboard:</b> <a href="${dashboardUrl}">${dashboardUrl}</a></p><p>Generated: ${generatedAt}</p>`,
        attachments: [{ filename: planFilename, content: planPDFBase64, encoding: 'base64', contentType: 'application/pdf' }],
      }),
      transporter.sendMail({
        from:        `"Astro A.I. Marketing" <${process.env.GMAIL_USER}>`,
        to:          clientEmail,
        subject:     `Your Marketing Command Center is Ready — ${businessName}`,
        html:        buildClientEmail(clientName, businessName, dashboardUrl),
        attachments: [{ filename: planFilename, content: planPDFBase64, encoding: 'base64', contentType: 'application/pdf' }],
      }),
    ]);

    console.log('[process-plan] All done — emails sent to:', clientEmail);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, message: 'Done' }),
    };

  } catch (err) {
    console.error('[process-plan] Error:', err.message, err.stack);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
