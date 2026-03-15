// netlify/functions/admin-backup.js
// Exports all Firestore data as a single JSON backup
// GET /api/admin/backup?key=AstroAdmin2024!
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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('Token failed'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const PROJ = () => process.env.FIREBASE_PROJECT_ID;

function fsGet(path, token) {
  return new Promise((resolve) => {
    const r = https.request({
      hostname:'firestore.googleapis.com',
      path:`/v1/projects/${PROJ()}/databases/(default)/documents/${path}`,
      method:'GET',
      headers:{'Authorization':'Bearer '+token}
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){resolve(null)} });
    });
    r.on('error',()=>resolve(null)); r.end();
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
  if ('mapValue'     in v) return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,val])=>[k,fromFS(val)]));
  return null;
}

function extractDoc(doc) {
  if (!doc?.fields) return null;
  const o = {};
  for (const [k,v] of Object.entries(doc.fields)) o[k] = fromFS(v);
  o._id = (doc.name||'').split('/').pop();
  return o;
}

async function listCollection(colPath, token) {
  const res = await fsGet(colPath, token);
  return (res?.documents || []).map(extractDoc).filter(Boolean);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const url = new URL(req.url);
  const key = url.searchParams.get('key') || req.headers.get('x-admin-key') || '';
  if (key !== 'AstroAdmin2024!') {
    return new Response(JSON.stringify({error:'Unauthorized'}), { status: 401, headers: CORS });
  }

  try {
    const token = await getToken();
    const backup = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      project: PROJ(),
      data: {}
    };

    // 1. Export all agencies
    console.log('[backup] Exporting agencies...');
    const agencies = await listCollection('agencies', token);
    backup.data.agencies = [];

    for (const agency of agencies) {
      const agencyId = agency._id;
      const agencyData = { ...agency, clients: [], referrals: [] };

      // 2. Export clients for each agency
      const clients = await listCollection(`agencies/${agencyId}/clients`, token);
      for (const client of clients) {
        const clientId = client._id;
        const clientData = { ...client, payments: [], billing: null };

        // 3. Export payments for each client
        const payments = await listCollection(`agencies/${agencyId}/clients/${clientId}/payments`, token);
        clientData.payments = payments;

        // 4. Export billing config
        const billingRes = await fsGet(`agencies/${agencyId}/clients/${clientId}/billing/config`, token);
        clientData.billing = billingRes ? extractDoc(billingRes) : null;

        agencyData.clients.push(clientData);
      }

      backup.data.agencies.push(agencyData);
    }

    // 5. Export referrals (root collection)
    console.log('[backup] Exporting referrals...');
    backup.data.referrals = await listCollection('referrals', token);

    // 6. Export lead pool
    console.log('[backup] Exporting lead pool...');
    backup.data.lead_pool = await listCollection('lead_pool', token);

    // 7. Export platform config
    console.log('[backup] Exporting platform config...');
    const fbCpl = await fsGet('platform_config/fb_cpl', token);
    backup.data.platform_config = { fb_cpl: fbCpl ? extractDoc(fbCpl) : null };

    // Summary
    backup.summary = {
      agencies: backup.data.agencies.length,
      totalClients: backup.data.agencies.reduce((s,a) => s + a.clients.length, 0),
      totalPayments: backup.data.agencies.reduce((s,a) => s + a.clients.reduce((cs,c) => cs + c.payments.length, 0), 0),
      referrals: backup.data.referrals.length,
      leads: backup.data.lead_pool.length,
    };

    console.log('[backup] Complete:', backup.summary);

    return new Response(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        ...CORS,
        'Content-Disposition': `attachment; filename="astroai-backup-${new Date().toISOString().slice(0,10)}.json"`,
      }
    });

  } catch(e) {
    console.error('[backup] Error:', e.message);
    return new Response(JSON.stringify({error: e.message}), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/admin/backup' };
