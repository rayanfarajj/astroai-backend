// netlify/functions/agency-services.js
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-agency-token',
  'Content-Type': 'application/json',
};

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function getToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const b64   = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now   = Math.floor(Date.now() / 1000);
    const h     = b64(JSON.stringify({ alg:'RS256', typ:'JWT' }));
    const p     = b64(JSON.stringify({ iss:email, sub:email, aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/datastore' }));
    const sig   = b64(crypto.createSign('RSA-SHA256').update(h+'.'+p).sign(key));
    const body  = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${sig}`;
    const req   = https.request({ hostname:'oauth2.googleapis.com', path:'/token', method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded', 'Content-Length':Buffer.byteLength(body) } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { const t = JSON.parse(d).access_token; t ? resolve(t) : reject(new Error('No token')); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function fsHttp(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const s = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'firestore.googleapis.com', path, method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...(s ? { 'Content-Length': Buffer.byteLength(s) } : {}) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject); if (s) req.write(s); req.end();
  });
}

async async function verifySession(sessionToken) {
  if (!sessionToken) return null;
  try {
    const fbToken = await getToken();
    const doc = await fsHttp('GET', `${BASE()}/agency_sessions/${sessionToken}`, null, fbToken);
    if (!doc || !doc.fields) return null;
    const expiresAt = doc.fields.expiresAt?.stringValue || '';
    if (expiresAt && new Date(expiresAt) < new Date()) return null;
    return doc.fields.agencyId?.stringValue || null;
  } catch(e) {
    return null;
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const agencyToken = req.headers.get('x-agency-token') || '';
  const agencyId    = await verifySession(agencyToken);
  if (!agencyId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });

  const url      = new URL(req.url);
  const clientId = url.searchParams.get('clientId') || '';
  if (!clientId) return new Response(JSON.stringify({ error: 'clientId required' }), { status: 400, headers: CORS });

  const COL = `agencies/${agencyId}/clients/${clientId}/services`;

  try {
    const token = await getToken();

    if (req.method === 'GET') {
      const data = await fsHttp('GET', `${BASE()}/${COL}?pageSize=100`, null, token);
      const docs = (data.documents || []).map(doc => {
        const f = doc.fields || {};
        const s = k => f[k]?.stringValue || '';
        return {
          id:            doc.name.split('/').pop(),
          headline:      s('headline'),
          description:   s('description'),
          amount:        s('amount'),
          paymentStatus: s('paymentStatus'),
          orderDate:     s('orderDate'),
          orderStatus:   s('orderStatus'),
          createdAt:     s('createdAt'),
        };
      }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return new Response(JSON.stringify({ success: true, services: docs }), { status: 200, headers: CORS });
    }

    if (req.method === 'POST') {
      const body   = await req.json();
      const action = body.action || 'save';

      if (action === 'delete') {
        if (!body.serviceId) return new Response(JSON.stringify({ error: 'serviceId required' }), { status: 400, headers: CORS });
        await fsHttp('DELETE', `${BASE()}/${COL}/${body.serviceId}`, null, token);
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
      }

      const serviceId = body.serviceId || ('svc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
      const doc = {
        fields: {
          headline:      { stringValue: body.headline      || '' },
          description:   { stringValue: body.description   || '' },
          amount:        { stringValue: body.amount        || '' },
          paymentStatus: { stringValue: body.paymentStatus || 'pending' },
          orderDate:     { stringValue: body.orderDate     || new Date().toISOString().slice(0, 10) },
          orderStatus:   { stringValue: body.orderStatus   || 'pending' },
          createdAt:     { stringValue: body.createdAt     || new Date().toISOString() },
        }
      };
      await fsHttp('PATCH', `${BASE()}/${COL}/${serviceId}`, doc, token);
      return new Response(JSON.stringify({ success: true, serviceId }), { status: 200, headers: CORS });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });

  } catch(e) {
    console.error('[agency-services]', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/agency/services' };
