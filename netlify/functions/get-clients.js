// netlify/functions/get-clients.js
const https = require('https');
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
    const pay = b64u(JSON.stringify({
      iss: clientEmail, sub: clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now, exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/datastore',
    }));
    const sig = b64u(crypto.createSign('RSA-SHA256').update(hdr + '.' + pay).sign(privateKey));
    const jwt  = hdr + '.' + pay + '.' + sig;
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req  = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { const t = JSON.parse(d).access_token; t ? resolve(t) : reject(new Error('No token: ' + d)); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function firestoreList(token) {
  return new Promise((resolve, reject) => {
    const path = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/clients?pageSize=200`;
    const req = https.request({
      hostname: 'firestore.googleapis.com', path, method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token },
    }, res => {
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

  try {
    const token = await getFirebaseToken();
    const data  = await firestoreList(token);

    if (!data.documents) {
      return new Response(JSON.stringify({ clients: [] }), { status: 200, headers: CORS });
    }

    const clients = data.documents.map(doc => {
      const f   = doc.fields || {};
      const get = (k) => f[k]?.stringValue || f[k]?.integerValue || '';
      return {
        id:             doc.name.split('/').pop(),
        businessName:   get('businessName'),
        clientName:     get('clientName'),
        clientEmail:    get('clientEmail'),
        industry:       get('industry'),
        primaryService: get('primaryService'),
        adBudget:       get('adBudget'),
        adPlatforms:    get('adPlatforms'),
        serviceArea:    get('serviceArea'),
        website:        get('website'),
        phone:          get('phone'),
        companySize:    get('companySize'),
        goal90:         get('goal90'),
        dashboardUrl:   get('dashboardUrl'),
        generatedAt:    get('generatedAt'),
        createdAt:      get('createdAt'),
        status:         get('status') || 'new',
        statusLabel:    get('statusLabel') || '🆕 New',
        dashboardJSON:  (() => {
          // Try stringValue first (how objects are stored)
          const raw = f['dashboardJSON']?.stringValue
                   || f['dashboardJSON']?.bytesValue
                   || '';
          if (!raw) return {};
          try {
            const parsed = JSON.parse(raw);
            return parsed;
          } catch(e) {
            console.error('[get-clients] dashboardJSON parse failed, raw length:', raw.length, 'error:', e.message);
            // Try to recover truncated JSON
            const idx = raw.lastIndexOf('}]}}');
            if (idx > 0) {
              try { return JSON.parse(raw.slice(0, idx + 4)); } catch(e2) {}
            }
            return { _parseError: e.message, _rawLength: raw.length };
          }
        })(),
        _rawJSONLength: (f['dashboardJSON']?.stringValue || '').length,
      };
    });

    clients.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return new Response(JSON.stringify({ clients }), { status: 200, headers: CORS });

  } catch(err) {
    console.error('[get-clients] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = {
  path: '/api/get-clients',
};
