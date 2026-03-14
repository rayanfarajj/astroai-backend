// netlify/functions/admin-agencies.js
import https from 'https';
import crypto from 'crypto';

const ADMIN_KEY = 'AstroAdmin2024!';
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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No token'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

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

function fsHttp(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s = body?JSON.stringify(body):null;
    const r = https.request({hostname:'firestore.googleapis.com',path,method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); if(s)r.write(s); r.end();
  });
}

function extractDoc(doc) {
  if (!doc||!doc.fields) return null;
  const o={};
  for (const [k,v] of Object.entries(doc.fields)) o[k]=fromFS(v);
  o.id=(doc.name||'').split('/').pop();
  return o;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', {status:200,headers:CORS});
  if (req.headers.get('x-admin-key') !== ADMIN_KEY) {
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  }

  try {
    const token = await getToken();

    // List all agencies
    const agenciesRes = await fsHttp('GET', `${BASE()}/agencies?pageSize=300`, null, token);
    const agencies = (agenciesRes.documents||[]).map(extractDoc).filter(Boolean);

    // For each agency, get client count
    const enriched = await Promise.all(agencies.map(async (agency) => {
      try {
        const clientsRes = await fsHttp('GET', `${BASE()}/agencies/${agency.id}/clients?pageSize=300`, null, token);
        const clients    = (clientsRes.documents||[]).map(extractDoc).filter(Boolean);
        const planCount  = clients.filter(c => c.dashboardJSON && c.dashboardJSON !== '{}').length;
        return { ...agency, clientCount: clients.length, planCount };
      } catch(e) {
        return { ...agency, clientCount: 0, planCount: 0 };
      }
    }));

    // Sort by newest first
    enriched.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));

    return new Response(JSON.stringify({success:true, agencies:enriched}),{status:200,headers:CORS});
  } catch(e) {
    console.error('[admin-agencies]', e.message);
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/admin/agencies' };
