// netlify/functions/agency-billing.js
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-agency-token',
  'Content-Type': 'application/json',
};

// ── FIREBASE ──────────────────────────────────────────────────
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
  if ('booleanValue' in v) return v.booleanValue;   // ← critical: must return actual bool
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

// ── NEXT DUE DATE ─────────────────────────────────────────────
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

  // Simply add one cycle to the base date — no looping
  const next = new Date(base);
  if (cycle.months) next.setMonth(next.getMonth() + cycle.months);
  else next.setDate(next.getDate() + cycle.days);

  return next.toISOString().slice(0, 10);
}

// ── HANDLER ───────────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('',{status:200,headers:CORS});

  const agencyToken = req.headers.get('x-agency-token') || '';
  const agencyId    = await verifySession(agencyToken);
  if (!agencyId) return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});

  const url      = new URL(req.url);
  const action   = url.searchParams.get('action') || '';
  const clientId = url.searchParams.get('clientId') || '';

  if (!clientId) return new Response(JSON.stringify({error:'clientId required'}),{status:400,headers:CORS});

  const billingPath  = `agencies/${agencyId}/clients/${clientId}/billing/config`;
  const paymentsPath = `agencies/${agencyId}/clients/${clientId}/payments`;

  // ── GET ───────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const [config, payments] = await Promise.all([
        fsGet(billingPath),
        fsListPayments(agencyId, clientId),
      ]);
      payments.sort((a,b) => new Date(b.dueDate||0) - new Date(a.dueDate||0));
      return new Response(JSON.stringify({success:true, config: config||null, payments}),{status:200,headers:CORS});
    } catch(e) {
      console.error('[agency-billing GET]', e.message);
      return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
    }
  }

  // ── POST ──────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

    // SAVE CONFIG
    if (action === 'save-config') {
      const {
        planType, contractTerm, billingCycle,
        setupFee, setupFeePaid,
        recurringAmount, currency,
        startDate, renewalDate, autoRenew,
        bonus, bonusDetail, bonusDuration,
        paymentLink, notes, showOnPortal,
      } = body;

      const nextDue = renewalDate || calcNextDue(startDate, billingCycle, null);

      const config = {
        planType:        planType || '',
        contractTerm:    contractTerm || 'monthly',
        billingCycle:    billingCycle || 'monthly',
        setupFee:        parseFloat(setupFee) || 0,
        setupFeePaid:    setupFeePaid === true || setupFeePaid === 'true',
        recurringAmount: parseFloat(recurringAmount) || 0,
        currency:        currency || 'USD',
        startDate:       startDate || '',
        renewalDate:     nextDue || '',
        autoRenew:       autoRenew === true || autoRenew === 'true',
        bonus:           bonus || 'none',
        bonusDetail:     bonusDetail || '',
        bonusDuration:   bonusDuration || '',
        paymentLink:     paymentLink || '',
        notes:           notes || '',
        showOnPortal:    showOnPortal === true || showOnPortal === 'true',
        updatedAt:       new Date().toISOString(),
      };

      await fsSet(billingPath, config);

      // Auto-create first payment if none exist and there's a recurring amount
      if (nextDue && parseFloat(recurringAmount||0) > 0) {
        const existing = await fsListPayments(agencyId, clientId);
        if (!existing.length) {
          const payId = 'pay-' + Date.now().toString(36);
          const cycleLabels = {monthly:'First Monthly Payment',quarterly:'First Quarterly Payment',biannual:'First Semi-Annual Payment',annual:'First Annual Payment',weekly:'First Weekly Payment',biweekly:'First Bi-Weekly Payment','one-time':'One-Time Payment'};
          await fsSet(`${paymentsPath}/${payId}`, {
            amount:    parseFloat(recurringAmount),
            currency:  currency || 'USD',
            dueDate:   nextDue,
            status:    'pending',
            label:     cycleLabels[billingCycle] || 'Payment',
            paidAt:    '',
            createdAt: new Date().toISOString(),
          });
        }
      }

      return new Response(JSON.stringify({success:true, config}),{status:200,headers:CORS});
    }

    // MARK PAID — also auto-generates next cycle
    if (action === 'mark-paid') {
      const { paymentId } = body;
      if (!paymentId) return new Response(JSON.stringify({error:'paymentId required'}),{status:400,headers:CORS});

      const payPath = `${paymentsPath}/${paymentId}`;
      const pay = await fsGet(payPath);
      if (!pay) return new Response(JSON.stringify({error:'Payment not found'}),{status:404,headers:CORS});

      await fsSet(payPath, { ...pay, status:'paid', paidAt: new Date().toISOString() });

      // Auto-generate next payment
      const config = await fsGet(billingPath);
      if (config && config.billingCycle && config.billingCycle !== 'one-time' && config.recurringAmount > 0) {
        const nextDue = calcNextDue(config.startDate, config.billingCycle, pay.dueDate);
        if (nextDue) {
          const nextId = 'pay-' + Date.now().toString(36);
          const labels = {monthly:'Monthly Payment',quarterly:'Quarterly Payment',biannual:'Semi-Annual Payment',annual:'Annual Payment',weekly:'Weekly Payment',biweekly:'Bi-Weekly Payment'};
          await fsSet(`${paymentsPath}/${nextId}`, {
            amount:    config.recurringAmount,
            currency:  config.currency || 'USD',
            dueDate:   nextDue,
            status:    'pending',
            label:     labels[config.billingCycle] || 'Payment',
            paidAt:    '',
            createdAt: new Date().toISOString(),
          });
          await fsSet(billingPath, { ...config, renewalDate: nextDue, updatedAt: new Date().toISOString() });
        }
      }
      return new Response(JSON.stringify({success:true}),{status:200,headers:CORS});
    }

    // UPDATE STATUS
    if (action === 'update-status') {
      const { paymentId, status } = body;
      if (!paymentId || !['pending','paid','late','cancelled','waived'].includes(status)) {
        return new Response(JSON.stringify({error:'Invalid paymentId or status'}),{status:400,headers:CORS});
      }
      const payPath = `${paymentsPath}/${paymentId}`;
      const pay = await fsGet(payPath);
      if (!pay) return new Response(JSON.stringify({error:'Payment not found'}),{status:404,headers:CORS});
      await fsSet(payPath, { ...pay, status, paidAt: status==='paid' ? new Date().toISOString() : (pay.paidAt||'') });
      return new Response(JSON.stringify({success:true}),{status:200,headers:CORS});
    }

    // ADD MANUAL PAYMENT
    if (action === 'add-payment') {
      const { amount, currency, dueDate, label, status } = body;
      if (!amount || !dueDate) return new Response(JSON.stringify({error:'amount and dueDate required'}),{status:400,headers:CORS});
      const payId = 'pay-' + Date.now().toString(36);
      await fsSet(`${paymentsPath}/${payId}`, {
        amount:    parseFloat(amount),
        currency:  currency || 'USD',
        dueDate,
        label:     label || 'Payment',
        status:    status || 'pending',
        paidAt:    status === 'paid' ? new Date().toISOString() : '',
        createdAt: new Date().toISOString(),
      });
      return new Response(JSON.stringify({success:true, paymentId:payId}),{status:200,headers:CORS});
    }

    // DELETE PAYMENT
    if (action === 'delete-payment') {
      const { paymentId } = body;
      if (!paymentId) return new Response(JSON.stringify({error:'paymentId required'}),{status:400,headers:CORS});
      await fsDelete(`${paymentsPath}/${paymentId}`);
      return new Response(JSON.stringify({success:true}),{status:200,headers:CORS});
    }

    return new Response(JSON.stringify({error:'Unknown action'}),{status:400,headers:CORS});
  }

  return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:CORS});
};

export const config = { path: '/api/agency/billing' };
