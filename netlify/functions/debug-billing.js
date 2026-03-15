// netlify/functions/debug-billing.js
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
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

function fsRaw(token, docPath) {
  return new Promise((resolve) => {
    const r = https.request({
      hostname: 'firestore.googleapis.com',
      path: `${BASE()}/${docPath}`,
      method: 'GET',
      headers: {'Authorization': 'Bearer ' + token}
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({parseError: e.message, raw: d.slice(0,200)}); }});
    });
    r.on('error', e => resolve({error: e.message}));
    r.end();
  });
}

export default async (req) => {
  const reqUrl = new URL(req.url);
  const key    = reqUrl.searchParams.get('key') || '';
  const agencyId = reqUrl.searchParams.get('a') || '';
  const clientId = reqUrl.searchParams.get('c') || '';

  if (key !== 'AstroAdmin2024!') {
    return new Response(JSON.stringify({error:'Unauthorized'}), {status:401, headers:CORS});
  }
  if (!agencyId || !clientId) {
    return new Response(JSON.stringify({error:'Need ?a=agencyId&c=clientId&key=AstroAdmin2024!'}), {status:400, headers:CORS});
  }

  try {
    const token = await getToken();

    const billingPath  = `agencies/${agencyId}/clients/${clientId}/billing/config`;
    const paymentsPath = `agencies/${agencyId}/clients/${clientId}/payments`;

    const [billingDoc, paymentsDoc, agencyDoc, clientDoc] = await Promise.all([
      fsRaw(token, billingPath),
      fsRaw(token, paymentsPath),
      fsRaw(token, `agencies/${agencyId}`),
      fsRaw(token, `agencies/${agencyId}/clients/${clientId}`),
    ]);

    const showOnPortalRaw = billingDoc?.fields?.showOnPortal;
    const refBonusRaw = agencyDoc?.fields?.referralBonus;
    const refCountRaw = clientDoc?.fields?.referralCount;

    return new Response(JSON.stringify({
      billingDocFound:    !!billingDoc?.fields,
      showOnPortalRaw,
      showOnPortalType:   showOnPortalRaw ? Object.keys(showOnPortalRaw)[0] : 'MISSING',
      showOnPortalValue:  showOnPortalRaw ? Object.values(showOnPortalRaw)[0] : null,
      allBillingFields:   billingDoc?.fields ? Object.fromEntries(
        Object.entries(billingDoc.fields).map(([k,v]) => [k, JSON.stringify(v)])
      ) : 'NO FIELDS',
      paymentsFound: (paymentsDoc?.documents||[]).length,
      agencyDocFound: !!agencyDoc?.fields,
      agencyFieldKeys: agencyDoc?.fields ? Object.keys(agencyDoc.fields) : [],
      referralBonusRaw: refBonusRaw || 'MISSING',
      referralBonusType: refBonusRaw ? Object.keys(refBonusRaw)[0] : 'MISSING',
      referralBonusValue: refBonusRaw ? Object.values(refBonusRaw)[0] : null,
      clientReferralCountRaw: refCountRaw || 'MISSING',
      clientReferralCountType: refCountRaw ? Object.keys(refCountRaw)[0] : 'MISSING',
      clientReferralCountValue: refCountRaw ? Object.values(refCountRaw)[0] : null,
    }, null, 2), {status:200, headers:CORS});

  } catch(e) {
    return new Response(JSON.stringify({error: e.message, stack: e.stack?.slice(0,300)}), {status:500, headers:CORS});
  }
};

export const config = { path: '/api/debug-billing' };
