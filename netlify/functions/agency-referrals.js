// netlify/functions/agency-referrals.js
// GET  /api/agency/referrals — list all referrals for this agency
// POST /api/agency/referrals — update referral status or convert to client
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
      res.on('end',()=>{const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error('No token'));});
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
  return null;
}

function toFS(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean')    return {booleanValue:v};
  if (typeof v==='number')     return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if (typeof v==='string')     return {stringValue:v};
  return {stringValue:String(v)};
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
  for(const[k,v]of Object.entries(doc.fields)) o[k]=fromFS(v);
  o.id=(doc.name||'').split('/').pop();
  return o;
}

async function fsGet(path) {
  const t=await getToken();
  const r=await fsHttp('GET',`${BASE()}/${path}`,null,t);
  return (r.error||!r.fields)?null:extractDoc(r);
}

async function fsSet(path, data) {
  const t=await getToken();
  const {id,_id,...clean}=data;
  const fields=Object.fromEntries(Object.entries(clean).map(([k,v])=>[k,toFS(v)]));
  return fsHttp('PATCH',`${BASE()}/${path}`,{fields},t);
}

async function fsList(path) {
  const t=await getToken();
  const r=await fsHttp('GET',`${BASE()}/${path}?pageSize=200`,null,t);
  return (r.documents||[]).map(extractDoc).filter(Boolean);
}

// Fetch all referrals and filter by agencyId in memory (no index needed)
async function listReferralsByAgency(agencyId) {
  const t = await getToken();
  // Fetch up to 300 most recent referrals
  const all = await fsList('referrals');
  // Filter by agencyId and sort newest first
  return all
    .filter(r => r.agencyId === agencyId)
    .sort((a, b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
}

async function verifySession(sessionToken) {
  const doc = await fsGet(`agency_sessions/${sessionToken}`);
  if (!doc) return null;
  if (new Date(doc.expiresAt||0) < new Date()) return null;
  return doc.agencyId || null;
}

// ── HANDLER ───────────────────────────────────────────────────
export default async (req) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});

  const agencyToken = req.headers.get('x-agency-token')||'';
  const agencyId    = await verifySession(agencyToken);
  if (!agencyId) return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});

  // ── GET: list referrals ───────────────────────────────────
  if (req.method==='GET') {
    try {
      const referrals = await listReferralsByAgency(agencyId);
      return new Response(JSON.stringify({success:true, referrals}),{status:200,headers:CORS});
    } catch(e) {
      return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
    }
  }

  // ── POST: update status or convert ───────────────────────
  if (req.method==='POST') {
    let body;
    try { body=await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

    const { referralId, status, action } = body;

    // UPDATE STATUS
    if (status && referralId) {
      const allowed = ['pending','contacted','converted','rewarded','declined'];
      if (!allowed.includes(status)) return new Response(JSON.stringify({error:'Invalid status'}),{status:400,headers:CORS});
      try {
        const ref = await fsGet(`referrals/${referralId}`);
        if (!ref) return new Response(JSON.stringify({error:'Referral not found'}),{status:404,headers:CORS});
        await fsSet(`referrals/${referralId}`, { ...ref, status, updatedAt: new Date().toISOString() });
        return new Response(JSON.stringify({success:true}),{status:200,headers:CORS});
      } catch(e) {
        return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
      }
    }

    // CONVERT TO CLIENT
    if (action==='convert' && referralId) {
      try {
        const ref = await fsGet(`referrals/${referralId}`);
        if (!ref) return new Response(JSON.stringify({error:'Referral not found'}),{status:404,headers:CORS});

        // Add as client to agency subcollection
        const clientId = (ref.refereeBusinessName||ref.refereeName||'ref')
          .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)
          + '-ref-' + Date.now().toString(36);

        const nameParts = (ref.refereeName||'').split(' ');
        await fsSet(`agencies/${agencyId}/clients/${clientId}`, {
          agencyId,
          clientId,
          clientName:     ref.refereeName || '',
          clientEmail:    ref.refereeEmail || '',
          businessName:   ref.refereeBusinessName || ref.refereeName || '',
          phone:          ref.refereePhone || '',
          industry:       '',
          primaryService: '',
          adBudget:       '',
          adPlatforms:    '',
          goal90:         '',
          status:         'new',
          tags:           'referral',
          referredBy:     ref.referrerBusiness || ref.referrerName || '',
          referrerClientId: ref.referrerSlug || '',
          notes:          ref.refereeNote ? `Referral note: ${ref.refereeNote}` : '',
          dashboardUrl:   '',
          dashboardJSON:  '{}',
          referralId:     referralId,
          createdAt:      new Date().toISOString(),
        });

        // Mark referral as converted
        await fsSet(`referrals/${referralId}`, { ...ref, status:'converted', convertedClientId: clientId, updatedAt: new Date().toISOString() });

        return new Response(JSON.stringify({success:true, clientId}),{status:200,headers:CORS});
      } catch(e) {
        return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
      }
    }

    return new Response(JSON.stringify({error:'Missing required fields'}),{status:400,headers:CORS});
  }

  return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:CORS});
};

export const config = { path: '/api/agency/referrals' };
