// netlify/functions/agency-delete-client.js
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

async function verifySession(token) {
  const fbToken = await getToken();
  return new Promise((resolve) => {
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/agency_sessions/${token}`,method:'GET',headers:{'Authorization':'Bearer '+fbToken}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const doc = JSON.parse(d);
          if (!doc.fields) return resolve(null);
          const agencyId = doc.fields.agencyId?.stringValue || '';
          const expiresAt = doc.fields.expiresAt?.stringValue || '';
          if (new Date(expiresAt) < new Date()) return resolve(null);
          resolve(agencyId);
        } catch(e) { resolve(null); }
      });
    });
    r.on('error',()=>resolve(null)); r.end();
  });
}

async function deleteFromFirestore(agencyId, clientId) {
  const fbToken = await getToken();
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname:'firestore.googleapis.com',
      path:`${BASE()}/agencies/${agencyId}/clients/${clientId}`,
      method:'DELETE',
      headers:{'Authorization':'Bearer '+fbToken}
    }, res => { res.resume(); res.on('end', resolve); });
    r.on('error', reject); r.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', {status:200,headers:CORS});
  if (req.method !== 'POST') return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  const sessionToken = req.headers.get('x-agency-token') || '';
  if (!sessionToken) return new Response(JSON.stringify({error:'No token'}),{status:401,headers:CORS});

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  const { agencyId, clientId } = body;
  if (!agencyId || !clientId) return new Response(JSON.stringify({error:'agencyId and clientId required'}),{status:400,headers:CORS});

  // Verify session belongs to this agency
  const sessionAgencyId = await verifySession(sessionToken);
  if (!sessionAgencyId || sessionAgencyId !== agencyId) {
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  }

  try {
    await deleteFromFirestore(agencyId, clientId);
    return new Response(JSON.stringify({success:true}),{status:200,headers:CORS});
  } catch(e) {
    console.error('[agency-delete-client]', e.message);
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/agency/delete-client' };
