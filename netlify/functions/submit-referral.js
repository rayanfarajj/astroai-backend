// netlify/functions/submit-referral.js
// Saves a referral to Firestore and notifies agency via email

const https    = require('https');
const nodemailer = require('nodemailer');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function getFirebaseToken() {
  return new Promise((resolve, reject) => {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const crypto = require('crypto');
    function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }
    const now = Math.floor(Date.now() / 1000);
    const hdr = b64u(JSON.stringify({ alg:'RS256', typ:'JWT' }));
    const pay = b64u(JSON.stringify({ iss:clientEmail, sub:clientEmail, aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/datastore' }));
    const sig = b64u(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(privateKey));
    const jwt = hdr+'.'+pay+'.'+sig;
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request({ hostname:'oauth2.googleapis.com', path:'/token', method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error('No token: '+d)); });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function firestoreSet(token, collection, docId, fields) {
  return new Promise((resolve, reject) => {
    const proj = process.env.FIREBASE_PROJECT_ID;
    const path = `/v1/projects/${proj}/databases/(default)/documents/${collection}/${docId}`;
    const body = JSON.stringify({ fields });
    const req = https.request({
      hostname: 'firestore.googleapis.com', path, method: 'PATCH',
      headers: { 'Authorization':'Bearer '+token, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)} }); });
    req.on('error',reject); req.write(body); req.end();
  });
}

function firestoreGet(token, collection, docId) {
  return new Promise((resolve, reject) => {
    const proj = process.env.FIREBASE_PROJECT_ID;
    const path = `/v1/projects/${proj}/databases/(default)/documents/${collection}/${docId}`;
    const req = https.request({ hostname:'firestore.googleapis.com', path, method:'GET', headers:{'Authorization':'Bearer '+token} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)} });
    });
    req.on('error',reject); req.end();
  });
}

function sendHL_SMS(toPhone, message, contact) {
  return new Promise((resolve, reject) => {
    const webhookUrl = process.env.HL_WEBHOOK_URL;
    if (!webhookUrl) return resolve(null);
    let p = (toPhone||'').replace(/[\s\-().]/g,'');
    if (!p.startsWith('+')) p = '+1' + p.replace(/^1/,'');
    const nameParts = (contact.name||'').split(' ');
    const bodyStr = JSON.stringify({
      phone: p, message,
      firstName:    nameParts[0] || '',
      lastName:     nameParts.slice(1).join(' ') || '',
      email:        contact.email || '',
      businessName: contact.business || '',
      full_name:    contact.name || '',
    });
    const url = new URL(webhookUrl);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode})); });
    req.on('error', e => { console.warn('[submit-referral] SMS error:', e.message); resolve(null); });
    req.write(bodyStr); req.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { referrerSlug, referrerName, referrerBusiness, refereeName, refereeEmail, refereePhone, refereeBusinessName, refereeNote, agencyId } = body;

  if (!referrerSlug || !refereeEmail) {
    return new Response(JSON.stringify({ error: 'referrerSlug and refereeEmail required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const referralId = referrerSlug + '-ref-' + Date.now().toString(36);
  const now = new Date().toISOString();

  try {
    const token = await getFirebaseToken();

    // Save referral to Firestore
    const referralData = {
      referralId:          { stringValue: referralId },
      referrerSlug:        { stringValue: referrerSlug },
      referrerName:        { stringValue: referrerName || '' },
      referrerBusiness:    { stringValue: referrerBusiness || '' },
      referrerClientName:  { stringValue: referrerName || '' },       // alias for dashboard display
      referrerBusinessName:{ stringValue: referrerBusiness || '' },   // alias for dashboard display
      refereeName:         { stringValue: refereeName || '' },
      refereeEmail:        { stringValue: refereeEmail },
      refereePhone:        { stringValue: refereePhone || '' },
      refereeBusinessName: { stringValue: refereeBusinessName || '' },
      refereeNote:         { stringValue: refereeNote || '' },
      status:              { stringValue: 'pending' },
      agencyId:            { stringValue: agencyId || '' },
      source:              { stringValue: 'client-portal' },
      createdAt:           { stringValue: now },
    };
    await firestoreSet(token, 'referrals', referralId, referralData);

    // Update referral count — check agency subcollection first, fall back to root clients
    let countUpdated = false;
    if (agencyId) {
      try {
        const agencyClientDoc = await firestoreGet(token, `agencies/${agencyId}/clients`, referrerSlug);
        if (agencyClientDoc && agencyClientDoc.fields) {
          const currentCount = parseInt(agencyClientDoc.fields.referralCount?.integerValue || '0') + 1;
          await firestoreSet(token, `agencies/${agencyId}/clients`, referrerSlug, {
            ...agencyClientDoc.fields,
            referralCount: { integerValue: String(currentCount) },
          });
          countUpdated = true;
        }
      } catch(e) {}
    }
    if (!countUpdated) {
      const clientDoc = await firestoreGet(token, 'clients', referrerSlug);
      if (clientDoc && clientDoc.fields) {
        const currentCount = parseInt(clientDoc.fields.referralCount?.integerValue || '0') + 1;
        await firestoreSet(token, 'clients', referrerSlug, {
          ...clientDoc.fields,
          referralCount: { integerValue: String(currentCount) },
        });
      }
    }

    // Email agency
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });

    await transporter.sendMail({
      from: `"Astro AI Referrals" <${process.env.GMAIL_USER}>`,
      to: 'rayan@farajcorp.com',
      subject: `🤝 New Referral from ${referrerBusiness || referrerName} → ${refereeBusinessName || refereeEmail}`,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f8fafc;">
          <div style="background:#1e3a5f;border-radius:12px;padding:24px 32px;text-align:center;margin-bottom:20px;">
            <h1 style="color:#fff;font-size:1.2rem;margin:0;">🤝 New Client Referral</h1>
          </div>
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb;">
            <h3 style="color:#1e3a5f;margin:0 0 16px;">Referred By</h3>
            <p style="color:#4b5563;"><strong>${referrerName}</strong> — ${referrerBusiness}</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
            <h3 style="color:#1e3a5f;margin:0 0 16px;">Referred Contact</h3>
            <p style="color:#4b5563;"><strong>Name:</strong> ${refereeName || 'N/A'}</p>
            <p style="color:#4b5563;"><strong>Business:</strong> ${refereeBusinessName || 'N/A'}</p>
            <p style="color:#4b5563;"><strong>Email:</strong> ${refereeEmail}</p>
            <p style="color:#4b5563;"><strong>Phone:</strong> ${refereePhone || 'N/A'}</p>
            ${refereeNote ? `<p style="color:#4b5563;"><strong>Note:</strong> ${refereeNote}</p>` : ''}
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
            <p style="color:#6b7280;font-size:.8rem;">Referral ID: ${referralId}</p>
          </div>
        </div>`,
    });

    // ── Notify the referee via email ─────────────────────────────────────────
    if (refereeEmail) {
      try {
        await transporter.sendMail({
          from: `"Astro AI Marketing" <${process.env.GMAIL_USER}>`,
          to: refereeEmail,
          subject: `${referrerName} thought you'd love this 🚀`,
          html: `
            <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;">
              <div style="background:linear-gradient(135deg,#1e3a5f,#2d5282);border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center;">
                <div style="font-size:2.5rem;margin-bottom:8px;">🚀</div>
                <h1 style="color:#fff;font-size:1.3rem;margin:0;">You've Been Referred!</h1>
                <p style="color:rgba(255,255,255,0.65);font-size:.85rem;margin:8px 0 0;">Your friend wants to see you win</p>
              </div>
              <div style="background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e5e7eb;">
                <p style="font-size:1rem;color:#1a1d2e;">Hi ${refereeName || 'there'} 👋,</p>
                <p style="color:#4b5563;line-height:1.7;"><strong>${referrerName}</strong>${referrerBusiness ? ` from <strong>${referrerBusiness}</strong>` : ''} referred you to <strong>Astro AI Marketing</strong> — and they wanted to make sure you got hooked up.</p>
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:20px 24px;margin:24px 0;text-align:center;">
                  <div style="font-size:1.5rem;margin-bottom:8px;">🎁</div>
                  <p style="color:#9a3412;font-weight:700;font-size:1rem;margin:0 0 6px;">You both get 30% off!</p>
                  <p style="color:#c2410c;font-size:.85rem;margin:0;line-height:1.6;">Start your free trial and your discount is automatically applied. <strong>${referrerName}</strong> gets their 30% off when you sign up.</p>
                </div>
                <p style="color:#4b5563;line-height:1.7;">Astro AI builds you a complete AI-powered marketing system — ad copy, targeting strategy, campaign roadmap, and more — all personalized for your business in minutes.</p>
                <div style="text-align:center;margin:28px 0;">
                  <a href="https://astroaibots.com" style="background:#f97316;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:.9rem;">Start Your Free Trial →</a>
                </div>
                <p style="color:#6b7280;font-size:.8rem;text-align:center;">Go to <a href="https://astroaibots.com" style="color:#f97316;">astroaibots.com</a> to get started</p>
              </div>
            </div>`,
        });
        console.log('[submit-referral] Referee email sent to', refereeEmail);
      } catch(e) { console.warn('[submit-referral] Referee email failed:', e.message); }
    }

    // ── Notify the referee via SMS ────────────────────────────────────────────
    if (refereePhone) {
      try {
        const smsMsg = `Hey ${refereeName || 'there'}! ${referrerName}${referrerBusiness ? ` from ${referrerBusiness}` : ''} referred you to Astro AI Marketing 🚀 You both get 30% off — start your free trial at astroaibots.com`;
        await sendHL_SMS(refereePhone, smsMsg, {
          name:     refereeName || '',
          email:    refereeEmail || '',
          business: refereeBusinessName || '',
        });
        console.log('[submit-referral] Referee SMS sent to', refereePhone);
      } catch(e) { console.warn('[submit-referral] Referee SMS failed:', e.message); }
    }

    // ── Also notify the referrer ──────────────────────────────────────────────
    try {
      const clientDoc2 = await firestoreGet(token, 'clients', referrerSlug);
      const referrerPhone = clientDoc2?.fields?.phone?.stringValue || '';
      const referrerEmail = clientDoc2?.fields?.clientEmail?.stringValue || '';
      if (referrerPhone) {
        const referrerSms = `Hey ${referrerName}! We just sent your referral to ${refereeName || refereeEmail} 🎉 When they sign up, you both get 30% off. Thanks for spreading the word!`;
        await sendHL_SMS(referrerPhone, referrerSms, { name: referrerName, email: referrerEmail, business: referrerBusiness });
      }
      if (referrerEmail) {
        await transporter.sendMail({
          from: `"Astro AI Marketing" <${process.env.GMAIL_USER}>`,
          to: referrerEmail,
          subject: `Your referral was sent! 🎉`,
          html: `
            <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;">
              <div style="background:#065f46;border-radius:12px;padding:24px 32px;text-align:center;margin-bottom:20px;">
                <div style="font-size:2rem;margin-bottom:6px;">🎉</div>
                <h1 style="color:#fff;font-size:1.1rem;margin:0;">Referral Sent Successfully!</h1>
              </div>
              <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb;">
                <p style="color:#1a1d2e;">Hi <strong>${referrerName}</strong>,</p>
                <p style="color:#4b5563;line-height:1.7;">We just reached out to <strong>${refereeName || refereeEmail}</strong>${refereeBusinessName ? ` from <strong>${refereeBusinessName}</strong>` : ''} with your referral and their exclusive offer.</p>
                <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px;margin:20px 0;text-align:center;">
                  <p style="color:#065f46;font-weight:700;margin:0;">When they sign up, you both get 30% off 🎁</p>
                </div>
                <p style="color:#4b5563;line-height:1.7;">Thank you for sharing Astro AI — we really appreciate it!</p>
                <p style="color:#4b5563;">— <strong>The Astro AI Team</strong></p>
              </div>
            </div>`,
        });
      }
    } catch(e) { console.warn('[submit-referral] Referrer notify failed:', e.message); }

    return new Response(JSON.stringify({ success: true, referralId }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch(e) {
    console.error('[submit-referral] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
};

export const config = {
  path: '/api/submit-referral',
};
