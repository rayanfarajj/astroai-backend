// netlify/functions/hl-lead-approve.js
// One-click approve lead from admin email link OR from admin dashboard
// GET /api/admin/leads/approve?id=LEAD_ID&key=ADMIN_KEY&price=OPTIONAL_PRICE
import https from 'https';
import crypto from 'crypto';

const ADMIN_KEY = 'AstroAdmin2024!';

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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No token'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function toFS(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean') return {booleanValue:v};
  if (typeof v==='number') return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if (typeof v==='string') return {stringValue:v};
  return {stringValue:String(v)};
}

function fromFS(v) {
  if (!v) return null;
  if ('stringValue'  in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
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

export default async (req) => {
  const url    = new URL(req.url);
  const key    = url.searchParams.get('key') || req.headers.get('x-admin-key') || '';
  const leadId = url.searchParams.get('id') || '';
  const action = url.searchParams.get('action') || 'approve'; // approve or reject
  const newPrice = url.searchParams.get('price') ? parseFloat(url.searchParams.get('price')) : null;

  if (key !== ADMIN_KEY) {
    return new Response('<h1>Unauthorized</h1>',{status:401,headers:{'Content-Type':'text/html'}});
  }
  if (!leadId) {
    return new Response('<h1>Lead ID required</h1>',{status:400,headers:{'Content-Type':'text/html'}});
  }

  try {
    const t = await getFirebaseToken();

    // Get existing lead
    const doc = await fsHttp('GET',`${BASE()}/lead_pool/${leadId}`,null,t);
    if (!doc.fields) {
      return new Response('<h1>Lead not found</h1>',{status:404,headers:{'Content-Type':'text/html'}});
    }

    // Extract existing fields
    const existing = {};
    for (const [k,v] of Object.entries(doc.fields)) existing[k]=fromFS(v);

    if (action === 'reject') {
      // Delete the lead
      await fsHttp('DELETE',`${BASE()}/lead_pool/${leadId}`,null,t);
      return new Response(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#06070d;color:#eef2f7;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px"><h2 style="color:#ef4444">🗑 Lead Rejected</h2><p style="color:#6b7a99">${existing.businessName||leadId} has been removed from the pool.</p><a href="https://marketingplan.astroaibots.com/admin" style="color:#00d9a3">← Back to Admin</a></body></html>`,{status:200,headers:{'Content-Type':'text/html'}});
    }

    // Approve — set status to 'active' so agencies can see it
    const price = newPrice !== null ? newPrice : (existing.price||0);
    const updatedFields = Object.fromEntries(
      Object.entries({...existing, status:'active', price, approvedAt:new Date().toISOString()})
        .map(([k,v])=>[k,toFS(v)])
    );
    await fsHttp('PATCH',`${BASE()}/lead_pool/${leadId}`,{fields:updatedFields},t);

    return new Response(`<!DOCTYPE html><html><body style="font-family:sans-serif;background:#06070d;color:#eef2f7;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:12px"><h2 style="color:#00d9a3">✅ Lead Approved!</h2><p style="color:#6b7a99">${existing.businessName||leadId} is now live in the Lead Pool at <strong style="color:#00d9a3">$${price}</strong>.</p><a href="https://marketingplan.astroaibots.com/admin" style="color:#00d9a3">← Back to Admin</a></body></html>`,{status:200,headers:{'Content-Type':'text/html'}});

  } catch(e) {
    console.error('[hl-lead-approve]', e.message);
    return new Response(`<h1>Error: ${e.message}</h1>`,{status:500,headers:{'Content-Type':'text/html'}});
  }
};

export const config = { path: '/api/admin/leads/approve' };
