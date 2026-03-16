// netlify/functions/agency-services.js
// CRUD for additional services on a client
// Firestore: agencies/{agencyId}/clients/{clientId}/services/{serviceId}
// Auth: same session-token pattern as agency-billing.js
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-agency-token',
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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No token'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Properly decode ALL Firestore field types including booleans
function fromFS(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;   //  critical: must return actual bool
  if ('nullValue'    in v) return null;
  if ('arrayValue'   in v) return (v.arrayValue.values||[]).map(fromFS);
  if ('mapValue'     in v) {
    const o = {};
    for (const [k,val] of Object.entries(v.mapValue.fields||{})) o[k] = fromFS(val);
    return o;
  }
  return null;
}

function toFS(v) {
  if (v === null || v === undefined) return {nullValue: null};
  if (typeof v === 'boolean')        return {booleanValue: v};
  if (typeof v === 'number')         return Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v};
  if (typeof v === 'string')         return {stringValue: v};
  if (Array.isArray(v))              return {arrayValue: {values: v.map(toFS)}};
  if (typeof v === 'object')         return {mapValue: {fields: Object.fromEntries(Object.entries(v).map(([k,val])=>[k,toFS(val)]))}};
  return {stringValue: String(v)};
}

function fsHttp(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s = body ? JSON.stringify(body) : null;
    const r = https.request({
      hostname:'firestore.googleapis.com', path, method,
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); if(s) r.write(s); r.end();
  });
}

function extractDoc(doc) {
  if (!doc || !doc.fields) return null;
  const o = {};
  for (const [k,v] of Object.entries(doc.fields)) o[k] = fromFS(v);
  o.id = (doc.name||'').split('/').pop();
  return o;
}

async function fsGet(path) {
  const t = await getToken();
  const r = await fsHttp('GET', `${BASE()}/${path}`, null, t);
  if (r.error || !r.fields) return null;
  return extractDoc(r);
}

async function fsSet(path, data) {
  const t = await getToken();
  // Remove internal id before saving
  const { id, _id, ...clean } = data;
  const fields = Object.fromEntries(Object.entries(clean).map(([k,v])=>[k,toFS(v)]));
  return fsHttp('PATCH', `${BASE()}/${path}`, {fields}, t);
}

// Use Firestore runQuery to list subcollection docs (works for deep paths)
async function fsListPayments(agencyId, clientId) {
  const t = await getToken();
  const projectId = process.env.FIREBASE_PROJECT_ID;
  // Use collection group query via structuredQuery
  const queryBody = {
    structuredQuery: {
      from: [{collectionId: 'payments'}],
      where: {
        fieldFilter: {
          field: {fieldPath: '__name__'},
          op: 'GREATER_THAN_OR_EQUAL',
          value: {referenceValue: `projects/${projectId}/databases/(default)/documents/agencies/${agencyId}/clients/${clientId}/payments/a`}
        }
      },
      limit: 100
    }
  };

  // Actually simpler: just do a direct GET on the subcollection
  return new Promise((resolve) => {
    const path = `${BASE()}/agencies/${agencyId}/clients/${clientId}/payments?pageSize=100`;
    const r = https.request({hostname:'firestore.googleapis.com',path,method:'GET',headers:{'Authorization':'Bearer '+t}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const parsed = JSON.parse(d);
          const docs = (parsed.documents||[]).map(extractDoc).filter(Boolean);
          resolve(docs);
        } catch(e) { resolve([]); }
      });
    });
    r.on('error',()=>resolve([])); r.end();
  });
}

async function fsDelete(path) {
  const t = await getToken();
  return new Promise((resolve,reject)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/${path}`,method:'DELETE',headers:{'Authorization':'Bearer '+t}},res=>{res.resume();res.on('end',resolve);});
    r.on('error',reject); r.end();
  });
}

async function verifySession(sessionToken) {
  const doc = await fsGet(`agency_sessions/${sessionToken}`);
  if (!doc) return null;
  if (new Date(doc.expiresAt||0) < new Date()) return null;
  return doc.agencyId || null;
}

//  NEXT DUE DATE 
function calcNextDue(startDate, billingCycle, lastPaidDate) {
  // Use lastPaidDate if provided, otherwise startDate
  const base = new Date((lastPaidDate || startDate) + 'T12:00:00');
  if (isNaN(base)) return null;

  const cycleMap = {
    monthly:    { months: 1  },
    quarterly:  { months: 3  },
    biannual:   { months: 6  },
    annual:     { months: 12 },
    weekly:     { days: 7    },
    biweekly:   { days: 14   },
    'one-time': null,
  };
  const cycle = cycleMap[billingCycle];
  if (!cycle) return null;

  // Simply add one cycle to the base date  no looping
  const next = new Date(base);
  if (cycle.months) next.setMonth(next.getMonth() + cycle.months);
  else next.setDate(next.getDate() + cycle.days);

  return next.toISOString().slice(0, 10);
}

//  HANDLER 

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const agencyToken = req.headers.get('x-agency-token') || '';
  const agencyId    = await verifySession(agencyToken);
  if (!agencyId) return new Response(JSON.stringify({error:'Unauthorized'}), {status:401, headers:CORS});

  const url      = new URL(req.url);
  const clientId = url.searchParams.get('clientId') || '';
  if (!clientId) {
    return new Response(JSON.stringify({error:'clientId required'}), {status:400, headers:CORS});
  }

  const COL = `agencies/${agencyId}/clients/${clientId}/services`;

  try {
    const token = await getToken();

    // GET: list services
    if (req.method === 'GET') {
      const data = await fsHttp('GET', `${BASE()}/${COL}?pageSize=100`, null, token);
      const docs = (data.documents || []).map(doc => {
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
      return new Response(JSON.stringify({success:true, services:docs}), {status:200, headers:CORS});
    }

    // POST: save or delete
    if (req.method === 'POST') {
      const body   = await req.json();
      const action = body.action || 'save';

      if (action === 'delete') {
        const id = body.serviceId;
        if (!id) return new Response(JSON.stringify({error:'serviceId required'}), {status:400, headers:CORS});
        await fsHttp('DELETE', `${BASE()}/${COL}/${id}`, null, token);
        return new Response(JSON.stringify({success:true}), {status:200, headers:CORS});
      }

      const serviceId = body.serviceId || ('svc-' + Date.now() + '-' + Math.random().toString(36).slice(2,7));
      const doc = {
        fields: {
          headline:      {stringValue: body.headline      || ''},
          description:   {stringValue: body.description   || ''},
          amount:        {stringValue: body.amount        || ''},
          paymentStatus: {stringValue: body.paymentStatus || 'pending'},
          orderDate:     {stringValue: body.orderDate     || new Date().toISOString().slice(0,10)},
          orderStatus:   {stringValue: body.orderStatus   || 'pending'},
          createdAt:     {stringValue: body.createdAt     || new Date().toISOString()},
        }
      };
      await fsHttp('PATCH', `${BASE()}/${COL}/${serviceId}`, doc, token);
      return new Response(JSON.stringify({success:true, serviceId}), {status:200, headers:CORS});
    }

    return new Response(JSON.stringify({error:'Method not allowed'}), {status:405, headers:CORS});

  } catch(e) {
    console.error('[agency-services]', e.message);
    return new Response(JSON.stringify({error:e.message}), {status:500, headers:CORS});
  }
};

export const config = { path: '/api/agency/services' };
