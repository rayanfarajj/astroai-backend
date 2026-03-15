// netlify/functions/hl-webhook.js
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function getFirebaseToken() {
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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No token'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function toFS(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean') return {booleanValue:v};
  if (typeof v==='number') return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if (typeof v==='string') return {stringValue:v};
  return {stringValue:String(v)};
}

async function fsSet(collection, docId, data) {
  const t = await getFirebaseToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  const s = JSON.stringify({fields});
  return new Promise((resolve,reject)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/${collection}/${docId}`,method:'PATCH',headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json','Content-Length':Buffer.byteLength(s)}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){resolve({})} });
    });
    r.on('error',reject); r.write(s); r.end();
  });
}

async function getCPL() {
  const t = await getFirebaseToken();
  return new Promise((resolve)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/platform_config/fb_cpl`,method:'GET',headers:{'Authorization':'Bearer '+t}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const doc = JSON.parse(d);
          const price = doc.fields?.suggestedPrice?.integerValue || doc.fields?.suggestedPrice?.doubleValue || 37;
          resolve(Number(price));
        } catch(e) { resolve(37); }
      });
    });
    r.on('error',()=>resolve(37)); r.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', {status:200,headers:CORS});
  if (req.method !== 'POST') return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  console.log('[hl-webhook] Payload keys:', Object.keys(body));

  // Extract contact info — HL sends different formats
  const contact = body.contact || body.data?.contact || body;
  const firstName   = body.firstName   || contact.firstName   || contact.first_name  || '';
  const lastName    = body.lastName    || contact.lastName    || contact.last_name   || '';
  const email       = body.email       || contact.email       || '';
  const phone       = body.phone       || contact.phone       || '';
  const companyName = body.companyName || contact.companyName || contact.company_name || `${firstName} ${lastName}`.trim() || 'Unknown Business';
  const city        = body.city        || contact.city        || '';
  const state       = body.state       || contact.state       || '';
  const location    = [city, state].filter(Boolean).join(', ') || 'Location not provided';
  const service     = body.service     || contact.service     || 'Marketing Agency Services';

  if (!firstName && !companyName && !email) {
    console.log('[hl-webhook] No contact data found in payload');
    return new Response(JSON.stringify({error:'No contact data'}),{status:400,headers:CORS});
  }

  // Get current FB CPL price (falls back to $37 if not set)
  const suggestedPrice = await getCPL();

  // Build unique lead ID
  const slug   = companyName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
  const leadId = `${slug}-hl-${Date.now().toString(36)}`;

  // Save as pending in Firestore
  const leadData = {
    businessName: companyName,
    contactName:  `${firstName} ${lastName}`.trim() || companyName,
    phone, email, location, service,
    industry: body.industry || contact.industry || '',
    notes:    body.notes    || contact.notes    || '',
    price:    suggestedPrice,
    status:   'pending',
    claimedBy: '', claimedAt: '', claimedByName: '',
    source:   'highlevel',
    createdAt: new Date().toISOString(),
  };

  await fsSet('lead_pool', leadId, leadData);
  console.log('[hl-webhook] Lead saved:', leadId, 'price: $' + suggestedPrice);

  return new Response(
    JSON.stringify({success:true, leadId, price:suggestedPrice, message:'Lead saved as pending — check admin dashboard to approve'}),
    {status:200, headers:CORS}
  );
};

export const config = { path: '/api/hl-webhook' };
