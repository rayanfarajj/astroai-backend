// netlify/functions/get-portal.js
const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function getFirebaseToken() {
  return new Promise((resolve, reject) => {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
    const crypto = require('crypto');
    const b64u = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now = Math.floor(Date.now()/1000);
    const hdr = b64u(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const pay = b64u(JSON.stringify({iss:clientEmail,sub:clientEmail,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const sig = b64u(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(privateKey));
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`;
    const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No token'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function firestoreGet(token, docPath) {
  return new Promise((resolve,reject)=>{
    const proj = process.env.FIREBASE_PROJECT_ID;
    const path = `/v1/projects/${proj}/databases/(default)/documents/${docPath}`;
    const req = https.request({hostname:'firestore.googleapis.com',path,method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    req.on('error',reject); req.end();
  });
}

function extractClient(f, slug) {
  const get = k => f[k]?.stringValue || f[k]?.integerValue || '';
  return {
    id:            slug,
    businessName:  get('businessName'),
    clientName:    get('clientName'),
    clientEmail:   get('clientEmail'),
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
  if (req.method === 'OPTIONS') return new Response('', {status:200,headers:CORS});

  const url      = new URL(req.url);
  const slug     = url.searchParams.get('slug') || url.searchParams.get('s') || '';
  const agencyId = url.searchParams.get('a') || '';

  if (!slug) return new Response(JSON.stringify({error:'slug required'}),{status:400,headers:CORS});

  try {
    const token = await getFirebaseToken();
    let clientDoc = null;

    // 1. If agencyId provided, look in agency subcollection first
    if (agencyId) {
      try {
        const doc = await firestoreGet(token, `agencies/${agencyId}/clients/${slug}`);
        if (doc.fields) clientDoc = doc;
      } catch(e) {}
    }

    // 2. Fall back to original /clients/ collection
    if (!clientDoc) {
      try {
        const doc = await firestoreGet(token, `clients/${slug}`);
        if (doc.fields) clientDoc = doc;
      } catch(e) {}
    }

    if (!clientDoc) {
      return new Response(JSON.stringify({error:'Client not found'}),{status:404,headers:CORS});
    }

    const client = extractClient(clientDoc.fields, slug);

    // Get offer — first check client record's offer field (SaaS agencies store it there)
    let offer = null;
    const offerField = clientDoc.fields.offer?.stringValue || '';
    if (offerField) {
      try {
        const parsed = JSON.parse(offerField);
        if (parsed && parsed.title && parsed.ctaUrl) {
          offer = {
            title:       parsed.title || '',
            description: parsed.description || '',
            ctaText:     parsed.ctaText || 'Claim Offer',
            ctaUrl:      parsed.ctaUrl || '',
            expiresAt:   parsed.expiresAt || '',
          };
        }
      } catch(e) {}
    }

    // Fall back to separate offers collection
    if (!offer) {
      const offerPaths = agencyId
        ? [`agencies/${agencyId}/offers/${slug}`, `offers/${slug}`, `offers/global`]
        : [`offers/${slug}`, `offers/global`];

      for (const p of offerPaths) {
        try {
          const doc = await firestoreGet(token, p);
          if (doc.fields && doc.fields.active?.booleanValue !== false) {
            const of = doc.fields;
            offer = {
              title:       of.title?.stringValue||'',
              description: of.description?.stringValue||'',
              ctaText:     of.ctaText?.stringValue||'Claim Offer',
              ctaUrl:      of.ctaUrl?.stringValue||'',
              expiresAt:   of.expiresAt?.stringValue||'',
            };
            break;
          }
        } catch(e) {}
      }
    }

    // Get billing config + payments from subcollection (if agency client)
    let billing = null;
    if (agencyId && slug) {
      try {
        const billingDoc = await firestoreGet(token, `agencies/${agencyId}/clients/${slug}/billing/config`);
        if (billingDoc && billingDoc.fields) {
          const cfg = extractClient(billingDoc.fields, 'config');
          if (cfg && cfg.showOnPortal) {
            // Also fetch payments
            const paymentsResp = await new Promise((resolve,reject)=>{
              const r=require('https').request({hostname:'firestore.googleapis.com',path:`/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/agencies/${agencyId}/clients/${slug}/payments?pageSize=50`,method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({})}});});r.on('error',()=>resolve({}));r.end();
            });
            const payments = (paymentsResp.documents||[]).map(doc=>{
              const o={};for(const[k,v]of Object.entries(doc.fields||{}))o[k]=v.stringValue??v.integerValue??v.doubleValue??v.booleanValue??null;
              o.id=(doc.name||'').split('/').pop();return o;
            }).sort((a,b)=>new Date(b.dueDate||0)-new Date(a.dueDate||0));
            billing = { ...cfg, payments };
          }
        }
      } catch(e) { console.log('[get-portal] billing fetch error:', e.message); }
    }

    return new Response(JSON.stringify({client, offer, billing}),{status:200,headers:CORS});

  } catch(e) {
    console.error('[get-portal]',e.message);
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/get-portal' };
