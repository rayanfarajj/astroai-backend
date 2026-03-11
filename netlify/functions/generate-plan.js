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

// ── PDF Builder (Impressive branded design) ───────────────
// Uses pdfkit — add to package.json: "pdfkit": "^0.15.0"
const PDFDocument = require('pdfkit');

// Brand colors (RGB 0-255)
const C = {
  navy:    [8,  12,  40],
  navy2:   [14, 20,  53],
  orange:  [249,115, 22],
  orange2: [234,108, 12],
  white:   [255,255,255],
  lightBg: [248,249,252],
  border:  [221,225,234],
  muted:   [107,122,154],
  dark:    [26, 26,  46],
  green:   [34, 197, 94],
  gold:    [251,191, 36],
};

function hex(rgb){ return '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join(''); }

function buildPlanPDF(planText, clientName, businessName, generatedAt) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: 0, bufferPages: true });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end',  () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 612, H = 792;
      const ML = 54, MR = 54, MT = 54, MB = 54;
      const CW = W - ML - MR; // content width = 504

      // ── Helpers ────────────────────────────────────────
      function rgb(c){ return { r: c[0], g: c[1], b: c[2] }; }

      function drawBorder() {
        // outer border
        doc.rect(15, 15, W-30, H-30).lineWidth(0.4).stroke(hex(C.border));
        // inner border
        doc.rect(18, 18, W-36, H-36).lineWidth(0.2).stroke(hex(C.border));
        // orange corner brackets
        const corners = [
          [15, 15, 1, 1], [W-15, 15, -1, 1],
          [15, H-15, 1, -1], [W-15, H-15, -1, -1]
        ];
        doc.lineWidth(1.8).strokeColor(hex(C.orange));
        corners.forEach(([cx,cy,dx,dy]) => {
          doc.moveTo(cx, cy).lineTo(cx+dx*20, cy).stroke();
          doc.moveTo(cx, cy).lineTo(cx, cy+dy*20).stroke();
        });
      }

      function drawWatermark() {
        doc.save();
        doc.opacity(0.025);
        doc.fontSize(50).font('Helvetica-Bold').fillColor('#000000');
        doc.rotate(40, { origin: [W/2, H/2] });
        doc.text('ASTRO A.I. MARKETING', W/2 - 200, H/2 - 25);
        doc.restore();
      }

      function drawFooter(pageNum, totalPages) {
        // footer bar
        doc.rect(15, H-40, W-30, 26).fill(hex(C.navy));
        doc.rect(15, H-41, W-30, 1.5).fill(hex(C.orange));
        doc.fontSize(7).font('Helvetica').fillColor(hex(C.muted));
        doc.text(
          `CONFIDENTIAL  |  ${businessName}  |  info@astroaibots.com  |  astroaibots.com`,
          22, H-31, { lineBreak: false }
        );
        doc.fontSize(7).font('Helvetica-Bold').fillColor(hex(C.orange));
        doc.text(`Page ${pageNum} of ${totalPages}`, W-80, H-31, { lineBreak: false });
      }

      function drawRunningHeader() {
        doc.rect(15, 15, W-30, 26).fill(hex(C.navy));
        doc.rect(15, 40, W-30, 1.5).fill(hex(C.orange));
        doc.fontSize(8).font('Helvetica-Bold').fillColor(hex(C.orange));
        doc.text('ASTRO A.I. MARKETING', 22, 22, { lineBreak: false });
        doc.fontSize(7).font('Helvetica').fillColor(hex(C.muted));
        doc.text(`Marketing Plan — ${businessName}`, W/2, 24, { align: 'center', lineBreak: false, width: CW });
      }

      function sectionBand(num, title, y) {
        doc.rect(ML, y, CW, 26).fill(hex(C.navy));
        doc.rect(ML, y, 5, 26).fill(hex(C.orange));
        // number badge
        doc.roundedRect(ML+10, y+5, 18, 16, 3).fill(hex(C.orange));
        doc.fontSize(9).font('Helvetica-Bold').fillColor(hex(C.white));
        doc.text(String(num), ML+10, y+9, { width: 18, align: 'center', lineBreak: false });
        doc.fontSize(10.5).font('Helvetica-Bold').fillColor(hex(C.white));
        doc.text(title.toUpperCase(), ML+34, y+9, { lineBreak: false });
        return y + 36;
      }

      function checkPage(doc, neededHeight) {
        if (doc.y + neededHeight > H - MB - 40) {
          doc.addPage();
          drawBorder();
          drawWatermark();
          drawRunningHeader();
          doc.y = MT + 30;
        }
      }

      function renderBody(text) {
        const lines = text.split('\n');
        for (let line of lines) {
          line = line.trim();
          if (!line) { doc.moveDown(0.3); continue; }

          checkPage(doc, 30);

          // Bold subheading **text**
          if (line.startsWith('**') && line.endsWith('**') && !line.slice(2,-2).includes('**')) {
            const t = line.slice(2,-2);
            doc.moveDown(0.3);
            doc.fontSize(10).font('Helvetica-Bold').fillColor(hex(C.orange));
            doc.text(t, ML, doc.y, { width: CW });
            doc.moveDown(0.1);
            continue;
          }

          // Subheading ending in colon
          if (line.endsWith(':') && line.length < 70 && !line.startsWith('-')) {
            doc.moveDown(0.2);
            doc.fontSize(10).font('Helvetica-Bold').fillColor(hex(C.orange));
            doc.text(line, ML, doc.y, { width: CW });
            doc.moveDown(0.05);
            continue;
          }

          // Bullet
          if (line.startsWith('- ') || line.startsWith('* ')) {
            const t = line.slice(2).replace(/\*\*(.+?)\*\*/g, '$1');
            doc.fontSize(9.5).font('Helvetica').fillColor(hex(C.dark));
            doc.text('•', ML+4, doc.y, { continued: true, width: 12 });
            doc.text(t, ML+18, doc.y, { width: CW-18 });
            continue;
          }

          // Numbered list
          const nm = line.match(/^(\d+)\.\s+(.+)/);
          if (nm) {
            const t = nm[2].replace(/\*\*(.+?)\*\*/g, '$1');
            doc.fontSize(9.5).font('Helvetica').fillColor(hex(C.dark));
            doc.text(`${nm[1]}.`, ML+4, doc.y, { continued: true, width: 16 });
            doc.text(t, ML+22, doc.y, { width: CW-22 });
            continue;
          }

          // Normal paragraph — handle inline bold
          const parts = line.split(/\*\*(.+?)\*\*/g);
          doc.fontSize(9.5).fillColor(hex(C.dark));
          if (parts.length === 1) {
            doc.font('Helvetica').text(line, ML, doc.y, { width: CW, align: 'justify' });
          } else {
            let first = true;
            for (let i=0; i<parts.length; i++) {
              if (!parts[i]) continue;
              const isBold = (i % 2 === 1);
              doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica');
              const isLast = (i === parts.length-1) || (i === parts.length-2 && !parts[parts.length-1]);
              doc.text(parts[i], first ? ML : undefined, first ? doc.y : undefined,
                { continued: !isLast, width: CW });
              first = false;
            }
            if (!line.endsWith(parts[parts.length-1])) doc.text('');
          }
        }
      }

      // ── Parse plan text into sections ──────────────────
      function parseSections(text) {
        const sections = [];
        let current = null;
        for (const line of text.split('\n')) {
          const m = line.match(/^##\s+\d+\.\s+(.+)/);
          if (m) {
            if (current) sections.push(current);
            current = { title: m[1].trim(), body: [] };
          } else if (current) {
            current.body.push(line);
          }
        }
        if (current) sections.push(current);
        return sections;
      }

      const sections = parseSections(planText);
      const sectionTitles = [
        'Target Audience Breakdown',
        'Recommended Platforms & Budget Allocation',
        '90-Day Campaign Strategy',
        'Ad Copy Suggestions',
        'Headlines & Primary Text',
        'Lead Qualification Script',
        'Competitor Positioning & Differentiation Tips',
      ];

      // ══════════════════════════════════════════════
      // PAGE 1: COVER
      // ══════════════════════════════════════════════
      drawBorder();
      drawWatermark();

      // Dark header
      doc.rect(15, 15, W-30, 110).fill(hex(C.navy));
      // Orange accent line
      doc.rect(15, 124, W-30, 2).fill(hex(C.orange));

      // Company name
      doc.fontSize(26).font('Helvetica-Bold').fillColor(hex(C.orange));
      doc.text('ASTRO A.I. MARKETING', ML, 32, { lineBreak: false });

      // Subtitle
      doc.fontSize(11).font('Helvetica').fillColor(hex([180,195,215]));
      doc.text('Personalized Marketing Plan — Prepared Exclusively For You', ML, 62, { lineBreak: false });

      // Orange rule inside header
      doc.rect(ML, 76, CW, 1).fill(hex(C.orange));

      // Doc meta
      doc.fontSize(8).font('Helvetica').fillColor(hex(C.muted));
      doc.text(`Prepared for: ${clientName}   |   Generated: ${generatedAt}`, ML, 84, { lineBreak: false });
      doc.text(`astroaibots.com`, W-MR-80, 84, { lineBreak: false });

      // Business name
      doc.fontSize(24).font('Helvetica-Bold').fillColor(hex(C.dark));
      doc.text(businessName, ML, 140);

      // "What's included" label
      doc.moveDown(0.4);
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(hex(C.muted));
      doc.text('WHAT\'S INCLUDED IN YOUR PLAN:', ML, doc.y);
      doc.moveDown(0.4);

      // Included items table
      const included = [
        ['🎯', 'Target Audience Breakdown',    'Detailed demographics, psychographics & online behavior'],
        ['📊', 'Platform & Budget Strategy',   'Where to run ads, budget splits & expected CPL ranges'],
        ['📅', '90-Day Campaign Roadmap',      'Phase-by-phase plan with milestones and KPIs'],
        ['✍️', 'Ad Copy & Headlines',          '3 complete ad variations ready to deploy immediately'],
        ['📋', 'Lead Qualification Script',    'Word-for-word call script with objection handling'],
        ['🏆', 'Competitor Positioning Tips',  '5 tactics to dominate your local market'],
      ];

      included.forEach(([icon, title, desc], i) => {
        const rowY = doc.y;
        const bg = i % 2 === 0 ? hex(C.lightBg) : '#FFFFFF';
        doc.rect(ML, rowY-2, CW, 24).fill(bg);
        doc.rect(ML, rowY-2, 3, 24).fill(hex(C.orange));
        doc.fontSize(12).fillColor(hex(C.dark)).text(icon, ML+8, rowY+3, { lineBreak: false, width: 20 });
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor(hex(C.dark)).text(title, ML+32, rowY+2, { lineBreak: false, width: 180 });
        doc.fontSize(8.5).font('Helvetica').fillColor(hex(C.muted)).text(desc, ML+220, rowY+4, { lineBreak: false, width: CW-220 });
        doc.y = rowY + 24;
      });

      doc.moveDown(1);

      // Confidential box
      const confY = doc.y;
      doc.rect(ML, confY, CW, 38).fill(hex(C.lightBg));
      doc.rect(ML, confY, 3, 38).fill(hex(C.orange));
      doc.fontSize(8).font('Helvetica').fillColor(hex(C.muted));
      doc.text(
        `CONFIDENTIAL: This marketing plan was generated exclusively for ${businessName} by Astro A.I. Marketing. ` +
        `All strategies, ad copy, and recommendations are proprietary and intended solely for the named recipient.`,
        ML+10, confY+10, { width: CW-16 }
      );

      drawFooter(1, '—');

      // ══════════════════════════════════════════════
      // SECTIONS
      // ══════════════════════════════════════════════
      const sectionIcons = ['🎯','📊','📅','✍️','💬','📋','🏆'];

      sections.forEach((section, idx) => {
        doc.addPage();
        drawBorder();
        drawWatermark();
        drawRunningHeader();
        doc.y = MT + 36;

        const title = sectionTitles[idx] || section.title;
        const icon  = sectionIcons[idx] || '';

        // Section band
        doc.rect(ML, doc.y, CW, 26).fill(hex(C.navy));
        doc.rect(ML, doc.y, 5, 26).fill(hex(C.orange));
        // number badge
        doc.roundedRect(ML+10, doc.y+5, 18, 16, 3).fill(hex(C.orange));
        doc.fontSize(9).font('Helvetica-Bold').fillColor(hex(C.white));
        doc.text(String(idx+1), ML+10, doc.y+9, { width: 18, align: 'center', lineBreak: false });
        doc.fontSize(10.5).font('Helvetica-Bold').fillColor(hex(C.white));
        doc.text(`${icon}  ${title.toUpperCase()}`, ML+34, doc.y+9, { lineBreak: false });
        doc.y += 38;

        // Special: Ad Copy — render as cards
        if (idx === 3) {
          const bodyText = section.body.join('\n');
          const adBlocks = bodyText.split(/\*\*Ad Variation \d+\*\*/).filter(b=>b.trim());
          adBlocks.forEach((block, ai) => {
            checkPage(doc, 110);
            const lines = block.split('\n').map(l=>l.trim()).filter(Boolean);
            let headline='', bodyT='', cta='Learn More';
            lines.forEach(ln => {
              const ll = ln.toLowerCase();
              if (ll.includes('headline:')) headline = ln.split(':').slice(1).join(':').trim().replace(/^"|"$/g,'');
              else if (ll.includes('primary text:') || ll.includes('body:')) bodyT = ln.split(':').slice(1).join(':').trim();
              else if (ll.includes('call to action:') || ll.includes('cta:')) cta = ln.split(':').slice(1).join(':').trim().replace(/^"|"$/g,'');
              else if (!headline && ln.length > 5 && ln.length < 60) headline = ln.replace(/^-\s*/,'');
              else if (!bodyT && ln.length > 40) bodyT = ln.replace(/^-\s*/,'');
            });

            const cardY = doc.y;
            const cardH = 105;
            // Card
            doc.roundedRect(ML, cardY, CW, cardH, 5).fill(hex(C.lightBg));
            doc.roundedRect(ML, cardY, CW, 4, 2).fill(hex(C.orange));
            // Variation badge
            doc.roundedRect(ML+10, cardY+10, 85, 16, 3).fill(hex(C.navy));
            doc.fontSize(7.5).font('Helvetica-Bold').fillColor(hex(C.white));
            doc.text(`AD VARIATION ${ai+1}`, ML+14, cardY+15, { lineBreak: false });
            // Headline
            doc.fontSize(13).font('Helvetica-Bold').fillColor(hex(C.navy));
            doc.text(headline || `Ad ${ai+1}`, ML+10, cardY+32, { width: CW-20, lineBreak: false });
            // Body text — word-wrapped manually to 2 lines max display
            doc.fontSize(9).font('Helvetica').fillColor(hex([68,68,68]));
            doc.text(bodyT || block.trim().slice(0,140), ML+10, cardY+50, { width: CW-20, height: 28, ellipsis: true });
            // CTA button
            doc.roundedRect(ML+10, cardY+cardH-22, 90, 16, 4).fill(hex(C.orange));
            doc.fontSize(8).font('Helvetica-Bold').fillColor(hex(C.white));
            doc.text(cta, ML+10, cardY+cardH-17, { width: 90, align: 'center', lineBreak: false });

            doc.y = cardY + cardH + 10;
          });
        } else {
          renderBody(section.body.join('\n'));
        }
      });

      // ══════════════════════════════════════════════
      // CLOSING PAGE
      // ══════════════════════════════════════════════
      doc.addPage();
      drawBorder();
      drawWatermark();
      drawRunningHeader();
      doc.y = MT + 36;

      // Next steps band
      doc.rect(ML, doc.y, CW, 26).fill(hex(C.navy));
      doc.rect(ML, doc.y, 5, 26).fill(hex(C.orange));
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor(hex(C.white));
      doc.text('🚀  NEXT STEPS — LET\'S GET YOU LAUNCHED', ML+12, doc.y+9, { lineBreak: false });
      doc.y += 38;

      const steps = [
        ['1', 'Review This Plan',         'Read through each section. Highlight anything you want to discuss with your strategist.'],
        ['2', 'Schedule Your Strategy Call', 'Book a free call and we\'ll walk through your plan together before anything goes live.'],
        ['3', 'Campaign Launch',          'We build your ads, targeting, and copy — and launch within days of your approval.'],
        ['4', 'Weekly Performance Reports', 'Every week you receive a clear report: leads generated, cost per lead, and results.'],
      ];

      steps.forEach(([num, title, desc]) => {
        checkPage(doc, 50);
        const rowY = doc.y;
        doc.roundedRect(ML, rowY, CW, 40, 4).fill(hex(C.lightBg));
        doc.roundedRect(ML, rowY, 38, 40, 4).fill(hex(C.orange));
        doc.fontSize(18).font('Helvetica-Bold').fillColor(hex(C.white));
        doc.text(num, ML, rowY+10, { width: 38, align: 'center', lineBreak: false });
        doc.fontSize(10).font('Helvetica-Bold').fillColor(hex(C.dark));
        doc.text(title, ML+46, rowY+8, { lineBreak: false });
        doc.fontSize(8.5).font('Helvetica').fillColor(hex(C.muted));
        doc.text(desc, ML+46, rowY+22, { width: CW-52, lineBreak: false });
        doc.y = rowY + 48;
      });

      doc.moveDown(1);

      // Contact card
      checkPage(doc, 60);
      const ctaY = doc.y;
      doc.rect(ML, ctaY, CW*0.72, 52).fill(hex(C.lightBg));
      doc.rect(ML, ctaY, 3, 52).fill(hex(C.orange));
      doc.roundedRect(ML + CW*0.72 + 4, ctaY, CW*0.28 - 4, 52, 4).fill(hex(C.orange));
      doc.fontSize(12).font('Helvetica-Bold').fillColor(hex(C.dark));
      doc.text('Questions? We\'re here for you.', ML+12, ctaY+12, { lineBreak: false });
      doc.fontSize(9).font('Helvetica').fillColor(hex(C.muted));
      doc.text('info@astroaibots.com  |  astroaibots.com', ML+12, ctaY+30, { lineBreak: false });
      doc.fontSize(9).font('Helvetica-Bold').fillColor(hex(C.white));
      doc.text('Schedule a Call →', ML + CW*0.72 + 4, ctaY+20, { width: CW*0.28 - 4, align: 'center', lineBreak: false });

      // ── Add footers to all pages ──────────────────
      const totalPages = doc.bufferedPageRange().count;
      for (let i=0; i < totalPages; i++) {
        doc.switchToPage(i);
        drawFooter(i+1, totalPages);
      }

      doc.end();
    } catch(err) {
      reject(err);
    }
  });
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
