// netlify/functions/process-plan.js
const nodemailer = require('nodemailer');
const https      = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  'Content-Type':                 'application/json',
};

function callGPT(prompt) {
  // Claude Sonnet for the full marketing plan
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 3000,
      system:     `You are an elite digital marketing strategist at Astro A.I. Marketing.
You create highly detailed, actionable, personalized marketing plans for small and medium businesses.
Your plans are professional, specific, and immediately usable.
Always write in clear sections with headers. Be specific — use the client's actual business name, service, location, and budget in every section.
Never use generic filler. Every recommendation must be tailored to THIS client.`,
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

// ── Claude API call for Marketing Command Center HTML ─────
function callClaude(prompt) {
  // Using Claude Haiku for speed — fast (~3-5s) and 100% Anthropic
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system:     'You are a marketing strategist. Always respond with valid JSON only. No markdown, no backticks, no explanation.',
      messages:   [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
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
  const workedWell    = d.workedWell || 'N/A';
  const notWorked     = d.notWorked || 'N/A';
  const goal90        = d.goal90Days || 'N/A';
  const limitations   = d.limitations || 'N/A';
  const adBudget      = d.adBudget || 'N/A';
  const adPlatforms   = d.adPlatforms || 'N/A';
  const serviceArea   = `${d.serviceAreaType || ''} ${d.serviceDetails || ''}`.trim();
  const finalNotes    = d.finalNotes || 'N/A';
  const responseTime  = d.responseTime || 'N/A';
  const leadHandoff   = d.leadHandoff || 'N/A';

  return `You are generating content for a premium Marketing Command Center dashboard for ${businessName}.

CRITICAL: Output ONLY a valid JSON object. No explanation, no markdown, no backticks. Raw JSON only.

Return this exact structure with rich, specific, actionable content for THIS business:

{
  "tagline": "one punchy sentence describing what ${businessName} does and who they serve",
  "stats": {
    "budget": "$${adBudget}/day",
    "platforms": "${adPlatforms}",
    "avgValue": "$${avgValue}",
    "ageRange": "${ageGroups}",
    "serviceArea": "${serviceArea}"
  },
  "avatar": {
    "initials": "2-letter initials of ideal customer first and last name archetype",
    "name": "archetypal customer first name",
    "role": "their job title or life role",
    "whoTheyAre": "3 sentences describing the ideal customer — demographics, lifestyle, situation",
    "painPoints": "3 sentences about their biggest frustrations your service solves",
    "desires": "3 sentences about what they dream of achieving",
    "qualifiers": ["qualifier 1", "qualifier 2", "qualifier 3", "qualifier 4"],
    "disqualifiers": ["disqualifier 1", "disqualifier 2", "disqualifier 3"],
    "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
  },
  "funnelStages": [
    {"label": "Stage name", "desc": "one sentence", "budget": "budget note if applicable", "color": "accent"},
    {"label": "Stage name", "desc": "one sentence", "budget": "", "color": "blue"},
    {"label": "Stage name", "desc": "one sentence", "budget": "", "color": "green"},
    {"label": "Stage name", "desc": "one sentence", "budget": "", "color": "amber"},
    {"label": "Stage name", "desc": "one sentence", "budget": "", "color": "coral"}
  ],
  "funnelPhases": [
    {"phase": "Phase 1", "badge": "ATTRACT", "badgeColor": "accent", "title": "Cold Traffic", "desc": "2 sentences on cold traffic strategy for ${businessName}"},
    {"phase": "Phase 2", "badge": "CAPTURE", "badgeColor": "green", "title": "Lead Capture", "desc": "2 sentences on capture strategy"},
    {"phase": "Phase 3", "badge": "NURTURE", "badgeColor": "amber", "title": "Build Trust", "desc": "2 sentences on nurture strategy"},
    {"phase": "Phase 4", "badge": "CONVERT", "badgeColor": "coral", "title": "Close the Sale", "desc": "2 sentences on conversion strategy"}
  ],
  "adAngles": [
    {
      "angleLabel": "Empathy",
      "angleColor": "accent",
      "ads": [
        {"title": "Version A title", "primaryText": "Full ad copy 4-6 sentences. Conversational, specific to ${businessName}.", "headline": "Short punchy headline under 40 chars", "description": "One line description", "cta": "CTA button text"},
        {"title": "Version B title", "primaryText": "Shorter version 2-3 sentences.", "headline": "Different headline angle", "description": "One line description", "cta": "CTA button text"}
      ]
    },
    {
      "angleLabel": "Pain Points",
      "angleColor": "green",
      "ads": [
        {"title": "Version A — Problem Call-Out", "primaryText": "Lead with their specific pain points. 4-5 sentences specific to ${businessName} customers.", "headline": "Problem-focused headline", "description": "Solution teaser", "cta": "CTA button text"},
        {"title": "Version B — Symptom List", "primaryText": "List format with checkmarks of their problems. 4-5 lines then solution.", "headline": "Symptom-based headline", "description": "Quick win promise", "cta": "CTA button text"}
      ]
    },
    {
      "angleLabel": "Proof & Results",
      "angleColor": "amber",
      "ads": [
        {"title": "Version A — Results Hook", "primaryText": "Lead with a specific result or transformation. 3-4 sentences.", "headline": "Results-focused headline", "description": "Social proof teaser", "cta": "CTA button text"}
      ]
    },
    {
      "angleLabel": "Curiosity",
      "angleColor": "blue",
      "ads": [
        {"title": "Version A — Education Hook", "primaryText": "Lead with a surprising fact or insight specific to ${industry}. 4-5 sentences.", "headline": "Curiosity-driven headline", "description": "What they will learn", "cta": "CTA button text"}
      ]
    },
    {
      "angleLabel": "Retargeting",
      "angleColor": "coral",
      "ads": [
        {"title": "Warm Lead Conversion", "primaryText": "Speaks to someone who already showed interest. 3-4 sentences with urgency.", "headline": "Retargeting headline", "description": "Final push", "cta": "CTA button text"},
        {"title": "Last Chance Urgency", "primaryText": "Scarcity and deadline. 2-3 sentences. Strong CTA.", "headline": "Urgency headline", "description": "Deadline or scarcity", "cta": "CTA button text"}
      ]
    }
  ],
  "targeting": {
    "demographics": ["item1", "item2", "item3", "item4"],
    "interests1": {"label": "Interest Stack 1 — Primary", "items": ["interest1", "interest2", "interest3", "interest4", "interest5"]},
    "interests2": {"label": "Interest Stack 2 — Secondary", "items": ["interest1", "interest2", "interest3", "interest4"]},
    "behaviors": ["behavior1", "behavior2", "behavior3", "behavior4"],
    "custom": ["custom audience 1", "custom audience 2", "custom audience 3", "custom audience 4"],
    "lookalike": ["lookalike 1", "lookalike 2", "lookalike 3"]
  },
  "roadmap": [
    {"week": "Week 1", "title": "Foundation & Setup", "desc": "2-3 sentences of specific actions for ${businessName}"},
    {"week": "Week 2", "title": "Launch", "desc": "2-3 sentences of specific actions"},
    {"week": "Week 3", "title": "Optimize", "desc": "2-3 sentences of specific actions"},
    {"week": "Week 4", "title": "Retarget & Nurture", "desc": "2-3 sentences of specific actions"},
    {"week": "Weeks 5–6", "title": "Scale", "desc": "2-3 sentences of specific actions"},
    {"week": "Weeks 7–8", "title": "Systemize", "desc": "2-3 sentences of specific actions"}
  ],
  "retargetFlow": [
    {"day": "Day 0–3", "title": "First Contact", "desc": "2 sentences on immediate follow-up strategy"},
    {"day": "Day 3–7", "title": "Value Delivery", "desc": "2 sentences on value-building touchpoints"},
    {"day": "Day 7–14", "title": "Authority Build", "desc": "2 sentences on social proof and credibility"},
    {"day": "Day 14–21", "title": "Direct Pitch", "desc": "2 sentences on direct offer presentation"},
    {"day": "Day 21–30", "title": "Last Chance", "desc": "2 sentences on urgency and scarcity close"}
  ],
  "automation": [
    {
      "week": "Week 1 — Welcome & Value",
      "color": "accent",
      "days": [
        {"label": "Day 0 (Opt-In)", "actions": [{"type": "email", "text": "Welcome email + lead delivery"}, {"type": "sms", "text": "SMS confirmation message"}]},
        {"label": "Day 1", "actions": [{"type": "email", "text": "Value email — educate on their main problem"}, {"type": "retarget", "text": "Retarget pixel fires — warm audience builds"}]},
        {"label": "Day 3", "actions": [{"type": "email", "text": "Educational email #2 — deeper insight"}, {"type": "sms", "text": "Check-in SMS"}]},
        {"label": "Day 5", "actions": [{"type": "email", "text": "Owner story / why we do this"}]}
      ]
    },
    {
      "week": "Week 2 — Educate & Authority",
      "color": "green",
      "days": [
        {"label": "Day 7", "actions": [{"type": "email", "text": "Authority content email"}, {"type": "retarget", "text": "Retarget: alternate offer angle"}]},
        {"label": "Day 9", "actions": [{"type": "sms", "text": "Quick tip SMS + link"}]},
        {"label": "Day 10", "actions": [{"type": "email", "text": "Educational resource / checklist email"}]},
        {"label": "Day 12", "actions": [{"type": "email", "text": "Behind the scenes / credibility email"}, {"type": "vm", "text": "Voicemail drop — personal check-in"}]}
      ]
    },
    {
      "week": "Week 3 — Social Proof & Desire",
      "color": "amber",
      "days": [
        {"label": "Day 14", "actions": [{"type": "email", "text": "Customer testimonial / case study"}, {"type": "retarget", "text": "Retarget: social proof ad"}]},
        {"label": "Day 16", "actions": [{"type": "sms", "text": "Teaser SMS about main offer"}]},
        {"label": "Day 17", "actions": [{"type": "email", "text": "Full offer breakdown email"}]},
        {"label": "Day 19", "actions": [{"type": "email", "text": "FAQ / objection handling email"}, {"type": "vm", "text": "Voicemail — personal invite"}]}
      ]
    },
    {
      "week": "Week 4 — Convert & Close",
      "color": "coral",
      "days": [
        {"label": "Day 21", "actions": [{"type": "email", "text": "Enrollment open email"}, {"type": "sms", "text": "Offer launch SMS"}, {"type": "retarget", "text": "Retarget: direct offer ad"}]},
        {"label": "Day 23", "actions": [{"type": "email", "text": "Pain of inaction email"}]},
        {"label": "Day 25", "actions": [{"type": "email", "text": "Testimonial + bonus stack email"}, {"type": "sms", "text": "Scarcity SMS"}, {"type": "vm", "text": "Last chance voicemail"}]},
        {"label": "Day 27", "actions": [{"type": "email", "text": "Final call / cart closing email"}, {"type": "sms", "text": "Closing tonight SMS"}, {"type": "retarget", "text": "Retarget: last-chance urgency ad"}]}
      ]
    }
  ],
  "qualificationScript": {
    "opening": "2-3 sentence warm opening script specific to ${businessName}",
    "questions": [
      {"q": "question text specific to ${industry}", "why": "why ask this"},
      {"q": "question text", "why": "why ask this"},
      {"q": "question text", "why": "why ask this"},
      {"q": "question text", "why": "why ask this"},
      {"q": "question text", "why": "why ask this"}
    ],
    "transition": "2 sentence transition to close",
    "objections": [
      {"obj": "most common objection in ${industry}", "response": "specific reframe response"},
      {"obj": "second common objection", "response": "specific reframe response"},
      {"obj": "third common objection", "response": "specific reframe response"}
    ]
  },
  "positioning": [
    {"tip": "positioning tip title", "desc": "2 sentence description specific to ${businessName} vs competitors"},
    {"tip": "positioning tip title", "desc": "2 sentence description"},
    {"tip": "positioning tip title", "desc": "2 sentence description"},
    {"tip": "positioning tip title", "desc": "2 sentence description"},
    {"tip": "positioning tip title", "desc": "2 sentence description"}
  ]
}

CLIENT DATA:
Business: ${businessName} | Owner: ${ownerName} | Industry: ${industry}
Service: ${primaryService} | Description: ${bizDesc}
Service Area: ${serviceArea} | Goal: ${mainGoal}
Avg Value: $${avgValue} | Budget: $${adBudget}/day | Platforms: ${adPlatforms}
Stand Out: ${standOut} | Promos: ${promotions}
Ideal Customer: ${idealCustomer} | Ages: ${ageGroups} | Gender: ${genderPref}
Interests: ${interests} | Qualified Lead: ${qualifiedLead} | Bad Lead: ${badLead}
Qualifying Qs: ${qualifyingQs} | Disqualifying Qs: ${disqualifyQs}
Custom Q1: ${customQ1} | Custom Q2: ${customQ2} | Custom Q3: ${customQ3}
Worked: ${workedWell} | Didn't Work: ${notWorked}
90-Day Goal: ${goal90} | Limitations: ${limitations}
Lead Handoff: ${leadHandoff} | Response Time: ${responseTime} | Notes: ${finalNotes}

MARKETING PLAN CONTEXT:
${planText}

Output only the JSON object now. Make every field specific to ${businessName} — no generic filler.`;
}

// ── Assemble full HTML from JSON content ───────────────────
function buildDashboardHTML(json, d) {
  const businessName  = d.businessName || d.authSignerBusiness || 'Your Business';
  const ownerName     = `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.authSignerName || 'Owner';
  const industry      = d.industry || 'N/A';
  const primaryService = d.primaryService || 'N/A';
  const bizDesc       = d.bizDescription || 'N/A';
  const companySize   = d.companySize || 'N/A';
  const website       = d.website || '#';
  const serviceArea   = `${d.serviceAreaType || ''} ${d.serviceDetails || ''}`.trim();
  const adBudget      = d.adBudget || 'N/A';
  const adPlatforms   = d.adPlatforms || 'N/A';
  const avgValue      = d.avgCustomerValue || 'N/A';
  const ageGroups     = d.ageGroups || 'N/A';
  const goal90        = d.goal90Days || 'N/A';
  const generatedAt   = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  // Initials from owner name
  const initials = ownerName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || 'AI';
  const avatarInitials = json.avatar?.initials || initials;

  // Color map
  const colorMap = {
    accent: 'var(--accent)', blue: 'var(--blue)', green: 'var(--green)',
    amber: 'var(--amber)', coral: 'var(--coral)', pink: 'var(--pink)'
  };
  const bgMap = {
    accent: 'rgba(108,92,231,0.12)', blue: 'rgba(79,172,254,0.12)',
    green: 'rgba(0,210,160,0.12)', amber: 'rgba(251,191,36,0.12)',
    coral: 'rgba(255,107,107,0.12)', pink: 'rgba(247,143,179,0.12)'
  };

  // Stats row
  const statsHTML = [
    { icon: '⚡', val: `$${adBudget}`, lbl: 'Daily Ad Budget', color: 'accent' },
    { icon: '🎯', val: adPlatforms, lbl: 'Ad Platforms', color: 'blue' },
    { icon: '💰', val: `$${avgValue}`, lbl: 'Avg Client Value', color: 'green' },
    { icon: '👥', val: ageGroups, lbl: 'Target Age Range', color: 'amber' },
    { icon: '📍', val: serviceArea.split(' ').slice(0,3).join(' ') || 'Local', lbl: 'Service Area', color: 'coral' },
  ].map(s => `
    <div class="stat-card fade-in">
      <div class="stat-icon" style="background:${bgMap[s.color]};color:${colorMap[s.color]};">${s.icon}</div>
      <div class="stat-value" style="color:${colorMap[s.color]};">${s.val}</div>
      <div class="stat-label">${s.lbl}</div>
    </div>`).join('');

  // Avatar tags
  const avatarTagsHTML = (json.avatar?.tags || []).map((t,i) => {
    const colors = ['accent','green','','','accent'];
    return `<span class="tag ${colors[i%colors.length]}">${t}</span>`;
  }).join('');

  // Qualifiers / disqualifiers
  const qualHTML = (json.avatar?.qualifiers||[]).map(q => `<span class="tag green">✓ ${q}</span>`).join('');
  const disqualHTML = (json.avatar?.disqualifiers||[]).map(q => `<span class="tag coral">✗ ${q}</span>`).join('');

  // Funnel stages
  const funnelWidths = [90, 75, 60, 45, 30, 20];
  const funnelGrads = [
    'linear-gradient(135deg,var(--accent),#8b5cf6)',
    'linear-gradient(135deg,#7c3aed,var(--blue))',
    'linear-gradient(135deg,var(--blue),var(--green))',
    'linear-gradient(135deg,var(--green),#10b981)',
    'linear-gradient(135deg,#10b981,var(--amber))',
    'linear-gradient(135deg,var(--amber),var(--coral))',
  ];
  const funnelHTML = (json.funnelStages||[]).map((s,i) => `
    <div class="funnel-stage" style="background:${funnelGrads[i%funnelGrads.length]};width:${funnelWidths[i]||20}%;max-width:${700-(i*100)}px;${i===0?'border-radius:var(--radius) var(--radius) 0 0;':''}${i===(json.funnelStages.length-1)?'border-radius:0 0 var(--radius) var(--radius);':''}clip-path:polygon(${2+i}% 0,${98-i}% 0,${95-i}% 100%,${5+i}% 100%);">
      ${s.label}${s.budget ? ` — ${s.budget}` : ''}
    </div>`).join('<div class="funnel-arrow">↓</div>');

  // Funnel phases
  const phaseColors = { accent: 'badge-accent', green: 'badge-green', amber: 'badge-amber', coral: 'badge-coral' };
  const phasesHTML = (json.funnelPhases||[]).map(p => `
    <div class="card">
      <div class="badge ${phaseColors[p.badgeColor]||'badge-accent'}" style="margin-bottom:0.75rem;">${p.badge}</div>
      <h4 style="font-size:0.9rem;font-weight:600;margin-bottom:0.4rem;">${p.title}</h4>
      <p style="font-size:0.8rem;color:var(--text);line-height:1.6;">${p.desc}</p>
    </div>`).join('');

  // Ad tabs
  const adTabBtns = (json.adAngles||[]).map((a,i) =>
    `<button class="tab-btn${i===0?' active':''}" onclick="switchTab(event,'tab-angle${i}')">${a.angleLabel}</button>`
  ).join('');

  const adTabContents = (json.adAngles||[]).map((a,i) => `
    <div class="tab-content${i===0?' active':''}" id="tab-angle${i}">
      <div class="ad-grid">
        ${(a.ads||[]).map(ad => `
        <div class="ad-card">
          <div class="ad-card-header">
            <h4>${ad.title}</h4>
            <span class="ad-angle-tag" style="background:${bgMap[a.angleColor]||bgMap.accent};color:${colorMap[a.angleColor]||colorMap.accent};">${a.angleLabel.toUpperCase()}</span>
          </div>
          <div class="ad-card-body">
            <div class="ad-field-label">Primary Text</div>
            <p>${(ad.primaryText||'').replace(/\n/g,'<br>')}</p>
            <div class="ad-field-label">Headline</div>
            <p class="headline">${ad.headline||''}</p>
            <div class="ad-field-label">Description</div>
            <p>${ad.description||''}</p>
            <div class="ad-field-label">CTA Button</div>
            <p>${ad.cta||''}</p>
            <button class="copy-btn" onclick="copyAd(this)">📋 Copy Ad Text</button>
          </div>
        </div>`).join('')}
      </div>
    </div>`).join('');

  // Targeting
  const targetHTML = `
    <div class="target-card">
      <h4>🧬 Demographics</h4>
      <ul class="target-list">${(json.targeting?.demographics||[]).map(i=>`<li>${i}</li>`).join('')}</ul>
    </div>
    <div class="target-card">
      <h4>🎯 ${json.targeting?.interests1?.label||'Interest Stack 1'}</h4>
      <ul class="target-list">${(json.targeting?.interests1?.items||[]).map(i=>`<li>${i}</li>`).join('')}</ul>
    </div>
    <div class="target-card">
      <h4>🎯 ${json.targeting?.interests2?.label||'Interest Stack 2'}</h4>
      <ul class="target-list">${(json.targeting?.interests2?.items||[]).map(i=>`<li>${i}</li>`).join('')}</ul>
    </div>
    <div class="target-card">
      <h4>📱 Behaviors</h4>
      <ul class="target-list">${(json.targeting?.behaviors||[]).map(i=>`<li>${i}</li>`).join('')}</ul>
    </div>
    <div class="target-card">
      <h4>🔄 Custom Audiences</h4>
      <ul class="target-list">${(json.targeting?.custom||[]).map(i=>`<li>${i}</li>`).join('')}</ul>
    </div>
    <div class="target-card">
      <h4>👯 Lookalike Audiences</h4>
      <ul class="target-list">${(json.targeting?.lookalike||[]).map(i=>`<li>${i}</li>`).join('')}</ul>
    </div>`;

  // Roadmap
  const roadmapHTML = (json.roadmap||[]).map(r => `
    <div class="tl-item">
      <div class="tl-week">${r.week}</div>
      <h4>${r.title}</h4>
      <p>${r.desc}</p>
    </div>`).join('');

  // Retarget flow
  const retargetHTML = (json.retargetFlow||[]).map(r => `
    <div class="retarget-node">
      <div class="rn-label">${r.day}</div>
      <div class="rn-title">${r.title}</div>
      <div class="rn-desc">${r.desc}</div>
    </div>`).join('');

  // Automation
  const dotClass = { email: 'dot-email', sms: 'dot-sms', vm: 'dot-vm', retarget: 'dot-retarget' };
  const automationHTML = (json.automation||[]).map(w => `
    <div class="auto-week">
      <div class="auto-week-header" style="background:linear-gradient(135deg,${bgMap[w.color]||bgMap.accent},transparent);">${w.week}</div>
      ${(w.days||[]).map(day => `
      <div class="auto-day">
        <div class="day-label">${day.label}</div>
        ${(day.actions||[]).map(a => `
        <div class="action"><span class="action-dot ${dotClass[a.type]||'dot-email'}"></span> ${a.text}</div>`).join('')}
      </div>`).join('')}
    </div>`).join('');

  // Script
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

  // Positioning
  const positioningHTML = (json.positioning||[]).map((p,i) => `
    <div class="fp-card">
      <div class="fp-num">${String(i+1).padStart(2,'0')}</div>
      <h4>${p.tip}</h4>
      <p>${p.desc}</p>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${businessName} — Marketing Command Center</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"><\/script>
<style>
:root {
  --bg:#0a0a0f; --surface:#12121a; --surface-2:#1a1a26; --surface-3:#22222f;
  --border:rgba(255,255,255,0.09); --border-hover:rgba(255,255,255,0.18);
  --text:#eeeef2; --text-dim:#b0b0c8; --text-muted:#7e7e9a;
  --accent:#7c6ef0; --accent-glow:rgba(108,92,231,0.25);
  --green:#1de9b6; --green-glow:rgba(0,210,160,0.2);
  --coral:#ff8787; --coral-glow:rgba(255,107,107,0.2);
  --amber:#fcd34d; --amber-glow:rgba(251,191,36,0.2);
  --blue:#69b4ff; --blue-glow:rgba(79,172,254,0.2);
  --pink:#f78fb3;
  --radius:12px; --radius-lg:20px;
  --font:'DM Sans',sans-serif; --mono:'Space Mono',monospace;
}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{background:var(--bg);color:var(--text);font-family:var(--font);line-height:1.6;overflow-x:hidden;}
::selection{background:var(--accent);color:#fff;}
::-webkit-scrollbar{width:6px;}::-webkit-scrollbar-track{background:var(--bg);}::-webkit-scrollbar-thumb{background:var(--surface-3);border-radius:3px;}
.nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(10,10,15,0.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);padding:0 2rem;height:60px;display:flex;align-items:center;justify-content:space-between;}
.nav-brand{font-weight:700;font-size:0.85rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text);}
.nav-brand span{color:var(--accent);}
.nav-links{display:flex;gap:0.25rem;}
.nav-links a{color:var(--text-dim);text-decoration:none;font-size:0.75rem;font-weight:600;padding:0.4rem 0.8rem;border-radius:6px;transition:all 0.2s;letter-spacing:0.02em;}
.nav-links a:hover{color:var(--text);background:var(--surface-2);}
.hero{padding:120px 2rem 60px;max-width:1200px;margin:0 auto;position:relative;}
.hero::before{content:'';position:absolute;top:60px;left:50%;transform:translateX(-50%);width:600px;height:600px;background:radial-gradient(circle,var(--accent-glow) 0%,transparent 70%);pointer-events:none;opacity:0.4;}
.hero-label{font-family:var(--mono);font-size:0.7rem;color:var(--accent);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;}
.hero-label::before{content:'';width:8px;height:8px;background:var(--accent);border-radius:50%;animation:pulse 2s infinite;}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 var(--accent-glow);}50%{opacity:0.7;box-shadow:0 0 0 8px transparent;}}
.hero h1{font-size:clamp(2rem,5vw,3.5rem);font-weight:700;line-height:1.15;margin-bottom:1rem;background:linear-gradient(135deg,var(--text) 0%,var(--text-dim) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.hero p{color:var(--text-dim);font-size:1.05rem;max-width:600px;margin-bottom:2rem;}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;max-width:1200px;margin:0 auto 3rem;padding:0 2rem;}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;transition:border-color 0.3s;}
.stat-card:hover{border-color:var(--border-hover);}
.stat-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:0.9rem;margin-bottom:0.75rem;}
.stat-value{font-size:1.5rem;font-weight:700;margin-bottom:0.15rem;}
.stat-label{font-size:0.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;}
.section{max-width:1200px;margin:0 auto;padding:3rem 2rem;}
.section-header{margin-bottom:2rem;}
.section-label{font-family:var(--mono);font-size:0.65rem;color:var(--accent);letter-spacing:0.15em;text-transform:uppercase;margin-bottom:0.5rem;}
.section-title{font-size:1.6rem;font-weight:700;}
.section-desc{color:var(--text-dim);font-size:0.9rem;margin-top:0.5rem;max-width:600px;}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.5rem;transition:all 0.3s;}
.card:hover{border-color:var(--border-hover);transform:translateY(-2px);}
.profile-grid{display:grid;grid-template-columns:300px 1fr;gap:1.5rem;}
@media(max-width:768px){.profile-grid{grid-template-columns:1fr;}}
.avatar-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:2rem;text-align:center;}
.avatar-ring{width:100px;height:100px;border-radius:50%;background:conic-gradient(var(--accent) 0%,var(--green) 33%,var(--amber) 66%,var(--accent) 100%);padding:3px;margin:0 auto 1rem;animation:spin 8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.avatar-inner{width:100%;height:100%;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:var(--accent);}
.avatar-name{font-size:1.1rem;font-weight:600;margin-bottom:0.25rem;}
.avatar-role{font-size:0.8rem;color:var(--text-dim);margin-bottom:1rem;}
.avatar-tags{display:flex;flex-wrap:wrap;gap:0.4rem;justify-content:center;}
.tag{font-size:0.65rem;padding:0.3rem 0.6rem;border-radius:20px;border:1px solid var(--border);color:var(--text-dim);letter-spacing:0.03em;font-weight:500;display:inline-block;margin:0.15rem;}
.tag.accent{border-color:rgba(108,92,231,0.3);color:var(--accent);background:rgba(108,92,231,0.08);}
.tag.green{border-color:rgba(0,210,160,0.3);color:var(--green);background:rgba(0,210,160,0.08);}
.tag.coral{border-color:rgba(255,107,107,0.3);color:var(--coral);background:rgba(255,107,107,0.08);}
.tag.amber{border-color:rgba(251,191,36,0.3);color:var(--amber);background:rgba(251,191,36,0.08);}
.profile-details{display:grid;grid-template-columns:1fr 1fr;gap:1rem;}
@media(max-width:600px){.profile-details{grid-template-columns:1fr;}}
.detail-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.25rem;}
.detail-item .label{font-size:0.65rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.3rem;font-weight:600;}
.detail-item .value{font-size:0.95rem;font-weight:500;}
.tabs{display:flex;gap:0.25rem;margin-bottom:1.5rem;border-bottom:1px solid var(--border);padding-bottom:0.5rem;overflow-x:auto;}
.tab-btn{background:none;border:none;color:var(--text-dim);font-family:var(--font);font-size:0.8rem;font-weight:600;padding:0.5rem 1rem;border-radius:8px 8px 0 0;cursor:pointer;transition:all 0.2s;white-space:nowrap;}
.tab-btn:hover{color:var(--text);}
.tab-btn.active{color:var(--accent);background:rgba(108,92,231,0.08);border-bottom:2px solid var(--accent);}
.tab-content{display:none;animation:fadeUp 0.3s ease;}
.tab-content.active{display:block;}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
.funnel-visual{display:flex;flex-direction:column;align-items:center;gap:0;margin:2rem 0;}
.funnel-stage{position:relative;text-align:center;padding:1rem 2rem;color:#fff;font-weight:700;font-size:0.85rem;transition:transform 0.3s;text-shadow:0 1px 3px rgba(0,0,0,0.4);}
.funnel-stage:hover{transform:scale(1.03);}
.funnel-arrow{color:var(--text-dim);font-size:1.2rem;margin:0.25rem 0;}
.ad-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem;}
.ad-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;transition:all 0.3s;}
.ad-card:hover{border-color:var(--border-hover);transform:translateY(-2px);}
.ad-card-header{padding:1rem 1.25rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.ad-card-header h4{font-size:0.85rem;font-weight:600;}
.ad-angle-tag{font-size:0.6rem;padding:0.2rem 0.5rem;border-radius:4px;font-weight:600;letter-spacing:0.05em;}
.ad-card-body{padding:1.25rem;}
.ad-field-label{font-size:0.6rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.3rem;margin-top:1rem;font-weight:600;}
.ad-field-label:first-child{margin-top:0;}
.ad-card-body p{font-size:0.85rem;color:var(--text);line-height:1.6;}
.ad-card-body .headline{font-size:0.95rem;font-weight:600;color:var(--text);}
.copy-btn{display:inline-flex;align-items:center;gap:0.4rem;margin-top:1rem;padding:0.5rem 1rem;background:var(--surface-3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:var(--font);font-size:0.72rem;font-weight:500;cursor:pointer;transition:all 0.2s;}
.copy-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent);}
.target-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:1rem;}
.target-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;}
.target-card h4{font-size:0.8rem;font-weight:600;margin-bottom:0.75rem;display:flex;align-items:center;gap:0.5rem;}
.target-list{list-style:none;font-size:0.78rem;color:var(--text);}
.target-list li{padding:0.3rem 0;padding-left:1rem;position:relative;}
.target-list li::before{content:'';position:absolute;left:0;top:0.65rem;width:4px;height:4px;border-radius:50%;background:var(--accent);}
.timeline{position:relative;padding-left:2rem;}
.timeline::before{content:'';position:absolute;left:7px;top:0;bottom:0;width:2px;background:linear-gradient(180deg,var(--accent),var(--green),var(--amber),var(--coral));border-radius:2px;}
.tl-item{position:relative;margin-bottom:2rem;padding:1.25rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);transition:all 0.3s;}
.tl-item:hover{border-color:var(--border-hover);}
.tl-item::before{content:'';position:absolute;left:-2rem;top:1.5rem;width:12px;height:12px;border-radius:50%;border:2px solid var(--accent);background:var(--bg);transform:translateX(-1px);}
.tl-week{font-family:var(--mono);font-size:0.65rem;color:var(--accent);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.4rem;}
.tl-item h4{font-size:0.95rem;font-weight:600;margin-bottom:0.5rem;}
.tl-item p{font-size:0.8rem;color:var(--text-dim);line-height:1.6;}
.retarget-flow{display:flex;align-items:stretch;gap:1rem;overflow-x:auto;padding-bottom:1rem;}
.retarget-node{min-width:220px;flex-shrink:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;position:relative;}
.retarget-node::after{content:'→';position:absolute;right:-0.85rem;top:50%;transform:translateY(-50%);color:var(--text-dim);font-size:1rem;font-weight:700;}
.retarget-node:last-child::after{display:none;}
.rn-label{font-size:0.6rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:0.4rem;font-weight:600;}
.rn-title{font-size:0.9rem;font-weight:600;margin-bottom:0.4rem;}
.rn-desc{font-size:0.75rem;color:var(--text-dim);line-height:1.5;}
.auto-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;}
@media(max-width:900px){.auto-grid{grid-template-columns:repeat(2,1fr);}}
@media(max-width:500px){.auto-grid{grid-template-columns:1fr;}}
.auto-week{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;}
.auto-week-header{padding:1rem;font-weight:600;font-size:0.85rem;border-bottom:1px solid var(--border);}
.auto-day{padding:0.75rem 1rem;border-bottom:1px solid var(--border);font-size:0.75rem;}
.auto-day:last-child{border-bottom:none;}
.day-label{font-weight:700;font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.3rem;}
.action{display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem;color:var(--text);}
.action-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
.dot-email{background:var(--accent);}
.dot-sms{background:var(--green);}
.dot-vm{background:var(--amber);}
.dot-retarget{background:var(--coral);}
.legend{display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;}
.legend-item{display:flex;align-items:center;gap:0.4rem;font-size:0.72rem;color:var(--text);font-weight:500;}
.chart-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1.5rem;margin-bottom:1.5rem;}
.chart-wrap canvas{max-height:300px;}
.script-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;margin-bottom:1rem;}
.script-heading{font-size:0.7rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;margin-bottom:0.75rem;}
.script-text{font-size:0.85rem;color:var(--text-dim);line-height:1.7;}
.script-q{background:var(--surface-2);border-radius:8px;padding:1rem;margin-bottom:0.75rem;border-left:3px solid var(--accent);}
.q-num{font-family:var(--mono);font-size:0.6rem;color:var(--accent);font-weight:700;margin-bottom:0.3rem;}
.q-text{font-size:0.88rem;font-weight:600;margin-bottom:0.2rem;}
.q-why{font-size:0.75rem;color:var(--text-muted);}
.objection{background:var(--surface-2);border-radius:8px;padding:1rem;margin-bottom:0.75rem;}
.obj-text{font-size:0.82rem;color:var(--coral);margin-bottom:0.4rem;}
.obj-response{font-size:0.82rem;color:var(--green);}
.fp-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;position:relative;transition:all 0.3s;}
.fp-card:hover{border-color:var(--border-hover);}
.fp-num{font-family:var(--mono);font-size:2rem;font-weight:700;color:var(--surface-3);position:absolute;top:0.75rem;right:1rem;}
.fp-card h4{font-size:0.9rem;font-weight:600;margin-bottom:0.5rem;color:var(--accent);padding-right:3rem;}
.fp-card p{font-size:0.78rem;color:var(--text-dim);line-height:1.5;}
.fp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;}
.badge{display:inline-flex;align-items:center;gap:0.3rem;font-size:0.65rem;font-weight:600;padding:0.25rem 0.6rem;border-radius:20px;}
.badge-green{background:rgba(0,210,160,0.1);color:var(--green);}
.badge-amber{background:rgba(251,191,36,0.1);color:var(--amber);}
.badge-coral{background:rgba(255,107,107,0.1);color:var(--coral);}
.badge-accent{background:rgba(108,92,231,0.1);color:var(--accent);}
.data-table{width:100%;border-collapse:collapse;font-size:0.8rem;}
.data-table th{text-align:left;padding:0.75rem 1rem;font-size:0.65rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.1em;border-bottom:1px solid var(--border);font-weight:700;}
.data-table td{padding:0.75rem 1rem;border-bottom:1px solid var(--border);color:var(--text);}
.data-table tr:hover td{background:rgba(255,255,255,0.02);}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;}
.grid3{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;}
.next-card{background:linear-gradient(135deg,var(--surface),var(--surface-2));border:2px solid var(--accent);border-radius:var(--radius-lg);padding:3rem;text-align:center;}
.next-card h2{font-size:1.8rem;font-weight:700;margin-bottom:1rem;}
.next-card p{color:var(--text-dim);font-size:0.95rem;margin-bottom:2rem;max-width:500px;margin-left:auto;margin-right:auto;}
.btn-primary{display:inline-block;background:linear-gradient(135deg,var(--accent),#8b5cf6);color:#fff;font-size:1rem;font-weight:700;padding:1rem 3rem;border-radius:50px;text-decoration:none;box-shadow:0 10px 30px var(--accent-glow);transition:all 0.3s;}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 15px 40px var(--accent-glow);}
.footer{text-align:center;padding:3rem 2rem;border-top:1px solid var(--border);margin-top:3rem;}
.footer p{font-size:0.72rem;color:var(--text-dim);}
.fade-in{opacity:0;transform:translateY(20px);transition:opacity 0.6s ease,transform 0.6s ease;}
.fade-in.visible{opacity:1;transform:translateY(0);}
@media(max-width:768px){.nav-links{display:none;}.hero h1{font-size:1.8rem;}.section{padding:2rem 1rem;}.stats-row{padding:0 1rem;}.retarget-flow{flex-direction:column;}.retarget-node::after{content:'↓';right:50%;top:auto;bottom:-0.7rem;transform:translateX(50%);}}
</style>
</head>
<body>

<nav class="nav">
  <div class="nav-brand"><span>${businessName.split(' ')[0].toUpperCase()}</span> — Command Center</div>
  <div class="nav-links">
    <a href="#profile">Profile</a>
    <a href="#funnel">Funnel</a>
    <a href="#ads">Ad Copy</a>
    <a href="#targeting">Targeting</a>
    <a href="#roadmap">Roadmap</a>
    <a href="#retargeting">Retargeting</a>
    <a href="#automation">Automation</a>
    <a href="#script">Script</a>
    <a href="#positioning">Positioning</a>
  </div>
</nav>

<section class="hero">
  <div class="hero-label">Marketing Strategy Dashboard — Live</div>
  <h1>${businessName}<br>${industry} Blueprint</h1>
  <p>Complete marketing command center for ${ownerName}'s ${businessName}. Every ad angle, funnel strategy, automation sequence, and retargeting plan — in one place.</p>
</section>

<div class="stats-row">${statsHTML}</div>

<!-- 01 PROFILE -->
<section class="section fade-in" id="profile">
  <div class="section-header">
    <div class="section-label">01 / Client Profile</div>
    <div class="section-title">Dream Client Avatar & Business Overview</div>
  </div>
  <div class="profile-grid">
    <div class="avatar-card">
      <div class="avatar-ring"><div class="avatar-inner">${avatarInitials}</div></div>
      <div class="avatar-name">${json.avatar?.name || 'Ideal Client'}</div>
      <div class="avatar-role">${json.avatar?.role || industry + ' Customer'}</div>
      <div class="avatar-tags">${avatarTagsHTML}</div>
    </div>
    <div class="profile-details">
      <div class="detail-item"><div class="label">Business</div><div class="value">${businessName}</div></div>
      <div class="detail-item"><div class="label">Owner</div><div class="value">${ownerName}</div></div>
      <div class="detail-item"><div class="label">Industry</div><div class="value">${industry}</div></div>
      <div class="detail-item"><div class="label">Primary Service</div><div class="value">${primaryService}</div></div>
      <div class="detail-item"><div class="label">Description</div><div class="value">${bizDesc}</div></div>
      <div class="detail-item"><div class="label">Team Size</div><div class="value">${companySize}</div></div>
      <div class="detail-item"><div class="label">Service Area</div><div class="value">${serviceArea}</div></div>
      <div class="detail-item"><div class="label">90-Day Goal</div><div class="value">${goal90}</div></div>
    </div>
  </div>
  <div style="margin-top:2rem;">
    <h3 style="font-size:1.1rem;font-weight:600;margin-bottom:1rem;">🎯 Dream Client Avatar</h3>
    <div class="profile-details" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr));">
      <div class="detail-item"><div class="label">Who They Are</div><div class="value">${json.avatar?.whoTheyAre||''}</div></div>
      <div class="detail-item"><div class="label">Pain Points</div><div class="value">${json.avatar?.painPoints||''}</div></div>
      <div class="detail-item"><div class="label">What They Want</div><div class="value">${json.avatar?.desires||''}</div></div>
      <div class="detail-item">
        <div class="label">Qualifiers ✅</div>
        <div class="value" style="margin-top:0.4rem;">${qualHTML}</div>
      </div>
      <div class="detail-item">
        <div class="label">Disqualifiers ❌</div>
        <div class="value" style="margin-top:0.4rem;">${disqualHTML}</div>
      </div>
    </div>
  </div>
</section>

<!-- 02 FUNNEL -->
<section class="section fade-in" id="funnel">
  <div class="section-header">
    <div class="section-label">02 / Funnel Architecture</div>
    <div class="section-title">Lead-to-Sale Conversion Path</div>
    <div class="section-desc">Every touchpoint drives toward your core offer. The funnel is designed to attract, capture, nurture, and convert.</div>
  </div>
  <div class="chart-wrap">
    <canvas id="funnelChart"></canvas>
  </div>
  <div class="funnel-visual">${funnelHTML}</div>
  <div class="grid3" style="margin-top:2rem;">${phasesHTML}</div>
</section>

<!-- 03 AD COPY -->
<section class="section fade-in" id="ads">
  <div class="section-header">
    <div class="section-label">03 / Ad Copy</div>
    <div class="section-title">Ready-to-Deploy Ad Creatives</div>
    <div class="section-desc">Multiple angles for ${businessName}. Test all, kill losers after 72 hours, scale the winners.</div>
  </div>
  <div class="tabs">${adTabBtns}</div>
  ${adTabContents}
</section>

<!-- 04 TARGETING -->
<section class="section fade-in" id="targeting">
  <div class="section-header">
    <div class="section-label">04 / Targeting Strategy</div>
    <div class="section-title">Audience Architecture</div>
    <div class="section-desc">Layered targeting on ${adPlatforms} for maximum return on your $${adBudget}/day budget.</div>
  </div>
  <div class="target-grid">${targetHTML}</div>
  <div class="chart-wrap" style="margin-top:1.5rem;">
    <canvas id="budgetChart"></canvas>
  </div>
</section>

<!-- 05 ROADMAP -->
<section class="section fade-in" id="roadmap">
  <div class="section-header">
    <div class="section-label">05 / 8-Week Roadmap</div>
    <div class="section-title">Phase-by-Phase Execution Plan</div>
    <div class="section-desc">Week-by-week actions to hit: ${goal90}</div>
  </div>
  <div class="timeline">${roadmapHTML}</div>
</section>

<!-- 06 RETARGETING -->
<section class="section fade-in" id="retargeting">
  <div class="section-header">
    <div class="section-label">06 / Retargeting Strategy</div>
    <div class="section-title">Warm Audience Conversion Plan</div>
    <div class="section-desc">Targeting people who've already engaged but haven't converted yet.</div>
  </div>
  <div class="retarget-flow">${retargetHTML}</div>
  <div class="chart-wrap" style="margin-top:1.5rem;">
    <canvas id="retargetChart"></canvas>
  </div>
</section>

<!-- 07 AUTOMATION -->
<section class="section fade-in" id="automation">
  <div class="section-header">
    <div class="section-label">07 / 4-Week Automation Sequence</div>
    <div class="section-title">Email · SMS · Voicemail · Retargeting</div>
    <div class="section-desc">Complete 28-day automation roadmap to nurture cold leads into paying clients.</div>
  </div>
  <div class="legend">
    <div class="legend-item"><span style="width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block;"></span> Email</div>
    <div class="legend-item"><span style="width:10px;height:10px;border-radius:50%;background:var(--green);display:inline-block;"></span> SMS</div>
    <div class="legend-item"><span style="width:10px;height:10px;border-radius:50%;background:var(--amber);display:inline-block;"></span> Voicemail Drop</div>
    <div class="legend-item"><span style="width:10px;height:10px;border-radius:50%;background:var(--coral);display:inline-block;"></span> Retarget Ad Active</div>
  </div>
  <div class="auto-grid">${automationHTML}</div>
  <div style="margin-top:2rem;overflow-x:auto;">
    <table class="data-table">
      <thead><tr><th>Channel</th><th>Total Touches</th><th>Purpose</th><th>Tone Progression</th></tr></thead>
      <tbody>
        <tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:6px;"></span>Email</td><td>12 emails</td><td>Primary nurture, education, and conversion</td><td>Value → Authority → Desire → Urgency</td></tr>
        <tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px;"></span>SMS</td><td>7 texts</td><td>Quick touchpoints, reminders, urgency</td><td>Friendly → Curious → Direct → Urgent</td></tr>
        <tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--amber);margin-right:6px;"></span>Voicemail</td><td>3 drops</td><td>Personal connection from owner</td><td>Check-in → Invitation → Last chance</td></tr>
        <tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--coral);margin-right:6px;"></span>Retarget Ads</td><td>5 phases</td><td>Visual reinforcement across platforms</td><td>New offer → Social proof → Direct pitch → Scarcity</td></tr>
      </tbody>
    </table>
  </div>
</section>

<!-- 08 SCRIPT -->
<section class="section fade-in" id="script">
  <div class="section-header">
    <div class="section-label">08 / Lead Qualification Script</div>
    <div class="section-title">Ready-to-Use Call Script</div>
  </div>
  <div class="grid2">
    <div>
      <div class="script-box">
        <div class="script-heading">Opening</div>
        <div class="script-text">${json.qualificationScript?.opening||''}</div>
      </div>
      <div class="script-heading" style="margin:1.5rem 0 0.75rem;font-size:0.7rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Qualifying Questions</div>
      ${scriptQsHTML}
      <div class="script-box" style="margin-top:1rem;">
        <div class="script-heading">Transition to Close</div>
        <div class="script-text">${json.qualificationScript?.transition||''}</div>
      </div>
    </div>
    <div>
      <div class="script-heading" style="margin-bottom:0.75rem;font-size:0.7rem;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;font-weight:700;">Objection Handling</div>
      ${objectionsHTML}
    </div>
  </div>
</section>

<!-- 09 POSITIONING -->
<section class="section fade-in" id="positioning">
  <div class="section-header">
    <div class="section-label">09 / Competitor Positioning</div>
    <div class="section-title">5 Ways to Stand Above the Competition</div>
  </div>
  <div class="fp-grid">${positioningHTML}</div>
</section>

<!-- NEXT STEPS -->
<section class="section fade-in">
  <div class="next-card">
    <h2>Ready to Launch? 🚀</h2>
    <p>Your Marketing Command Center for ${businessName} is live. Schedule your strategy call to get your campaigns running within 48 hours.</p>
    <a href="https://link.astroaibots.com/widget/booking/fp48fbNtkGyPlqJJWEUh" class="btn-primary">📅 Schedule Your Strategy Call</a>
  </div>
</section>

<footer class="footer">
  <p>${businessName} — Marketing Command Center &nbsp;|&nbsp; Prepared by Astro A.I. Marketing &nbsp;|&nbsp; Generated ${generatedAt}</p>
</footer>

<script>
function switchTab(e, tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  e.target.classList.add('active');
  document.getElementById(tabId).classList.add('active');
}
function copyAd(btn) {
  const body = btn.closest('.ad-card-body');
  const texts = [];
  body.querySelectorAll('p').forEach(p => { if (!p.classList.contains('headline')) texts.push(p.textContent); });
  const headline = body.querySelector('.headline');
  let full = (texts[0]||'') + '\\n\\nHeadline: ' + (headline ? headline.textContent : '') + '\\nDescription: ' + (texts[1]||'');
  navigator.clipboard.writeText(full).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy Ad Text', 2000);
  });
}
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));

const chartDefaults = {
  responsive: true, maintainAspectRatio: true,
  plugins: { legend: { labels: { color: '#b0b0c8', font: { family: 'DM Sans', size: 11 } } } },
  scales: {
    x: { ticks: { color: '#7e7e9a', font: { family: 'DM Sans', size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
    y: { ticks: { color: '#7e7e9a', font: { family: 'DM Sans', size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } }
  }
};

new Chart(document.getElementById('funnelChart'), {
  type: 'bar',
  data: {
    labels: ['Impressions', 'Clicks', 'Landing Page Views', 'Leads (Opt-Ins)', 'Qualified Leads', 'New Clients'],
    datasets: [{
      label: 'Estimated Monthly Volume ($${adBudget}/day)',
      data: [45000, 1800, 1350, 270, 81, 16],
      backgroundColor: ['rgba(108,92,231,0.6)','rgba(108,92,231,0.5)','rgba(79,172,254,0.5)','rgba(0,210,160,0.5)','rgba(251,191,36,0.5)','rgba(255,107,107,0.6)'],
      borderColor: ['#6c5ce7','#6c5ce7','#4facfe','#00d2a0','#fbbf24','#ff6b6b'],
      borderWidth: 1, borderRadius: 6
    }]
  },
  options: { ...chartDefaults, indexAxis: 'y', plugins: { ...chartDefaults.plugins, title: { display: true, text: 'Projected Funnel Volume (Monthly Estimate)', color: '#eeeef2', font: { family: 'DM Sans', size: 13, weight: 600 } } } }
});

new Chart(document.getElementById('budgetChart'), {
  type: 'doughnut',
  data: {
    labels: ['Cold Traffic — Lead Gen', 'Retargeting — Warm Leads'],
    datasets: [{ data: [Math.round(${adBudget}*0.67), Math.round(${adBudget}*0.33)], backgroundColor: ['rgba(108,92,231,0.7)','rgba(255,107,107,0.7)'], borderColor: ['#6c5ce7','#ff6b6b'], borderWidth: 2, hoverOffset: 8 }]
  },
  options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: '#b0b0c8', font: { family: 'DM Sans', size: 12 }, padding: 20 } }, title: { display: true, text: 'Daily Budget Split — $${adBudget}/day', color: '#eeeef2', font: { family: 'DM Sans', size: 13, weight: 600 } } } }
});

new Chart(document.getElementById('retargetChart'), {
  type: 'line',
  data: {
    labels: ['Day 0','Day 3','Day 7','Day 10','Day 14','Day 17','Day 21','Day 25','Day 28'],
    datasets: [
      { label: 'Ad Intensity', data: [1,2,3,4,5,6,8,9,10], borderColor: '#ff6b6b', backgroundColor: 'rgba(255,107,107,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
      { label: 'Email / SMS Frequency', data: [2,3,3,4,5,5,7,8,9], borderColor: '#6c5ce7', backgroundColor: 'rgba(108,92,231,0.1)', fill: true, tension: 0.4, pointRadius: 4 },
      { label: 'Buying Intent (Est.)', data: [1,1,2,3,4,5,6,8,9], borderColor: '#00d2a0', backgroundColor: 'rgba(0,210,160,0.1)', fill: true, tension: 0.4, pointRadius: 4 }
    ]
  },
  options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, title: { display: true, text: 'Retargeting Pressure Curve — 28-Day Warm-Up', color: '#eeeef2', font: { family: 'DM Sans', size: 13, weight: 600 } } }, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, min: 0, max: 10, ticks: { ...chartDefaults.scales.y.ticks, stepSize: 2 } } } }
});
<\/script>
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
    console.log('[process-plan] Starting for:', businessName);

    const rawJSON = await callClaude(buildDashboardPrompt(data, ''));
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

    const slug         = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const dashboardUrl = `https://marketingplan.astroaibots.com/${slug}`;
    await saveToGitHub(slug, dashboardHTML);
    console.log('[process-plan] Saved to GitHub:', dashboardUrl);

    const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });

    await Promise.all([
      transporter.sendMail({
        from:    `"Astro A.I. Onboarding" <${process.env.GMAIL_USER}>`,
        to:      'info@astroaibots.com',
        subject: `Marketing Plan Ready — ${clientName} (${businessName})`,
        html:    `<p>Plan generated for <b>${clientName}</b> at <b>${businessName}</b>.</p><p><b>Dashboard:</b> <a href="${dashboardUrl}">${dashboardUrl}</a></p><p>Generated: ${generatedAt}</p>`,
      }),
      transporter.sendMail({
        from:    `"Astro A.I. Marketing" <${process.env.GMAIL_USER}>`,
        to:      clientEmail,
        subject: `Your Marketing Command Center is Ready — ${businessName}`,
        html:    buildClientEmail(clientName, businessName, dashboardUrl),
      }),
    ]);

    console.log('[process-plan] All done — emails sent to:', clientEmail);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true }),
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
