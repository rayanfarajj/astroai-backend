// netlify/functions/agency-public.js
// GET /api/agency/public?id=agencyId — no auth required, returns public branding
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('Token failed'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function fsGet(path) {
  const t = await getToken();
  return new Promise((resolve,reject)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/${path}`,method:'GET',headers:{'Authorization':'Bearer '+t}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const doc = JSON.parse(d);
          if (!doc.fields) { resolve(null); return; }
          const o={};
          for(const[k,v] of Object.entries(doc.fields)){
            if('stringValue' in v) o[k]=v.stringValue;
            else if('integerValue' in v) o[k]=Number(v.integerValue);
            else if('booleanValue' in v) o[k]=v.booleanValue;
            else o[k]=null;
          }
          resolve(o);
        } catch(e){reject(e)}
      });
    });
    r.on('error',reject); r.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', {status:200, headers:CORS});
  if (req.method !== 'GET')    return new Response(JSON.stringify({error:'GET only'}), {status:405, headers:CORS});

  const agencyId = new URL(req.url).searchParams.get('id') || '';
  if (!agencyId) return new Response(JSON.stringify({error:'id required'}), {status:400, headers:CORS});

  try {
    const agency = await fsGet(`agencies/${agencyId}`);
    if (!agency) return new Response(JSON.stringify({error:'Agency not found'}), {status:404, headers:CORS});

    return new Response(JSON.stringify({
      agencyId,
      name:            agency.name,
      brandName:       agency.brandName       || agency.name,
      brandColor:      agency.brandColor       || '#00d9a3',
      brandLogo:       agency.brandLogo        || '',
      onboardingTitle: agency.onboardingTitle  || 'Get Your AI Marketing Plan',
      welcomeMsg:      agency.welcomeMsg       || '',
      termsText:       agency.termsText        || '',
      termsUrl:        agency.termsUrl         || '',
      privacyUrl:      agency.privacyUrl       || '',   // ← NEW
      bookingUrl:      agency.bookingUrl       || '',   // ← NEW (if set)
      supportEmail:    agency.supportEmail     || agency.email || '',
      webhookUrl:      '',   // never expose webhook to public
    }), {status:200, headers:CORS});

  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500, headers:CORS});
  }
};

export const config = { path: '/api/agency/public' };
