// netlify/functions/set-offer.js
// Agency sets a special offer (global or per-client) — stored in Firestore

const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
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

function firestoreSet(token, docPath, fields) {
  return new Promise((resolve, reject) => {
    const proj = process.env.FIREBASE_PROJECT_ID;
    const path = `/v1/projects/${proj}/databases/(default)/documents/${docPath}`;
    const body = JSON.stringify({ fields });
    const req = https.request({
      hostname: 'firestore.googleapis.com', path, method: 'PATCH',
      headers: { 'Authorization':'Bearer '+token, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)} }); });
    req.on('error',reject); req.write(body); req.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.headers.get('x-internal-key') !== process.env.INTERNAL_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { title, description, ctaText, ctaUrl, expiresAt, targetSlug, active } = body;

  if (!title || !ctaUrl) {
    return new Response(JSON.stringify({ error: 'title and ctaUrl required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const token = await getFirebaseToken();
    // 'global' offer or per-client offer (targetSlug)
    const docPath = targetSlug ? `offers/${targetSlug}` : 'offers/global';

    await firestoreSet(token, docPath, {
      title:       { stringValue: title },
      description: { stringValue: description || '' },
      ctaText:     { stringValue: ctaText || 'Claim Offer' },
      ctaUrl:      { stringValue: ctaUrl },
      expiresAt:   { stringValue: expiresAt || '' },
      targetSlug:  { stringValue: targetSlug || 'global' },
      active:      { booleanValue: active !== false },
      updatedAt:   { stringValue: new Date().toISOString() },
    });

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch(e) {
    console.error('[set-offer] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
};

export const config = {
  path: '/api/set-offer',
};
