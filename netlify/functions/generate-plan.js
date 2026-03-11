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

// ── Minimal PDF builder (pure Node.js, no jsPDF) ──────────
// Uses raw PDF syntax to create a clean text-based PDF
function buildPlanPDF(planText, clientName, businessName, generatedAt) {
  const lines = [];
  const safeStr = (s) => String(s || '').replace(/[()\\]/g, c => '\\' + c);

  // Parse sections from markdown
  const sections = [];
  let currentSection = null;
  planText.split('\n').forEach(line => {
    if (line.startsWith('## ')) {
      if (currentSection) sections.push(currentSection);
      currentSection = { title: line.replace('## ', '').trim(), body: [] };
    } else if (currentSection) {
      currentSection.body.push(line);
    }
  });
  if (currentSection) sections.push(currentSection);

  // Build PDF content stream
  const contentLines = [];
  const FONT_NORMAL = '/F1';
  const FONT_BOLD   = '/F2';
  const PAGE_W = 612, PAGE_H = 792;
  const MARGIN = 54;
  const MAX_W  = PAGE_W - MARGIN * 2;
  const LINE_H = 14;
  const SECTION_H = 20;

  function wrapText(text, charsPerLine) {
    if (!text.trim()) return [''];
    const words = text.split(' ');
    const wrapped = [];
    let current = '';
    words.forEach(word => {
      if ((current + ' ' + word).length > charsPerLine) {
        if (current) wrapped.push(current.trim());
        current = word;
      } else {
        current = current ? current + ' ' + word : word;
      }
    });
    if (current) wrapped.push(current.trim());
    return wrapped.length ? wrapped : [''];
  }

  // We'll build pages as arrays of PDF commands
  const pages = [];
  let currentPageLines = [];
  let yPos = PAGE_H - 120; // start below header

  function newPage() {
    pages.push(currentPageLines.slice());
    currentPageLines = [];
    yPos = PAGE_H - 60;
  }

  function addText(text, fontSize, isBold, r, g, b) {
    const font = isBold ? FONT_BOLD : FONT_NORMAL;
    const charsPerLine = Math.floor(MAX_W / (fontSize * 0.5));
    const wrapped = wrapText(text, charsPerLine);

    wrapped.forEach(wline => {
      if (yPos < 80) newPage();
      currentPageLines.push(`BT ${font} ${fontSize} Tf ${r||0} ${g||0} ${b||0} rg ${MARGIN} ${yPos} Td (${safeStr(wline)}) Tj ET`);
      yPos -= LINE_H;
    });
  }

  // Header section
  currentPageLines.push(`0.031 0.047 0.157 rg ${MARGIN - 10} ${PAGE_H - 10} m ${PAGE_W - MARGIN + 10} ${PAGE_H - 10} l ${PAGE_W - MARGIN + 10} ${PAGE_H - 90} l ${MARGIN - 10} ${PAGE_H - 90} l h f`);
  currentPageLines.push(`BT ${FONT_BOLD} 22 Tf 0.980 0.451 0.086 rg ${MARGIN} ${PAGE_H - 42} Td (ASTRO A.I. MARKETING) Tj ET`);
  currentPageLines.push(`BT ${FONT_NORMAL} 11 Tf 0.706 0.765 0.843 rg ${MARGIN} ${PAGE_H - 60} Td (Personalized Marketing Plan) Tj ET`);
  currentPageLines.push(`BT ${FONT_BOLD} 13 Tf 1 1 1 rg ${MARGIN} ${PAGE_H - 78} Td (${safeStr(businessName)}) Tj ET`);
  currentPageLines.push(`BT ${FONT_NORMAL} 9 Tf 0.549 0.608 0.667 rg ${MARGIN} ${PAGE_H - 92} Td (Prepared for: ${safeStr(clientName)}  |  Generated: ${safeStr(generatedAt)}) Tj ET`);
  // Orange accent line
  currentPageLines.push(`0.980 0.451 0.086 rg ${MARGIN - 10} ${PAGE_H - 96} m ${PAGE_W - MARGIN + 10} ${PAGE_H - 96} l ${PAGE_W - MARGIN + 10} ${PAGE_H - 99} l ${MARGIN - 10} ${PAGE_H - 99} l h f`);

  // Border
  currentPageLines.push(`q 0.706 0.718 0.769 RG 0.4 w 15 15 ${PAGE_W - 30} ${PAGE_H - 30} re S Q`);
  currentPageLines.push(`q 0.820 0.827 0.859 RG 0.2 w 18 18 ${PAGE_W - 36} ${PAGE_H - 36} re S Q`);
  // Corner accents
  ['15 15','15 785','582 15','582 785'].forEach((pt, i) => {
    const [cx, cy] = pt.split(' ').map(Number);
    const hDir = i < 2 ? 1 : -1;
    const vDir = (i === 0 || i === 2) ? 1 : -1;
    currentPageLines.push(`0.980 0.451 0.086 rg`);
    currentPageLines.push(`${cx} ${cy} m ${cx + hDir*18} ${cy} l ${cx + hDir*18} ${cy + vDir*1.5} l ${cx} ${cy + vDir*1.5} l h f`);
    currentPageLines.push(`${cx} ${cy} m ${cx + hDir*1.5} ${cy} l ${cx + hDir*1.5} ${cy + vDir*18} l ${cx} ${cy + vDir*18} l h f`);
  });

  yPos = PAGE_H - 118;

  // Sections
  sections.forEach(section => {
    if (yPos < 140) newPage();
    // Section band
    yPos -= 6;
    currentPageLines.push(`0.031 0.047 0.157 rg ${MARGIN - 4} ${yPos - 4} m ${PAGE_W - MARGIN + 4} ${yPos - 4} l ${PAGE_W - MARGIN + 4} ${yPos + 12} l ${MARGIN - 4} ${yPos + 12} l h f`);
    currentPageLines.push(`0.980 0.451 0.086 rg ${MARGIN - 4} ${yPos - 4} m ${MARGIN - 1} ${yPos - 4} l ${MARGIN - 1} ${yPos + 12} l ${MARGIN - 4} ${yPos + 12} l h f`);
    currentPageLines.push(`BT ${FONT_BOLD} 10 Tf 1 1 1 rg ${MARGIN + 4} ${yPos + 5} Td (${safeStr(section.title)}) Tj ET`);
    yPos -= SECTION_H;

    // Body text
    section.body.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) { yPos -= 5; return; }
      const isBullet = trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.match(/^\d+\./);
      const isSubHead = trimmed.endsWith(':') && trimmed.length < 50;
      addText(trimmed, isSubHead ? 10 : 9, isSubHead, isSubHead ? 0.031 : (isBullet ? 0.2 : 0.1), isSubHead ? 0.047 : (isBullet ? 0.2 : 0.1), isSubHead ? 0.157 : (isBullet ? 0.2 : 0.1));
    });
    yPos -= 8;
  });

  // Footer on all pages
  pages.push(currentPageLines.slice());

  // Assemble raw PDF
  const pdfObjects = [];
  let offset = 0;
  const offsets = [];

  function addObj(content) {
    const idx = pdfObjects.length + 1;
    offsets.push(offset);
    const obj = `${idx} 0 obj\n${content}\nendobj\n`;
    pdfObjects.push(obj);
    offset += obj.length;
    return idx;
  }

  // Build each page content stream
  const pageContentIds = pages.map(pageLines => {
    const stream = pageLines.join('\n');
    return addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  const pageIds = pageContentIds.map((contentId, i) => {
    return addObj(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 2 0 R /F2 3 0 R >> >> >>`);
  });

  // Font objects
  const f1Id = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  const f2Id = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  // Pages dict
  const pagesId = addObj(`<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);

  // Catalog
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  // Cross-reference table
  const xrefOffset = pdfObjects.reduce((sum, obj) => sum + obj.length, 0) + '%PDF-1.4\n'.length;
  const xref = `xref\n0 ${pdfObjects.length + 1}\n0000000000 65535 f \n` +
    offsets.map(o => String(o + '%PDF-1.4\n'.length).padStart(10, '0') + ' 00000 n ').join('\n') + '\n';

  const trailer = `trailer\n<< /Size ${pdfObjects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset + xref.length}\n%%EOF`;

  return '%PDF-1.4\n' + pdfObjects.join('') + xref + trailer;
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
        <!-- Header -->
        <tr><td style="background:#080c18;padding:36px 40px 28px;">
          <div style="font-size:22px;font-weight:800;color:#f97316;letter-spacing:-0.5px;">ASTRO A.I. MARKETING</div>
          <div style="font-size:13px;color:#b4c3d7;margin-top:6px;">Your Personalized Marketing Plan is Ready</div>
          <div style="height:3px;background:#f97316;margin-top:18px;border-radius:2px;"></div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">
          <p style="font-size:16px;color:#1a1a2e;font-weight:700;margin:0 0 12px;">Hi ${firstName}! 👋</p>
          <p style="font-size:14px;color:#444;line-height:1.7;margin:0 0 16px;">
            Thank you for completing your onboarding with <strong>Astro A.I. Marketing</strong>. We've reviewed everything you shared about <strong>${businessName}</strong> and our AI has generated a fully personalized marketing plan just for your business.
          </p>
          <p style="font-size:14px;color:#444;line-height:1.7;margin:0 0 24px;">
            Your marketing plan is attached to this email as a PDF. It includes:
          </p>
          <!-- Feature list -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            ${[
              ['🎯', 'Target Audience Breakdown', 'A detailed profile of your ideal customers'],
              ['📊', 'Platform & Budget Strategy', 'Where to run ads and how to allocate your budget'],
              ['📅', '90-Day Campaign Roadmap', 'Week-by-week plan with milestones and KPIs'],
              ['✍️', 'Ad Copy & Headlines', 'Ready-to-use ads written in professional marketing language'],
              ['📋', 'Lead Qualification Script', 'A complete script to close more leads'],
              ['🏆', 'Competitor Positioning Tips', 'How to stand out and dominate your market'],
            ].map(([icon, title, desc]) => `
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
          <!-- CTA -->
          <div style="text-align:center;margin-bottom:28px;">
            <a href="https://link.astroaibots.com/widget/booking/fp48fbNtkGyPlqJJWEUh" style="display:inline-block;background:#f97316;color:#fff;font-size:14px;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;">
              📅 Schedule Your Strategy Call
            </a>
          </div>
          <p style="font-size:12px;color:#aaa;line-height:1.6;margin:0;">
            Questions? Reply to this email or reach us at <a href="mailto:info@astroaibots.com" style="color:#f97316;">info@astroaibots.com</a>
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#080c18;padding:20px 40px;text-align:center;">
          <div style="font-size:11px;color:#4a5568;">
            © ${new Date().getFullYear()} Astro A.I. Marketing &nbsp;|&nbsp; astroaibots.com
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

// ── Main handler ───────────────────────────────────────────
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
    const planPDFContent = buildPlanPDF(planText, clientName, businessName, generatedAt);
    const planPDFBase64  = Buffer.from(planPDFContent, 'binary').toString('base64');
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
