// netlify/functions/send-pdf.js
// Receives base64 PDF + client metadata, emails it to owner,
// saves to GitHub public/auth-forms/{slug}.pdf, and stores URL in Firestore

const nodemailer = require('nodemailer');
const https      = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

// ── GitHub — save PDF to repo ─────────────────────────────────────────────────
function saveToGitHub(slug, pdfBase64) {
  return new Promise((resolve) => {
    if (!process.env.GITHUB_TOKEN) { console.warn('GITHUB_TOKEN not set — skipping GitHub PDF save'); return resolve(null); }
    const path = `public/auth-forms/${slug}.pdf`;
    const body = JSON.stringify({
      message: `Add auth form: ${slug}`,
      content: pdfBase64,  // already base64
    });

    // First try to get existing SHA (in case file exists)
    const getReq = https.request({
      hostname: 'api.github.com',
      path:     `/repos/rayanfarajj/astroai-backend/contents/${path}`,
      method:   'GET',
      headers:  { 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'AstroAI', 'Accept': 'application/vnd.github+json' },
    }, getRes => {
      let d = ''; getRes.on('data', c => d += c);
      getRes.on('end', () => {
        let putBody = { message: `Add auth form: ${slug}`, content: pdfBase64 };
        try { const j = JSON.parse(d); if (j.sha) putBody.sha = j.sha; } catch {}

        const putReq = https.request({
          hostname: 'api.github.com',
          path:     `/repos/rayanfarajj/astroai-backend/contents/${path}`,
          method:   'PUT',
          headers:  {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'User-Agent':    'AstroAI',
            'Accept':        'application/vnd.github+json',
            'Content-Type':  'application/json',
            'Content-Length': Buffer.byteLength(JSON.stringify(putBody)),
          },
        }, res => {
          let rd = ''; res.on('data', c => rd += c);
          res.on('end', () => {
            console.log('[send-pdf] GitHub PDF save status:', res.statusCode);
            resolve(res.statusCode < 300);
          });
        });
        putReq.on('error', e => { console.warn('[send-pdf] GitHub PDF error:', e.message); resolve(null); });
        putReq.write(JSON.stringify(putBody)); putReq.end();
      });
    });
    getReq.on('error', e => { console.warn('[send-pdf] GitHub get error:', e.message); resolve(null); });
    getReq.end();
  });
}

// ── Firebase helpers ──────────────────────────────────────────────────────────
function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
async function getFirebaseToken() {
  const FIREBASE_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
  const FIREBASE_KEY   = process.env.FIREBASE_PRIVATE_KEY;
  const now = Math.floor(Date.now()/1000);
  const header  = base64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: FIREBASE_EMAIL, sub: FIREBASE_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }));
  const signing = `${header}.${payload}`;
  const pemKey  = FIREBASE_KEY.replace(/\\n/g,'\n');
  const keyData = pemKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,'');
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', Buffer.from(keyData,'base64'),
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, Buffer.from(signing));
  const jwt = `${signing}.${base64url(new Uint8Array(sig))}`;
  return new Promise((resolve, reject) => {
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req  = https.request({
      hostname:'oauth2.googleapis.com', path:'/token', method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)},
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        const td = JSON.parse(d);
        if (!td.access_token) return reject(new Error('Firebase auth failed: '+JSON.stringify(td)));
        resolve(td.access_token);
      });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

async function updateFirestoreAuthPdf(slug, authPdfUrl) {
  const token = await getFirebaseToken();
  const proj  = process.env.FIREBASE_PROJECT_ID;
  const url   = `https://firestore.googleapis.com/v1/projects/${proj}/databases/(default)/documents/clients/${slug}?updateMask.fieldPaths=authPdfUrl`;
  return new Promise((resolve) => {
    const body = JSON.stringify({ fields: { authPdfUrl: { stringValue: authPdfUrl } } });
    const req  = https.request({
      hostname: 'firestore.googleapis.com',
      path:     `/v1/projects/${proj}/databases/(default)/documents/clients/${slug}?updateMask.fieldPaths=authPdfUrl`,
      method:   'PATCH',
      headers:  { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ console.log('[send-pdf] Firestore authPdfUrl updated:', res.statusCode); resolve(res.statusCode < 300); });
    });
    req.on('error', e => { console.warn('[send-pdf] Firestore update error:', e.message); resolve(false); });
    req.write(body); req.end();
  });
}

function slugify(s) {
  return (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,60);
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { pdfBase64, filename, clientName, clientBusiness, clientEmail, clientPhone, signedAt, clientIP, docRef, accessMethod, adPlatforms, adBudget } = body;

  if (!pdfBase64) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No PDF provided' }) };

  // ── Email ─────────────────────────────────────────────────────────────────
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });

  const emailBody = `New onboarding authorization signed and submitted.\n\n────────────────────────────────\nCLIENT DETAILS\n────────────────────────────────\nName:         ${clientName || 'N/A'}\nBusiness:     ${clientBusiness || 'N/A'}\nEmail:        ${clientEmail || 'N/A'}\nPhone:        ${clientPhone || 'N/A'}\n\n────────────────────────────────\nAUTHORIZATION RECORD\n────────────────────────────────\nSigned At:    ${signedAt || 'N/A'}\nIP Address:   ${clientIP || 'N/A'}\nDoc Ref:      ${docRef || 'N/A'}\n\n────────────────────────────────\nCAMPAIGN INFO\n────────────────────────────────\nAccess Method:  ${accessMethod || 'N/A'}\nAd Platforms:   ${adPlatforms || 'N/A'}\nAd Budget:      ${adBudget || 'N/A'}\n\n────────────────────────────────\nThe signed authorization PDF is attached.\n────────────────────────────────\n\nAstro A.I. Marketing Platform`.trim();

  try {
    await transporter.sendMail({
      from:    `"Astro A.I. Onboarding" <${process.env.GMAIL_USER}>`,
      to:      'rayan@farajcorp.com',
      subject: `New Onboarding Signed — ${clientName || 'Unknown'} (${clientBusiness || 'Unknown'})`,
      text:    emailBody,
      attachments: [{ filename: filename || 'AstroAI_Authorization.pdf', content: pdfBase64, encoding: 'base64', contentType: 'application/pdf' }],
    });
    console.log('[send-pdf] Email sent ✓');
  } catch (err) {
    console.error('[send-pdf] Email error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Failed to send email', details: err.message }) };
  }

  // ── Save to GitHub + update Firestore (non-fatal) ─────────────────────────
  const slug       = slugify(clientBusiness || clientName || 'client');
  const authPdfUrl = `https://raw.githubusercontent.com/rayanfarajj/astroai-backend/main/public/auth-forms/${slug}.pdf`;

  try {
    const saved = await saveToGitHub(slug, pdfBase64);
    if (saved) {
      console.log('[send-pdf] PDF saved to GitHub:', authPdfUrl);
      await updateFirestoreAuthPdf(slug, authPdfUrl);
    }
  } catch(e) {
    console.warn('[send-pdf] GitHub/Firestore save failed (non-fatal):', e.message);
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, message: 'PDF emailed and saved', authPdfUrl }) };
};
