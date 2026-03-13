// netlify/functions/get-plan-json.js
// Fetches dashboardJSON for a single client by slug
const https  = require('https');
const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  'Content-Type': 'application/json',
};

function getFirebaseToken() {
  return new Promise((resolve, reject) => {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }
    const now = Math.floor(Date.now() / 1000);
    const hdr = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const pay = b64u(JSON.stringify({ iss: clientEmail, sub: clientEmail, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope: 'https://www.googleapis.com/auth/datastore' }));
    const sig = b64u(crypto.createSign('RSA-SHA256').update(hdr + '.' + pay).sign(privateKey));
    const jwt  = hdr + '.' + pay + '.' + sig;
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req  = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { const t = JSON.parse(d).access_token; t ? resolve(t) : reject(new Error('No token')); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function firestoreGet(token, slug) {
  return new Promise((resolve, reject) => {
    const path = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/clients/${slug}`;
    const req = https.request({ hostname: 'firestore.googleapis.com', path, method: 'GET', headers: { 'Authorization': 'Bearer ' + token } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.headers.get('x-internal-key') !== process.env.INTERNAL_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  const url  = new URL(req.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return new Response(JSON.stringify({ error: 'slug required' }), { status: 400, headers: CORS });

  try {
    const token = await getFirebaseToken();
    const doc   = await firestoreGet(token, slug);

    if (doc.error) {
      return new Response(JSON.stringify({ error: doc.error.message || 'Not found' }), { status: 404, headers: CORS });
    }

    const f   = doc.fields || {};
    const raw = f.dashboardJSON?.stringValue || '';

    if (!raw) {
      return new Response(JSON.stringify({ 
        error: 'no_data',
        fieldExists: !!f.dashboardJSON,
        fieldType: f.dashboardJSON ? Object.keys(f.dashboardJSON)[0] : null,
      }), { status: 200, headers: CORS });
    }

    try {
      const parsed = JSON.parse(raw);
      return new Response(JSON.stringify({ 
        ok: true,
        adAnglesCount: parsed.adAngles ? parsed.adAngles.length : 0,
        keys: Object.keys(parsed),
        dashboardJSON: parsed,
      }), { status: 200, headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ 
        error: 'parse_failed',
        message: e.message,
        rawLength: raw.length,
        rawSnippet: raw.slice(0, 500),
      }), { status: 200, headers: CORS });
    }

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/get-plan-json' };
