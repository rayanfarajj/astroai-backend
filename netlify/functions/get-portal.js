// netlify/functions/get-portal.js
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
      res.on('end',()=>{const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error('No token'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function fsGet(token, docPath) {
  return new Promise((resolve,reject)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/${docPath}`,method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); r.end();
  });
}

function fsList(token, collPath) {
  return new Promise((resolve)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/${collPath}?pageSize=100`,method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({})}});
    });
    r.on('error',()=>resolve({})); r.end();
  });
}

function fromFS(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return String(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  return null;
}

function extractFields(doc) {
  if (!doc || !doc.fields) return null;
  const o = {};
  for (const [k,v] of Object.entries(doc.fields)) o[k] = fromFS(v);
  o.id = (doc.name||'').split('/').pop();
  return o;
}

function extractClient(fields, slug) {
  const get = k => fields[k]?.stringValue || fields[k]?.integerValue || '';
  return {
    id:            slug,
    businessName:  get('businessName'),
    clientName:    get('clientName'),
    clientEmail:   get('clientEmail'),
    phone:         get('phone'),
    industry:      get('industry'),
    adPlatforms:   get('adPlatforms'),
    adBudget:      get('adBudget'),
    goal90:        get('goal90'),
    status:        get('status') || 'new',
    statusLabel:   get('statusLabel') || '🆕 New',
    statusUpdated: get('statusUpdated'),
    notes:         get('notes'),
    dashboardUrl:  get('dashboardUrl'),
    authPdfUrl:    get('authPdfUrl'),
    referralCount: get('referralCount') || '0',
    createdAt:     get('createdAt'),
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('',{status:200,headers:CORS});

  const url      = new URL(req.url);
  const slug     = url.searchParams.get('slug') || url.searchParams.get('s') || '';
  const agencyId = url.searchParams.get('a') || '';

  if (!slug) return new Response(JSON.stringify({error:'slug required'}),{status:400,headers:CORS});

  try {
    const token = await getFirebaseToken();
    let clientDoc = null;

    // 1. Try agency subcollection first
    if (agencyId) {
      try {
        const doc = await fsGet(token, `agencies/${agencyId}/clients/${slug}`);
        if (doc.fields) clientDoc = doc;
      } catch(e) {}
    }

    // 2. Fall back to root clients collection
    if (!clientDoc) {
      try {
        const doc = await fsGet(token, `clients/${slug}`);
        if (doc.fields) clientDoc = doc;
      } catch(e) {}
    }

    if (!clientDoc) {
      return new Response(JSON.stringify({error:'Client not found'}),{status:404,headers:CORS});
    }

    const client = extractClient(clientDoc.fields, slug);

    // ── OFFER ────────────────────────────────────────────────
    let offer = null;
    const offerField = clientDoc.fields.offer?.stringValue || '';
    if (offerField) {
      try {
        const p = JSON.parse(offerField);
        if (p && p.title && p.ctaUrl) {
          offer = { title:p.title, description:p.description||'', ctaText:p.ctaText||'Claim Offer', ctaUrl:p.ctaUrl, expiresAt:p.expiresAt||'' };
        }
      } catch(e) {}
    }
    if (!offer) {
      const paths = agencyId
        ? [`agencies/${agencyId}/offers/${slug}`, `offers/${slug}`, `offers/global`]
        : [`offers/${slug}`, `offers/global`];
      for (const p of paths) {
        try {
          const doc = await fsGet(token, p);
          if (doc.fields && doc.fields.active?.booleanValue !== false) {
            const f = doc.fields;
            offer = { title:f.title?.stringValue||'', description:f.description?.stringValue||'', ctaText:f.ctaText?.stringValue||'Claim Offer', ctaUrl:f.ctaUrl?.stringValue||'', expiresAt:f.expiresAt?.stringValue||'' };
            break;
          }
        } catch(e) {}
      }
    }

    // ── BILLING ──────────────────────────────────────────────
    let billing = null;
    if (agencyId && slug) {
      try {
        const billingDoc = await fsGet(token, `agencies/${agencyId}/clients/${slug}/billing/config`);
        if (billingDoc && billingDoc.fields) {
          const cfg = extractFields(billingDoc);
          if (cfg && cfg.showOnPortal) {
            const paymentsResp = await fsList(token, `agencies/${agencyId}/clients/${slug}/payments`);
            const payments = (paymentsResp.documents||[])
              .map(doc => extractFields(doc))
              .filter(Boolean)
              .sort((a,b) => new Date(b.dueDate||0) - new Date(a.dueDate||0));
            billing = { ...cfg, payments };
          }
        }
      } catch(e) {
        console.log('[get-portal] billing error:', e.message);
      }
    }

    return new Response(JSON.stringify({client, offer, billing}),{status:200,headers:CORS});

  } catch(e) {
    console.error('[get-portal]', e.message);
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/get-portal' };
