// netlify/functions/get-portal.js
// Returns client record + their offer (global or per-client) for the client portal

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
    const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const crypto = require('crypto');
    function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }
    const now = Math.floor(Date.now() / 1000);
    const hdr = b64u(JSON.stringify({ alg:'RS256', typ:'JWT' }));
    const pay = b64u(JSON.stringify({ iss:clientEmail, sub:clientEmail, aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/datastore' }));
    const sig = b64u(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(privateKey));
    const jwt = hdr+'.'+pay+'.'+sig;
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request({ hostname:'oauth2.googleapis.com', path:'/token', method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error('No token: '+d)); });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function firestoreGet(token, docPath) {
  return new Promise((resolve, reject) => {
    const proj = process.env.FIREBASE_PROJECT_ID;
    const path = `/v1/projects/${proj}/databases/(default)/documents/${docPath}`;
    const req = https.request({ hostname:'firestore.googleapis.com', path, method:'GET', headers:{'Authorization':'Bearer '+token} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)} });
    });
    req.on('error',reject); req.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return new Response(JSON.stringify({ error: 'slug required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const token = await getFirebaseToken();

    // Get client record
    const clientDoc = await firestoreGet(token, `clients/${slug}`);
    if (!clientDoc.fields) return new Response(JSON.stringify({ error: 'Client not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const f   = clientDoc.fields;
    const get = (k) => f[k]?.stringValue || f[k]?.integerValue || '';

    const client = {
      id:              slug,
      businessName:    get('businessName'),
      clientName:      get('clientName'),
      clientEmail:     get('clientEmail'),
      industry:        get('industry'),
      adPlatforms:     get('adPlatforms'),
      adBudget:        get('adBudget'),
      goal90:          get('goal90'),
      status:          get('status') || 'new',
      statusLabel:     get('statusLabel') || '🆕 New',
      statusUpdated:   get('statusUpdated'),
      notes:           get('notes'),
      dashboardUrl:    get('dashboardUrl'),
      authPdfUrl:      get('authPdfUrl'),
      referralCount:   get('referralCount') || '0',
      createdAt:       get('createdAt'),
    };

    // Get offer — check per-client first, fall back to global
    let offer = null;
    try {
      const clientOffer = await firestoreGet(token, `offers/${slug}`);
      if (clientOffer.fields && clientOffer.fields.active?.booleanValue !== false) {
        const of = clientOffer.fields;
        offer = {
          title:       of.title?.stringValue || '',
          description: of.description?.stringValue || '',
          ctaText:     of.ctaText?.stringValue || 'Claim Offer',
          ctaUrl:      of.ctaUrl?.stringValue || '',
          expiresAt:   of.expiresAt?.stringValue || '',
        };
      }
    } catch {}

    if (!offer) {
      try {
        const globalOffer = await firestoreGet(token, 'offers/global');
        if (globalOffer.fields && globalOffer.fields.active?.booleanValue !== false) {
          const of = globalOffer.fields;
          offer = {
            title:       of.title?.stringValue || '',
            description: of.description?.stringValue || '',
            ctaText:     of.ctaText?.stringValue || 'Claim Offer',
            ctaUrl:      of.ctaUrl?.stringValue || '',
            expiresAt:   of.expiresAt?.stringValue || '',
          };
        }
      } catch {}
    }

    return new Response(JSON.stringify({ client, offer }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });

  } catch(e) {
    console.error('[get-portal] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
};

export const config = {
  path: '/api/get-portal',
};
