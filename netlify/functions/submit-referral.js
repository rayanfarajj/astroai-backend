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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { referrerSlug, referrerName, referrerBusiness, refereeName, refereeEmail, refereePhone, refereeBusinessName, refereeNote } = body;

  if (!referrerSlug || !refereeEmail) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'referrerSlug and refereeEmail required' }) };
  }

  const referralId = referrerSlug + '-ref-' + Date.now().toString(36);
  const now = new Date().toISOString();

  try {
    const token = await getFirebaseToken();

    // Save referral to Firestore
    await firestoreSet(token, 'referrals', referralId, {
      referralId:        { stringValue: referralId },
      referrerSlug:      { stringValue: referrerSlug },
      referrerName:      { stringValue: referrerName || '' },
      referrerBusiness:  { stringValue: referrerBusiness || '' },
      refereeName:       { stringValue: refereeName || '' },
      refereeEmail:      { stringValue: refereeEmail },
      refereePhone:      { stringValue: refereePhone || '' },
      refereeBusinessName:{ stringValue: refereeBusinessName || '' },
      refereeNote:       { stringValue: refereeNote || '' },
      status:            { stringValue: 'pending' },
      createdAt:         { stringValue: now },
    });

    // Update referral count on client record
    const clientDoc = await firestoreGet(token, 'clients', referrerSlug);
    if (clientDoc.fields) {
      const currentCount = parseInt(clientDoc.fields.referralCount?.integerValue || '0') + 1;
      await firestoreSet(token, 'clients', referrerSlug, {
        ...clientDoc.fields,
        referralCount: { integerValue: String(currentCount) },
      });
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

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, referralId }) };
  } catch(e) {
    console.error('[submit-referral] Error:', e.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
