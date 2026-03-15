// netlify/functions/debug-billing.js
// TEMPORARY debug endpoint — delete after fixing
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error(d));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function fsRaw(token, path) {
  return new Promise((resolve)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/${path}`,method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({error:e.message,raw:d})}});
    });
    r.on('error',(e)=>resolve({error:e.message})); r.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('',{status:200,headers:CORS});
  if (url.searchParams.get('key') !== 'AstroAdmin2024!') {
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  }

  const url = new URL(req.url);
  const agencyId = url.searchParams.get('a') || '';
  const clientId = url.searchParams.get('c') || '';

  if (!agencyId || !clientId) {
    return new Response(JSON.stringify({error:'Need ?a=agencyId&c=clientId'}),{status:400,headers:CORS});
  }

  try {
    const token = await getToken();

    // Check all the paths
    const [clientDoc, billingDoc, paymentsDoc] = await Promise.all([
      fsRaw(token, `agencies/${agencyId}/clients/${clientId}`),
      fsRaw(token, `agencies/${agencyId}/clients/${clientId}/billing/config`),
      fsRaw(token, `agencies/${agencyId}/clients/${clientId}/payments`),
    ]);

    // Extract showOnPortal raw value
    const showOnPortalRaw = billingDoc?.fields?.showOnPortal;

    return new Response(JSON.stringify({
      clientExists: !!clientDoc?.fields,
      billingDocExists: !!billingDoc?.fields,
      billingDocError: billingDoc?.error || null,
      showOnPortalRaw,  // exact raw Firestore value
      showOnPortalType: showOnPortalRaw ? Object.keys(showOnPortalRaw)[0] : 'missing',
      showOnPortalValue: showOnPortalRaw ? Object.values(showOnPortalRaw)[0] : null,
      paymentsCount: (paymentsDoc?.documents||[]).length,
      billingFields: billingDoc?.fields ? Object.fromEntries(
        Object.entries(billingDoc.fields).map(([k,v]) => [k, Object.keys(v)[0] + ':' + Object.values(v)[0]])
      ) : null,
    }, null, 2), {status:200,headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/debug-billing' };
