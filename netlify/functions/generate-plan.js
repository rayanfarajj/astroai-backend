// netlify/functions/generate-plan.js
// 1. Receives full onboarding data
// 2. Sends to GPT-4 to generate a complete marketing plan
// 3. Generates a branded PDF of the plan
// 4. Emails plan PDF to owner (with auth PDF) + separate email to client

const nodemailer = require('nodemailer');
const https      = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// ── GPT-4 call ────────────────────────────────────────────
function callGPT(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 4000,
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
    padding: 54px 60px 54px 60px;
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
    opacity: 0.025;
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
  .page-break { page-break-before: always; padding-top: 54px; }

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
    bottom: 0; left: 0; right: 0;
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
    const blocks = bodyText.split(/\*\*Ad Variation \d+\*\*|Ad Variation \d+:/).filter(b=>b.trim());
    return blocks.slice(0,3).map(block => {
      const blines = block.split('\n').map(l=>l.trim()).filter(Boolean);
      let headline='', body='', cta='Learn More';
      for (const ln of blines) {
        const ll = ln.toLowerCase();
        if (ll.includes('headline:'))         headline = ln.split(':').slice(1).join(':').trim().replace(/[*"]/g,'');
        else if (ll.includes('primary text:'))body = ln.split(':').slice(1).join(':').trim().replace(/\*\*/g,'');
        else if (ll.includes('call to action:')||ll.includes('cta:')) cta = ln.split(':').slice(1).join(':').trim().replace(/[*"]/g,'');
        else if (!headline && ln.length>5 && ln.length<70) headline = ln.replace(/[*"]/g,'');
        else if (!body && ln.length>40) body = ln.replace(/\*\*/g,'');
      }
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
function buildClientEmail(clientName, businessName) {
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
          <div style="text-align:center;margin-bottom:28px;">
            <a href="https://link.astroaibots.com/widget/booking/fp48fbNtkGyPlqJJWEUh" style="display:inline-block;background:#f97316;color:#fff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;">
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
    // ── Step 1: Generate plan via GPT-4 ───────────────────
    console.log('Generating marketing plan for:', businessName);
    const prompt   = buildPrompt(data);
    const planText = await callGPT(prompt);
    console.log('Plan generated, length:', planText.length);

    // ── Step 2: Build plan PDF ─────────────────────────────
    const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
    const planPDFBuffer  = await buildPlanPDF(planText, clientName, businessName, generatedAt);
    const planPDFBase64  = planPDFBuffer.toString('base64');
    const planFilename   = `AstroAI_MarketingPlan_${businessName.replace(/\s+/g,'_').slice(0,30)}_${new Date().toISOString().slice(0,10)}.pdf`;

    // ── Step 3: Send emails ────────────────────────────────
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });

    // Email to OWNER — plan PDF attached
    const ownerEmail = {
      from:    `"Astro A.I. Onboarding" <${process.env.GMAIL_USER}>`,
      to:      'info@astroaibots.com',
      subject: `Marketing Plan Ready — ${clientName} (${businessName})`,
      text: `Marketing plan generated for ${clientName} at ${businessName}.\n\nPlan PDF attached.\n\nGenerated: ${generatedAt}`,
      attachments: [{
        filename:    planFilename,
        content:     planPDFBase64,
        encoding:    'base64',
        contentType: 'application/pdf',
      }],
    };

    // Email to CLIENT — branded HTML + plan PDF
    const clientEmailMsg = {
      from:    `"Astro A.I. Marketing" <${process.env.GMAIL_USER}>`,
      to:      clientEmail,
      subject: `Your Personalized Marketing Plan is Ready — ${businessName}`,
      html:    buildClientEmail(clientName, businessName),
      attachments: [{
        filename:    planFilename,
        content:     planPDFBase64,
        encoding:    'base64',
        contentType: 'application/pdf',
      }],
    };

    await Promise.all([
      transporter.sendMail(ownerEmail),
      transporter.sendMail(clientEmailMsg),
    ]);

    console.log('Both emails sent successfully');
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, message: 'Marketing plan generated and emailed' }),
    };

  } catch (err) {
    console.error('generate-plan error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Failed to generate plan', details: err.message }),
    };
  }
};
