// netlify/functions/agency-process-plan.js
// Calls Claude synchronously before responding (~14s) — form has 25s timeout
import https from 'https';
import crypto from 'crypto';
import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('Firebase token failed'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function toFS(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean')    return {booleanValue:v};
  if (typeof v==='number')     return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if (typeof v==='string')     return {stringValue:v};
  if (Array.isArray(v))        return {arrayValue:{values:v.map(toFS)}};
  if (typeof v==='object')     return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,val])=>[k,toFS(val)]))}};
  return {stringValue:String(v)};
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

async function fsGet(path) {
  const t = await getToken();
  const r = await fsHttp('GET',`${BASE()}/${path}`,null,t);
  if (!r.fields) return null;
  const o={};
  for(const[k,v]of Object.entries(r.fields)){
    if('stringValue' in v) o[k]=v.stringValue;
    else if('integerValue' in v) o[k]=Number(v.integerValue);
    else if('booleanValue' in v) o[k]=v.booleanValue;
    else o[k]=null;
  }
  return o;
}

async function fsSet(path, data) {
  const t = await getToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsHttp('PATCH',`${BASE()}/${path}`,{fields},t);
}

function callClaude(prompt) {
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify({model:'claude-sonnet-4-6',max_tokens:3000,messages:[{role:'user',content:prompt}]});
    const r = https.request({
      hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const j=JSON.parse(d);
          if(j.error) { reject(new Error(j.error.message||JSON.stringify(j.error))); return; }
          const text=j.content?.[0]?.text||'';
          if(!text) { reject(new Error('Empty Claude response: '+d.slice(0,200))); return; }
          resolve(text);
        } catch(e){reject(e)}
      });
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

// ─── UPLOAD AUTH PDF TO NETLIFY BLOBS (protected, download-only) ─────────────
// The form sends the actual PDF as base64 (data.authPdfBase64) — we store
// the real PDF binary so it shows as a downloadable PDF in the Files tab.
// Falls back to saving a JSON authorization record if no PDF base64 provided.
async function uploadAuthPdfToBlobs(clientSlug, agencyId, _ignored, data) {
  try {
    const store  = getStore('client-files');
    const now    = new Date().toISOString();
    const signer = data.authSignerName || ((data.firstName||'') + ' ' + (data.lastName||'')).trim();
    const biz    = data.authSignerBusiness || data.businessName || '';
    const docRef = data.authDocRef || ('AUTH-' + Date.now().toString(36).toUpperCase());

    if (data.authPdfBase64 && data.authPdfBase64.length > 100) {
      // ── Save the REAL PDF from the browser (has drawn signature, all sections) ──
      const pdfBuffer = Buffer.from(data.authPdfBase64, 'base64');
      const fileName  = data.authPdfFilename || `Authorization_Agreement_${clientSlug}.pdf`;
      const key = `${clientSlug}/${fileName}`;
      await store.set(key, pdfBuffer, {
        metadata: {
          originalName: fileName,
          displayName:  'Authorization Agreement',
          fileType:     'application/pdf',
          fileSize:     String(pdfBuffer.length),
          uploadedAt:   now,
          slug:         clientSlug,
          protected:    'true',
          systemFile:   'true',
          docType:      'authorization',
          signerName:   signer,
          signerBiz:    biz,
          signedAt:     data.authTimestamp || now,
          docRef,
        }
      });
      console.log('[auth] Real PDF saved to Blobs:', key, pdfBuffer.length, 'bytes');
      return key;
    }

    // ── Fallback: no PDF from browser — this should not happen normally ──────
    console.warn('[auth] No authPdfBase64 received — skipping blob save');
    return null;

  } catch(e) {
    console.error('[auth] uploadAuthPdfToBlobs failed:', e.message);
    return null;
  }
}


async function generateAndSavePlan(data, agencyId, slug, planUrl, portalUrl, agency) {
  try {
    // STEP A: Call Claude
    console.log('[plan] STEP A: Calling Claude for:', data.businessName, '| slug:', slug);
    let raw;
    try {
      raw = await callClaude(buildPrompt(data));
      console.log('[plan] STEP A OK: Claude responded', raw.length, 'chars');
    } catch(e) {
      console.error('[plan] STEP A FAILED: Claude error:', e.message);
      return;
    }

    // STEP B: Parse JSON
    let json = {};
    try {
      json = JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim());
      console.log('[plan] STEP B OK: JSON parsed, keys:', Object.keys(json).join(','));
    } catch(e) {
      const m = raw.match(/\{[\s\S]*\}/);
      if(m) { try { json = JSON.parse(m[0]); console.log('[plan] STEP B OK (regex)'); } catch(e2) { console.error('[plan] STEP B WARN: parse failed, saving empty JSON'); } }
      else { console.error('[plan] STEP B WARN: no JSON found in response, saving empty'); }
    }

    // STEP C: Save full client data + plan JSON to Firestore
    await fsSet(`agencies/${agencyId}/clients/${slug}`, {
      agencyId,
      clientId: slug,
      // Contact
      firstName:        data.firstName||'',
      lastName:         data.lastName||'',
      clientName:       `${data.firstName||''} ${data.lastName||''}`.trim(),
      clientEmail:      data.email||'',
      phone:            data.phone||'',
      bizPhone:         data.bizPhone||'',
      smsConsent:       data.smsConsent||'',
      // Mailing
      mailingAddr1:     data.mailingAddr1||'',
      mailingAddr2:     data.mailingAddr2||'',
      mailingCity:      data.mailingCity||'',
      mailingState:     data.mailingState||'',
      mailingZip:       data.mailingZip||'',
      // Business
      businessName:     data.businessName||'',
      website:          data.website||'',
      companySize:      data.companySize||'',
      industry:         data.industry||'',
      primaryService:   data.primaryService||'',
      bizDescription:   data.bizDescription||'',
      // Offer
      mainGoal:         data.mainGoal||'',
      avgCustomerValue: data.avgCustomerValue||'',
      standOut:         data.standOut||'',
      promotions:       data.promotions||'',
      // Audience
      idealCustomer:    data.idealCustomer||'',
      ageGroups:        data.ageGroups||'',
      genderPref:       data.genderPref||'',
      language:         data.language||'',
      interests:        data.interests||'',
      // Service area
      serviceAreaType:  data.serviceAreaType||'',
      serviceDetails:   data.serviceDetails||'',
      // Lead qual
      qualifiedLead:    data.qualifiedLead||'',
      badLead:          data.badLead||'',
      qualifyingQuestions:    data.qualifyingQuestions||'',
      disqualifyingQuestions: data.disqualifyingQuestions||'',
      // Lead handoff
      leadDestination:  data.leadDestination||'',
      leadEmail:        data.leadEmail||'',
      leadPhone:        data.leadPhone||'',
      responseTime:     data.responseTime||'',
      dedicatedPerson:  data.dedicatedPerson||'',
      // Past marketing
      paidAdsBefore:    data.paidAdsBefore||'',
      platformsUsedBefore: data.platformsUsedBefore||'',
      workedWell:       data.workedWell||'',
      notWorked:        data.notWorked||'',
      // Goals
      goal90Days:       data.goal90Days||'',
      goal90:           data.goal90Days||'',
      limitations:      data.limitations||'',
      priorities:       data.priorities||'',
      customQ1:         data.customQ1||'',
      customQ2:         data.customQ2||'',
      customQ3:         data.customQ3||'',
      // Budget
      adBudget:         data.adBudget||'',
      budgetIncrease:   data.budgetIncrease||'',
      openToUpgrade:    data.openToUpgrade||'',
      // Platforms & access
      adPlatforms:      data.adPlatforms||'',
      accessMethod:     data.accessMethod||'',
      // Referral
      referralBonus:    data.referralBonus||'',
      referralContact:  data.referralContact||'',
      finalNotes:       data.finalNotes||'',
      referralFriendName:  data.referralFriendName||'',
      referralFriendEmail: data.referralFriendEmail||'',
      referralFriendPhone: data.referralFriendPhone||'',
      // Authorization
      authorizationAgreed:  data.authorizationAgreed||'',
      authSignerName:       data.authSignerName||'',
      authSignerBusiness:   data.authSignerBusiness||'',
      authTimestamp:        data.authTimestamp||'',
      authIP:               data.authIP||'',
      authUserAgent:        data.authUserAgent||'',
      authDocRef:           data.authDocRef||'',
      // Plan
      status:           'active',
      createdAt:        data._createdAt||new Date().toISOString(),
      generatedAt:      new Date().toISOString(),
      dashboardUrl:     planUrl,
      dashboardJSON:    JSON.stringify(json),
      notes:            '',
      tags:             data.tags||'',
      leadSource:       data.source||'agency-onboarding',
    });
    console.log('[plan] STEP C OK: Firestore save complete for:', slug);

    // ── Save authorization PDF (non-blocking) ─────────────────────────────────
    if (data.authPdfBase64 || (data.authSignature && data.authSignature.length > 100)) {
      uploadAuthPdfToBlobs(slug, agencyId, data.authSignature || '', data)
        .catch(e => console.error('[plan] PDF blob save failed:', e.message));
    }

    // Send email (non-blocking — never hangs the function)
    try {
      const { createTransport } = await import('nodemailer');
      const t = createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
      const brand = agency.brandName||agency.name||'Your Marketing Agency';
      const color = agency.brandColor||'#f97316';
      const emailPromise = t.sendMail({
        from:`"${brand}" <${process.env.GMAIL_USER}>`,
        to: data.email,
        subject: `Your Marketing Command Center is Ready, ${data.firstName}!`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0a0a0f;color:#eeeef2">
          <div style="background:linear-gradient(135deg,${color},${color}cc);padding:24px;border-radius:12px;margin-bottom:24px">
            <h2 style="margin:0;color:#fff;font-size:22px">${brand}</h2>
          </div>
          <p style="font-size:16px">Hi ${data.firstName},</p>
          <p>Your personalized Marketing Command Center for <strong>${data.businessName}</strong> is ready!</p>
          <p style="color:#888">It includes your custom ad copy, targeting strategy, 90-day roadmap, and qualification script — all built specifically for your business.</p>
          <a href="${planUrl}" style="background:${color};color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin:20px 0;font-size:15px">🚀 View My Marketing Plan</a>
          <p style="font-size:13px;color:#666;margin-top:24px">Questions? Reply to this email or visit your portal: <a href="${portalUrl}" style="color:${color}">${portalUrl}</a></p>
        </div>`,
      });
      // 10s timeout on email — never hang waiting for SMTP
      await Promise.race([emailPromise, new Promise((_,r)=>setTimeout(()=>r(new Error('email timeout')),10000))]);
      console.log('[plan] STEP D OK: email sent to', data.email);
    } catch(e) { console.error('[plan] STEP D email failed (non-fatal):', e.message); }

  } catch(err) {
    console.error('[plan] Generation failed:', err.message, err.stack);
  }
}

export default async (req, context) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});
  if (req.method!=='POST')    return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  let data;
  try { data=await req.json(); }
  catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  // Auth doc generated server-side in generateAndSavePlan — no upload sub-route needed

  // ── Sub-route: upload auth PDF after form submission ─────────────────────
  const reqUrl = new URL(req.url);
  if (reqUrl.pathname.endsWith('/upload-auth')) {
    const { agencyId: aId, clientId, authPdfBase64, authPdfFilename } = data;
    if (!aId || !clientId || !authPdfBase64) {
      return new Response(JSON.stringify({error:'agencyId, clientId, authPdfBase64 required'}),{status:400,headers:CORS});
    }
    try {
      const uploadData = { authPdfBase64, authPdfFilename, authSignerName: data.authSignerName||'', authSignerBusiness: data.authSignerBusiness||'', authTimestamp: data.authTimestamp||'', authDocRef: data.authDocRef||'' };
      await uploadAuthPdfToBlobs(clientId, aId, '', uploadData);
      console.log('[upload-auth] PDF saved for client:', clientId);
      return new Response(JSON.stringify({success:true}),{status:200,headers:CORS});
    } catch(e) {
      console.error('[upload-auth] failed:', e.message);
      return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
    }
  }

  const {agencyId} = data;
  if (!agencyId) return new Response(JSON.stringify({error:'agencyId required'}),{status:400,headers:CORS});

  // Required minimum fields
  // Only hard-require the minimum needed to create a client record
  // industry/primaryService use fallbacks so converted leads always work
  const required = ['firstName','email','businessName'];
  for(const f of required) {
    if(!data[f]) return new Response(JSON.stringify({error:`${f} is required`}),{status:400,headers:CORS});
  }
  // Apply fallbacks for optional but useful fields
  if(!data.lastName)       data.lastName       = '';
  if(!data.industry)       data.industry       = data.primaryService || 'General Business';
  if(!data.primaryService) data.primaryService = data.industry       || 'Marketing Services';
  if(!data.adBudget)       data.adBudget       = '1000';
  if(!data.adPlatforms)    data.adPlatforms    = 'Facebook, Instagram';
  if(!data.goal90Days)     data.goal90Days     = 'Generate leads and grow revenue';

  try {
    const agency = await fsGet(`agencies/${agencyId}`);
    if (!agency) return new Response(JSON.stringify({error:'Agency not found'}),{status:404,headers:CORS});

    const slug      = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-'+Date.now().toString(36);
    const baseUrl   = agency.siteUrl || 'https://marketingplan.astroaibots.com';
    const planUrl   = `${baseUrl}/plans/${agencyId}/${slug}`;
    const portalUrl = `${baseUrl}/onboard/portal?a=${agencyId}&s=${slug}`;
    const now       = new Date().toISOString();
    data._createdAt = now;

    // Save initial client record immediately
    await fsSet(`agencies/${agencyId}/clients/${slug}`, {
      agencyId, clientId: slug,
      firstName: data.firstName, lastName: data.lastName,
      clientName: `${data.firstName} ${data.lastName}`.trim(),
      clientEmail: data.email, businessName: data.businessName,
      phone: data.phone||'', industry: data.industry,
      primaryService: data.primaryService,
      adBudget: data.adBudget||'', adPlatforms: data.adPlatforms||'',
      serviceAreaType: data.serviceAreaType||'', serviceDetails: data.serviceDetails||'',
      website: data.website||'', companySize: data.companySize||'',
      goal90: data.goal90Days||'',
      goal90Days: data.goal90Days||'',
      status: 'new', createdAt: now,
      dashboardUrl: planUrl, dashboardJSON: '{}', notes: '',
      leadSource: data.source||'agency-onboarding',
    });
    console.log('[process-plan] Initial client record saved:', slug);

    // ── Save auth PDF immediately (sync, fast — just a blob write) ─────────────
    if (data.authPdfBase64 || (data.authSignature && data.authSignature.length > 100)) {
      uploadAuthPdfToBlobs(slug, agencyId, data.authSignature||'', data)
        .catch(e => console.error('[process-plan] PDF save failed:', e.message));
    }

    // ── Return immediately, fire background function for Claude ─────────────────
    // agency-process-plan has "m":1024 — Netlify kills it after ~1s response time.
    // The background function (im:background) has 15-min timeout — no limits.
    // We return success NOW and the bg function generates the plan independently.
    const bgPayload = JSON.stringify({
      agencyId, clientId: slug, planUrl, portalUrl,
      businessName:   data.businessName,
      firstName:      data.firstName,
      lastName:       data.lastName,
      email:          data.email,
      phone:          data.phone||'',
      industry:       data.industry,
      primaryService: data.primaryService,
      adBudget:       data.adBudget,
      adPlatforms:    data.adPlatforms,
      goal90Days:     data.goal90Days,
      mainGoal:       data.mainGoal||'',
      avgCustomerValue: data.avgCustomerValue||'',
      standOut:       data.standOut||'',
      promotions:     data.promotions||'',
      idealCustomer:  data.idealCustomer||'',
      ageGroups:      data.ageGroups||'',
      interests:      data.interests||'',
      serviceAreaType: data.serviceAreaType||'',
      serviceDetails: data.serviceDetails||'',
      qualifiedLead:  data.qualifiedLead||'',
      badLead:        data.badLead||'',
      qualifyingQuestions: data.qualifyingQuestions||'',
      workedWell:     data.workedWell||'',
      notWorked:      data.notWorked||'',
      responseTime:   data.responseTime||'',
      leadDestination: data.leadDestination||'',
      tags:           data.tags||'',
      source:         data.source||data.leadSource||'',
      createdAt:      now,
    });

    // Use fetch — Netlify routes this internally, much faster than https.request
    fetch('https://marketingplan.astroaibots.com/.netlify/functions/agency-generate-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bgPayload,
    }).catch(e => console.error('[process-plan] bg trigger error:', e.message));

    return new Response(JSON.stringify({success:true, clientId:slug, planUrl, portalUrl}), {
      status: 200,
      headers: { ...CORS, 'Connection': 'close' }
    });

  } catch(err) {
    console.error('[process-plan] ERROR:', err.message);
    return new Response(JSON.stringify({error:err.message}),{status:500,headers:CORS});
  }
};

export const config = { path: ['/api/agency/process-plan', '/api/agency/process-plan/upload-auth'] };
