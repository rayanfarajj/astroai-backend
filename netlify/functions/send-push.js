// netlify/functions/send-push.js
// Sends a Web Push notification to a client's push subscription
// Called from: agency-generate-background (plan ready), send-message (new message), agency dashboard
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

// ── Firebase helpers ─────────────────────────────────────────────────────────
function getToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
    const b64   = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now   = Math.floor(Date.now()/1000);
    const h     = b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const p     = b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const s     = b64(crypto.createSign('RSA-SHA256').update(h+'.'+p).sign(key));
    const body  = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${s}`;
    const r = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error(d));});
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

function fsHttp(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s=body?JSON.stringify(body):null;
    const r=https.request({hostname:'firestore.googleapis.com',path,method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); if(s)r.write(s); r.end();
  });
}

function fromFS(v) {
  if(!v) return null;
  if('stringValue' in v) return v.stringValue;
  if('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,val])=>[k,fromFS(val)]));
  return null;
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// ── VAPID Web Push implementation (no npm packages needed) ──────────────────
function vapidSign(audience) {
  const email  = process.env.VAPID_SUBJECT || 'mailto:info@astroaibots.com';
  const pubKey = process.env.VAPID_PUBLIC_KEY;
  const privKey= process.env.VAPID_PRIVATE_KEY;

  if (!pubKey || !privKey) throw new Error('VAPID keys not configured');

  const b64u = s => Buffer.from(s).toString('base64url');
  const now  = Math.floor(Date.now()/1000);
  const header = b64u(JSON.stringify({ typ:'JWT', alg:'ES256' }));
  const payload= b64u(JSON.stringify({ aud: audience, exp: now+43200, sub: email }));

  // Import private key from base64url
  const privDer = Buffer.from(privKey, 'base64url');
  // Build PKCS8 DER for P-256 private key
  const pkcs8Header = Buffer.from('308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420','hex');
  const privKeyDer  = Buffer.concat([pkcs8Header, privDer]);
  const key = crypto.createPrivateKey({ key: privKeyDer, format: 'der', type: 'pkcs8' });
  const sig = crypto.createSign('SHA256').update(header+'.'+payload).sign(key);

  // DER to raw R||S (64 bytes)
  const derToRaw = der => {
    let i = 2; // skip SEQUENCE tag+len
    i += (der[1] & 0x80) ? (der[1] & 0x7f) + 1 : 1; // skip outer length
    i++; // skip INTEGER tag
    const rLen = der[i++]; const r = der.slice(i + (rLen > 32 ? 1:0), i + rLen);
    i += rLen; i++; // skip INTEGER tag
    const sLen = der[i++]; const s = der.slice(i + (sLen > 32 ? 1:0), i + sLen);
    return Buffer.concat([Buffer.alloc(32-r.length), r, Buffer.alloc(32-s.length), s]);
  };

  const rawSig = b64u(derToRaw(sig));
  return `${header}.${payload}.${rawSig}`;
}

// Send a single push message to a subscription endpoint
function sendWebPush(subscription, payload) {
  return new Promise((resolve, reject) => {
    if (!subscription?.endpoint) return reject(new Error('No endpoint in subscription'));

    const endpointUrl = new URL(subscription.endpoint);
    const audience    = `${endpointUrl.protocol}//${endpointUrl.host}`;
    const jwt         = vapidSign(audience);
    const pubKey      = process.env.VAPID_PUBLIC_KEY;

    const body = Buffer.from(JSON.stringify(payload));

    // For now send as plaintext (no encryption) — works for most push services
    // For full RFC8291 encryption you'd need ece library
    const headers = {
      'Authorization': `vapid t=${jwt},k=${pubKey}`,
      'Content-Type':  'application/json',
      'Content-Length': body.length,
      'TTL': '86400',
    };

    const r = https.request({
      hostname: endpointUrl.hostname,
      path:     endpointUrl.pathname + endpointUrl.search,
      method:   'POST',
      headers,
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode });
        } else if (res.statusCode === 410 || res.statusCode === 404) {
          resolve({ ok: false, gone: true, status: res.statusCode }); // subscription expired
        } else {
          resolve({ ok: false, status: res.statusCode, body: d.slice(0,200) });
        }
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });

  let data;
  try { data = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { agencyId, clientId, title, body: msgBody, url, tag } = data;

  if (!agencyId || !clientId) {
    return new Response(JSON.stringify({ error: 'agencyId and clientId required' }), { status: 400, headers: CORS });
  }

  try {
    const token = await getToken();

    // Get client doc to find push subscription
    const doc = await fsHttp('GET', `${BASE()}/agencies/${agencyId}/clients/${clientId}`, null, token);
    if (!doc.fields) {
      return new Response(JSON.stringify({ error: 'Client not found' }), { status: 404, headers: CORS });
    }

    const pushSubRaw = doc.fields.pushSubscription?.stringValue;
    if (!pushSubRaw) {
      return new Response(JSON.stringify({ ok: false, reason: 'No push subscription on file' }), { status: 200, headers: CORS });
    }

    let subscription;
    try { subscription = JSON.parse(pushSubRaw); } catch {
      return new Response(JSON.stringify({ ok: false, reason: 'Invalid subscription data' }), { status: 200, headers: CORS });
    }

    const payload = {
      title: title || 'Marketing Portal',
      body:  msgBody || 'You have a new update.',
      icon:  '/icons/portal-icon-192.png',
      badge: '/icons/portal-icon-192.png',
      tag:   tag || 'portal',
      url:   url || `/onboard/portal?a=${agencyId}&s=${clientId}`,
      data:  { agencyId, clientId, url: url || `/onboard/portal?a=${agencyId}&s=${clientId}` },
    };

    const result = await sendWebPush(subscription, payload);
    console.log('[send-push] result:', result, 'for client:', clientId);

    // If subscription expired, remove it from Firestore
    if (result.gone) {
      await fsHttp('PATCH', `${BASE()}/agencies/${agencyId}/clients/${clientId}?updateMask.fieldPaths=pushSubscription`, {
        fields: { pushSubscription: { nullValue: null } }
      }, token);
    }

    return new Response(JSON.stringify({ ok: result.ok, status: result.status }), { status: 200, headers: CORS });

  } catch(e) {
    console.error('[send-push] error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/send-push' };
