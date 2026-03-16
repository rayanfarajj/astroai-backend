// netlify/functions/save-push-subscription.js
// Saves a client's Web Push subscription to their Firestore record
import https from 'https';
import crypto from 'crypto';

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

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

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });

  let data;
  try { data = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { agencyId, clientId, subscription } = data;
  if (!agencyId || !clientId || !subscription?.endpoint) {
    return new Response(JSON.stringify({ error: 'agencyId, clientId, and subscription required' }), { status: 400, headers: CORS });
  }

  try {
    const token = await getToken();

    // Save subscription to Firestore client record (PATCH only this field)
    await fsHttp('PATCH',
      `${BASE()}/agencies/${agencyId}/clients/${clientId}?updateMask.fieldPaths=pushSubscription&updateMask.fieldPaths=pushSubscribedAt`,
      {
        fields: {
          pushSubscription:  { stringValue: JSON.stringify(subscription) },
          pushSubscribedAt:  { stringValue: new Date().toISOString() },
        }
      },
      token
    );

    console.log('[save-push] subscription saved for:', clientId);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });

  } catch(e) {
    console.error('[save-push] error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/save-push-subscription' };
