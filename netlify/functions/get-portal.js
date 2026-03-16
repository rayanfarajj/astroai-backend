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

function fsListPayments(token, agencyId, slug) {
  return new Promise((resolve)=>{
    const path = `${BASE()}/agencies/${agencyId}/clients/${slug}/payments?pageSize=100`;
    const r = https.request({hostname:'firestore.googleapis.com',path,method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({})}});
    });
    r.on('error',()=>resolve({})); r.end();
  });
}

function fsListServices(token, agencyId, slug) {
  return new Promise((resolve) => {
    const path = `${BASE()}/agencies/${agencyId}/clients/${slug}/services?pageSize=100`;
    const r = https.request({hostname:'firestore.googleapis.com',path,method:'GET',headers:{'Authorization':'Bearer '+token}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({})}});
    });
    r.on('error',()=>resolve({})); r.end();
  });
}

function fromFS(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  if ('arrayValue'   in v) return (v.arrayValue.values||[]).map(fromFS);
  if ('mapValue'     in v) {
    const o = {};
    for (const [k,val] of Object.entries(v.mapValue.fields||{})) o[k] = fromFS(val);
    return o;
  }
  return null;
}

function extractAllFields(doc) {
  if (!doc || !doc.fields) return null;
  const o = {};
  for (const [k,v] of Object.entries(doc.fields)) o[k] = fromFS(v);
  o.id = (doc.name||'').split('/').pop();
  return o;
}

function extractClient(fields, slug) {
  const str = k => fields[k]?.stringValue || '';
  return {
    id:            slug,
    businessName:  str('businessName'),
    clientName:    str('clientName'),
    clientEmail:   str('clientEmail'),
    phone:         str('phone'),
    industry:      str('industry'),
    adPlatforms:   str('adPlatforms'),
    adBudget:      str('adBudget'),
    goal90:        str('goal90'),
    status:        str('status') || 'new',
    statusLabel:   str('statusLabel') || 'New New',
    statusUpdated: str('statusUpdated'),
    notes:         str('notes'),
    dashboardUrl:  str('dashboardUrl'),
    authPdfUrl:    str('authPdfUrl'),
    referralCount: String(fields['referralCount']?.integerValue || fields['referralCount']?.stringValue || '0'),
    createdAt:     str('createdAt'),
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

    //  OFFER 
    let offer = null;
    const offerRaw = clientDoc.fields.offer?.stringValue || '';
    if (offerRaw) {
      try {
        const p = JSON.parse(offerRaw);
        if (p?.title && p?.ctaUrl) {
          offer = { title:p.title, description:p.description||'', ctaText:p.ctaText||'Claim Offer', ctaUrl:p.ctaUrl, expiresAt:p.expiresAt||'' };
        }
      } catch(e) {}
    }
    if (!offer) {
      const offerPaths = agencyId
        ? [`agencies/${agencyId}/offers/${slug}`, `offers/${slug}`, `offers/global`]
        : [`offers/${slug}`, `offers/global`];
      for (const p of offerPaths) {
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

    //  BILLING 
    // Always return billing data if it exists -- no showOnPortal gate
    let billing = null;
    if (agencyId && slug) {
      try {
        const billingDoc = await fsGet(token, `agencies/${agencyId}/clients/${slug}/billing/config`);
        if (billingDoc && billingDoc.fields) {
          const cfg = extractAllFields(billingDoc);
          if (cfg) {
            const paymentsResp = await fsListPayments(token, agencyId, slug);
            const payments = (paymentsResp.documents||[])
              .map(doc => extractAllFields(doc))
              .filter(Boolean)
              .sort((a,b) => new Date(b.dueDate||0) - new Date(a.dueDate||0));
            billing = { ...cfg, payments };
          }
        }
      } catch(e) {
        console.log('[get-portal] billing error:', e.message);
      }
    }

    //  REFERRAL BONUS 
    // -- SERVICES
    if (agencyId && slug) {
      try {
        const svcResp = await fsListServices(token, agencyId, slug);
        console.log('[get-portal] svcResp keys:', Object.keys(svcResp||{}), 'docs:', (svcResp.documents||[]).length);
        services = (svcResp.documents || []).map(doc => {
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
        }).sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
      } catch(e) {
        console.log('[get-portal] services error:', e.message);
      }
    }

    let referralBonus = '';
    let referralResources = '';
    let metaBusinessId = '';
    let googleManagerId = '';
    let tiktokAgencyId = '';
    let linkedinAgencyId = '';
    let wordpressSiteUrl = '';
    let services = [];
    let bookingUrl = '';
    let supportPhone = '';
    let supportEmail = '';
    let agencyWebsite = '';
    let customLinks = '';
    if (agencyId) {
      try {
        const agencyDoc = await fsGet(token, `agencies/${agencyId}`);
        console.log('[get-portal] agency doc fields:', agencyDoc?.fields ? Object.keys(agencyDoc.fields) : 'NO FIELDS', 'error:', agencyDoc?.error);
        if (agencyDoc?.fields) {
          referralBonus     = agencyDoc.fields.referralBonus?.stringValue     || '';
          referralResources = agencyDoc.fields.referralResources?.stringValue || '';
          metaBusinessId    = agencyDoc.fields.metaBusinessId?.stringValue    || '';
          googleManagerId   = agencyDoc.fields.googleManagerId?.stringValue   || '';
          tiktokAgencyId    = agencyDoc.fields.tiktokAgencyId?.stringValue    || '';
          linkedinAgencyId  = agencyDoc.fields.linkedinAgencyId?.stringValue  || '';
          wordpressSiteUrl  = agencyDoc.fields.wordpressSiteUrl?.stringValue  || '';
          bookingUrl        = agencyDoc.fields.bookingUrl?.stringValue        || '';
          supportPhone      = agencyDoc.fields.supportPhone?.stringValue      || '';
          supportEmail      = agencyDoc.fields.supportEmail?.stringValue      || '';
          agencyWebsite     = agencyDoc.fields.agencyWebsite?.stringValue     || '';
          customLinks       = agencyDoc.fields.customLinks?.stringValue       || '';
          console.log('[get-portal] referralBonus:', referralBonus);
        }
      } catch(e) {
        console.log('[get-portal] agency fetch error:', e.message);
      }
    }

    return new Response(JSON.stringify({client, offer, billing, services, referralBonus, referralResources, metaBusinessId, googleManagerId, tiktokAgencyId, linkedinAgencyId, wordpressSiteUrl, bookingUrl, supportPhone, supportEmail, agencyWebsite, customLinks}),{status:200,headers:CORS});

  } catch(e) {
    console.error('[get-portal]', e.message);
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/get-portal' };
