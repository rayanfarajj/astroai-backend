// netlify/functions/admin-delete-agency.js
// Deletes an agency and all their subcollections from Firestore
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  'Content-Type': 'application/json',
};
const ADMIN_KEY = 'AstroAdmin2024!';

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

function fsHttp(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s = body?JSON.stringify(body):null;
    const r = https.request({hostname:'firestore.googleapis.com',path,method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(d)})}catch(e){resolve({status:res.statusCode,body:d})}});
    });
    r.on('error',reject); if(s)r.write(s); r.end();
  });
}

// List all docs in a subcollection
async function listSubcollection(agencyId, sub, token) {
  const r = await fsHttp('GET', `${BASE()}/agencies/${agencyId}/${sub}`, null, token);
  return (r.body?.documents || []).map(d => d.name.split('/').pop());
}

// Delete a single document
async function deleteDoc(path, token) {
  return fsHttp('DELETE', `${BASE()}/${path}`, null, token);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({error:'POST only'}), { status: 405, headers: CORS });

  const adminKey = req.headers.get('x-admin-key') || '';
  if (adminKey !== ADMIN_KEY) return new Response(JSON.stringify({error:'Unauthorized'}), { status: 401, headers: CORS });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}), { status: 400, headers: CORS }); }

  const { agencyId } = body;
  if (!agencyId) return new Response(JSON.stringify({error:'agencyId required'}), { status: 400, headers: CORS });

  try {
    const token = await getToken();
    const deleted = { clients: 0, payments: 0, sessions: 0, agency: false };

    // 1. Delete all clients and their payments subcollections
    const clients = await listSubcollection(agencyId, 'clients', token);
    for (const clientId of clients) {
      // Delete payments subcollection
      const payments = await listSubcollection(agencyId, `clients/${clientId}/payments`, token);
      for (const payId of payments) {
        await deleteDoc(`agencies/${agencyId}/clients/${clientId}/payments/${payId}`, token);
        deleted.payments++;
      }
      // Delete billing config
      await deleteDoc(`agencies/${agencyId}/clients/${clientId}/billing/config`, token);
      // Delete client doc
      await deleteDoc(`agencies/${agencyId}/clients/${clientId}`, token);
      deleted.clients++;
    }

    // 2. Delete agency_sessions for this agency
    const sessionsRes = await fsHttp('GET', `${BASE()}/agency_sessions`, null, token);
    const sessions = (sessionsRes.body?.documents || []);
    for (const s of sessions) {
      const fields = s.fields || {};
      if (fields.agencyId?.stringValue === agencyId) {
        const sessionId = s.name.split('/').pop();
        await deleteDoc(`agency_sessions/${sessionId}`, token);
        deleted.sessions++;
      }
    }

    // 3. Delete the agency document itself
    const r = await deleteDoc(`agencies/${agencyId}`, token);
    deleted.agency = r.status === 200 || r.status === 204;

    console.log(`[admin-delete-agency] Deleted agency ${agencyId}:`, deleted);
    return new Response(JSON.stringify({ success: true, deleted }), { status: 200, headers: CORS });

  } catch(e) {
    console.error('[admin-delete-agency]', e.message);
    return new Response(JSON.stringify({error: e.message}), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/admin/delete-agency' };
