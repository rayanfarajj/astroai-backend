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

// ── PDF Builder — pure Node.js, zero dependencies ────────
// Uses built-in PDF Type1 fonts (Helvetica/Helvetica-Bold)
// No font .afm files needed — works in any serverless environment

function buildPlanPDF(planText, clientName, businessName, generatedAt) {
  const PW = 612, PH = 792, ML = 54, MR = 54, TM = 54, BM = 54;
  const CW = PW - ML - MR;

  const NAVY   = '0.031 0.047 0.157';
  const ORANGE = '0.976 0.451 0.086';
  const WHITE  = '1 1 1';
  const LIGHT  = '0.976 0.980 0.988';
  const MUTED  = '0.420 0.478 0.604';
  const DARK   = '0.102 0.102 0.180';
  const BORDER = '0.867 0.882 0.918';
  const DGRAY  = '0.267 0.267 0.267';

  function esc(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'); }

  function wrap(text, cpl) {
    if (!text) return [''];
    const words = String(text).replace(/\*\*/g,'').split(/\s+/);
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur+' '+w : w;
      if (t.length > cpl) { if (cur) lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
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

  // ── stream ops collector ──────────────────────────────
  const pages = [];

  function makePage() {
    const ops = [];
    const p = {
      ops,
      fillR(x,y,w,h,c)  { ops.push(`${c} rg ${x} ${PH-y-h} ${w} ${h} re f`); },
      strokeR(x,y,w,h,c,lw=0.4) { ops.push(`${lw} w ${c} RG ${x} ${PH-y-h} ${w} ${h} re S`); },
      line(x1,y1,x2,y2,c,lw=0.4) { ops.push(`${lw} w ${c} RG ${x1} ${PH-y1} m ${x2} ${PH-y2} l S`); },
      txt(s,x,y,sz,f,c)  { ops.push(`BT /${f} ${sz} Tf ${c} rg ${x} ${PH-y} Td (${esc(s)}) Tj ET`); },
      stream() { return ops.join('\n'); }
    };
    return p;
  }

  function decorate(p, isFirst) {
    // borders
    p.strokeR(15,15,PW-30,PH-30,BORDER,0.4);
    p.strokeR(18,18,PW-36,PH-36,BORDER,0.2);
    // orange corner brackets
    [[15,15,1,1],[PW-15,15,-1,1],[15,PH-15,1,-1],[PW-15,PH-15,-1,-1]].forEach(([cx,cy,dx,dy])=>{
      p.line(cx,cy,cx+dx*20,cy,ORANGE,1.8);
      p.line(cx,cy,cx,cy+dy*20,ORANGE,1.8);
    });
    // watermark
    p.ops.push(`q 0.03 g /F2 40 Tf ${ML} ${PH/2} Td (ASTRO A.I. MARKETING) Tj Q`);
    // footer
    p.fillR(15,PH-42,PW-30,28,NAVY);
    p.fillR(15,PH-44,PW-30,2,ORANGE);
    p.txt('CONFIDENTIAL  |  '+esc(businessName)+'  |  info@astroaibots.com  |  astroaibots.com',22,PH-28,7,'F1',MUTED);
    // header (inner pages)
    if (!isFirst) {
      p.fillR(15,15,PW-30,28,NAVY);
      p.fillR(15,42,PW-30,2,ORANGE);
      p.txt('ASTRO A.I. MARKETING',22,30,8,'F2',ORANGE);
      p.txt('Marketing Plan - '+esc(businessName),ML+180,30,7,'F1',MUTED);
    }
  }

  function bandY(p, num, title, y) {
    p.fillR(ML,y,CW,26,NAVY);
    p.fillR(ML,y,5,26,ORANGE);
    p.fillR(ML+10,y+5,18,16,ORANGE);
    p.txt(String(num),ML+14,y+17,9,'F2',WHITE);
    p.txt(title.toUpperCase(),ML+34,y+17,10,'F2',WHITE);
    return y+32;
  }

  // ── COVER PAGE ─────────────────────────────────────────
  {
    const p = makePage(); decorate(p,true);
    p.fillR(15,15,PW-30,115,NAVY);
    p.fillR(15,129,PW-30,2.5,ORANGE);
    p.txt('ASTRO A.I. MARKETING',ML,44,24,'F2',ORANGE);
    p.txt('Personalized Marketing Plan',ML,72,10,'F1','0.706 0.765 0.843');
    p.fillR(ML,82,CW,0.8,ORANGE);
    p.txt('Prepared for: '+esc(clientName)+'   |   Generated: '+esc(generatedAt),ML,96,8,'F1',MUTED);
    let y=148;
    p.txt(esc(businessName),ML,y,22,'F2',DARK); y+=32;
    p.txt('YOUR PERSONALIZED PLAN INCLUDES:',ML,y,8,'F2',MUTED); y+=16;
    const inc=[
      ['1','Target Audience Breakdown','Demographics, psychographics & online behavior'],
      ['2','Platform & Budget Strategy','Ad channels, budget splits & expected CPL ranges'],
      ['3','90-Day Campaign Roadmap','Phase-by-phase plan with milestones and KPIs'],
      ['4','Ad Copy & Headlines','3 complete ad variations ready to deploy'],
      ['5','Lead Qualification Script','Word-for-word call script with objection handling'],
      ['6','Competitor Positioning Tips','5 tactics to dominate your local market'],
    ];
    inc.forEach(([num,title,desc],i)=>{
      const bg=i%2===0?LIGHT:WHITE;
      p.fillR(ML,y-2,CW,24,bg);
      p.fillR(ML,y-2,4,24,ORANGE);
      p.fillR(ML+4,y-2,28,24,NAVY);
      p.txt(num,ML+10,y+13,10,'F2',WHITE);
      p.txt(title,ML+40,y+8,9.5,'F2',DARK);
      p.txt(desc,ML+40,y+20,8,'F1',MUTED);
      y+=24;
    });
    y+=14;
    p.fillR(ML,y,CW,40,LIGHT);
    p.fillR(ML,y,4,40,ORANGE);
    const conf='CONFIDENTIAL: This marketing plan was generated exclusively for '+businessName+' by Astro A.I. Marketing. All strategies and recommendations are proprietary and intended solely for the named recipient.';
    let cy=y+10;
    for (const cl of wrap(conf,86)) { p.txt(cl,ML+12,cy,8,'F1',MUTED); cy+=11; }
    pages.push(p.stream());
  }

  // ── SECTION PAGES ──────────────────────────────────────
  const secTitles=['Target Audience Breakdown','Recommended Platforms & Budget Allocation','90-Day Campaign Strategy','Ad Copy Suggestions','Headlines & Primary Text','Lead Qualification Script','Competitor Positioning & Differentiation Tips'];
  const sections = parseSections(planText);
  const BOTTOM = PH-BM-50;

  function renderSection(idx, section) {
    const title = secTitles[idx] || section.title;
    let p = makePage(); decorate(p,false);
    let y = bandY(p, idx+1, title, TM+34) + 10;

    // Ad copy — card layout
    if (idx===3) {
      const fullText = section.lines.join('\n');
      const adBlocks = fullText.split(/\*\*Ad Variation \d+\*\*|Ad Variation \d+:/).filter(b=>b.trim());
      adBlocks.slice(0,3).forEach((block,ai)=>{
        const blines = block.split('\n').map(l=>l.trim()).filter(Boolean);
        let headline='',bodyT='',cta='Learn More';
        for (const ln of blines) {
          const ll=ln.toLowerCase();
          if (ll.includes('headline:')) headline=ln.split(':').slice(1).join(':').trim().replace(/[*"]/g,'');
          else if (ll.includes('primary text:')) bodyT=ln.split(':').slice(1).join(':').trim().replace(/\*\*/g,'');
          else if (ll.includes('call to action:')) cta=ln.split(':').slice(1).join(':').trim().replace(/[*"]/g,'');
          else if (!headline&&ln.length>5&&ln.length<65) headline=ln.replace(/\*\*/g,'');
          else if (!bodyT&&ln.length>40) bodyT=ln.replace(/\*\*/g,'');
        }
        const CH=110;
        if (y+CH>BOTTOM) { pages.push(p.stream()); p=makePage(); decorate(p,false); y=bandY(p,idx+1,title+' (cont.)',TM+34)+10; }
        p.fillR(ML,y,CW,CH,LIGHT);
        p.fillR(ML,y,CW,4,ORANGE);
        p.fillR(ML+10,y+10,92,16,NAVY);
        p.txt('AD VARIATION '+(ai+1),ML+14,y+22,7.5,'F2',WHITE);
        p.txt(esc(headline.slice(0,55)),ML+10,y+38,13,'F2',DARK);
        const bw=wrap(bodyT,86);
        let by=y+54;
        bw.slice(0,3).forEach(bl=>{ p.txt(esc(bl),ML+10,by,9,'F1',DGRAY); by+=13; });
        p.fillR(ML+10,y+CH-22,95,17,ORANGE);
        p.txt(esc(cta.slice(0,22)),ML+14,y+CH-10,8,'F2',WHITE);
        y+=CH+10;
      });
      pages.push(p.stream());
      return;
    }

    // Normal rendering
    for (const raw of section.lines) {
      const line = raw.trim();
      if (!line) { y+=6; if(y>BOTTOM){pages.push(p.stream());p=makePage();decorate(p,false);y=bandY(p,idx+1,title+' (cont.)',TM+34)+10;} continue; }

      if ((line.startsWith('**')&&line.endsWith('**'))||(line.endsWith(':')&&line.length<70&&!line.startsWith('-'))) {
        const t=line.replace(/\*\*/g,'').replace(/:$/,'');
        if(y+20>BOTTOM){pages.push(p.stream());p=makePage();decorate(p,false);y=bandY(p,idx+1,title+' (cont.)',TM+34)+10;}
        y+=4; p.txt(esc(t),ML,y,10,'F2',ORANGE); y+=15; continue;
      }
      if (line.startsWith('- ')||line.startsWith('* ')) {
        const t=line.slice(2).replace(/\*\*/g,'');
        const wl=wrap(t,82);
        if(y+wl.length*14>BOTTOM){pages.push(p.stream());p=makePage();decorate(p,false);y=bandY(p,idx+1,title+' (cont.)',TM+34)+10;}
        p.fillR(ML+4,y-3,3,3,ORANGE);
        p.txt(esc(wl[0]),ML+14,y,9.5,'F1',DARK); y+=14;
        wl.slice(1).forEach(l=>{p.txt(esc(l),ML+14,y,9.5,'F1',DARK);y+=14;});
        continue;
      }
      const nm=line.match(/^(\d+)\.\s+(.+)/);
      if (nm) {
        const t=nm[2].replace(/\*\*/g,'');
        const wl=wrap(t,80);
        if(y+wl.length*14>BOTTOM){pages.push(p.stream());p=makePage();decorate(p,false);y=bandY(p,idx+1,title+' (cont.)',TM+34)+10;}
        p.txt(nm[1]+'.',ML+4,y,9.5,'F2',ORANGE);
        p.txt(esc(wl[0]),ML+20,y,9.5,'F1',DARK); y+=14;
        wl.slice(1).forEach(l=>{p.txt(esc(l),ML+20,y,9.5,'F1',DARK);y+=14;});
        continue;
      }
      const wl=wrap(line.replace(/\*\*/g,''),85);
      if(y+wl.length*14>BOTTOM){pages.push(p.stream());p=makePage();decorate(p,false);y=bandY(p,idx+1,title+' (cont.)',TM+34)+10;}
      wl.forEach(l=>{p.txt(esc(l),ML,y,9.5,'F1',DARK);y+=14;});
    }
    pages.push(p.stream());
  }

  sections.forEach((s,i) => renderSection(i,s));

  // ── CLOSING PAGE ───────────────────────────────────────
  {
    const p = makePage(); decorate(p,false);
    let y = bandY(p,8,"Next Steps - Let's Get You Launched",TM+34)+10;
    [['1','Review This Plan','Read through each section and highlight anything to discuss with your strategist.'],
     ['2','Schedule Your Strategy Call','Book a free call and walk through the plan before anything goes live.'],
     ['3','Campaign Launch','We build your ads, targeting, and copy — and launch within days of your approval.'],
     ['4','Weekly Performance Reports','Every week: clear report with leads, cost per lead, and results.'],
    ].forEach(([num,title,desc])=>{
      p.fillR(ML,y-2,CW,44,LIGHT);
      p.fillR(ML,y-2,40,44,ORANGE);
      p.txt(num,ML+12,y+20,18,'F2',WHITE);
      p.txt(esc(title),ML+50,y+10,10.5,'F2',DARK);
      const dl=wrap(desc,72); let dy=y+26;
      dl.forEach(l=>{p.txt(esc(l),ML+50,dy,8.5,'F1',MUTED);dy+=12;});
      y+=52;
    });
    y+=14;
    const ctaX=ML+Math.round(CW*0.72)+4, ctaW=Math.round(CW*0.28)-4;
    p.fillR(ML,y,Math.round(CW*0.72),52,LIGHT);
    p.fillR(ML,y,4,52,ORANGE);
    p.fillR(ctaX,y,ctaW,52,ORANGE);
    p.txt('Questions? We are here for you.',ML+14,y+16,11,'F2',DARK);
    p.txt('info@astroaibots.com  |  astroaibots.com',ML+14,y+32,9,'F1',MUTED);
    p.txt('Schedule a Call',ctaX+8,y+26,9,'F2',WHITE);
    pages.push(p.stream());
  }

  // ── ASSEMBLE PDF ───────────────────────────────────────
  const totalPages = pages.length;
  // inject page numbers
  const finalStreams = pages.map((stream,i)=>{
    const label = `Page ${i+1} of ${totalPages}`;
    const x = PW-MR-label.length*4;
    return stream + `\nBT /F2 7 Tf ${ORANGE} rg ${x} ${BM+10} Td (${label}) Tj ET`;
  });

  const objs=[];
  function addObj(c){ objs.push(c); return objs.length; }

  const f1 = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  const f2 = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);

  const pageIds=[];
  for (const stream of finalStreams) {
    const sb = Buffer.from(stream,'utf8');
    const cid = addObj(`<< /Length ${sb.length} >>\nstream\n${stream}\nendstream`);
    const pid = addObj(`<< /Type /Page /Parent ${objs.length+2} 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${cid} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> >>`);
    pageIds.push(pid);
  }

  const pagesId = addObj(`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${totalPages} >>`);
  const catId   = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  const header = '%PDF-1.4\n';
  let pdf = header;
  const offsets=[];
  for (let i=0;i<objs.length;i++){
    offsets.push(pdf.length);
    pdf+=`${i+1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefOff=pdf.length;
  let xref=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref+=String(off).padStart(10,'0')+' 00000 n \n';
  pdf+=xref+`trailer\n<< /Size ${objs.length+1} /Root ${catId} 0 R >>\nstartxref\n${xrefOff}\n%%EOF`;

  return Promise.resolve(Buffer.from(pdf,'binary'));
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
