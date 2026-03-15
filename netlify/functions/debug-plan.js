// netlify/functions/debug-plan.js
// TEMPORARY — shows exactly what works and what fails
// Secured with INTERNAL_KEY

import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function getFirebaseToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
    if (!email || !key) { reject(new Error('FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY missing')); return; }
    const b64 = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now = Math.floor(Date.now()/1000);
    const hdr = b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const pay = b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const sig = b64(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(key));
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`;
    const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        const j=JSON.parse(d);
        if(j.access_token) resolve(j.access_token);
        else reject(new Error('Firebase token failed: '+d.slice(0,200)));
      });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function callClaude(apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model:'claude-sonnet-4-6',
      max_tokens:100,
      messages:[{role:'user',content:'Say "OK" and nothing else.'}]
    });
    const r = https.request({
      hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const j=JSON.parse(d);
          if(j.error) { reject(new Error('Claude error: '+j.error.message)); return; }
          resolve(j.content?.[0]?.text||'(empty)');
        } catch(e){reject(new Error('Claude parse error: '+d.slice(0,200)));}
      });
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

function fsGet(token, projectId, path) {
  return new Promise((resolve,reject)=>{
    const r = https.request({
      hostname:'firestore.googleapis.com',
      path:`/v1/projects/${projectId}/databases/(default)/documents/${path}`,
      method:'GET',
      headers:{'Authorization':'Bearer '+token}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(e);} });
    });
    r.on('error',reject); r.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('',{status:200,headers:CORS});

  // Security check
  const key = req.headers.get('x-internal-key') || new URL(req.url).searchParams.get('key');
  if (key !== (process.env.INTERNAL_KEY||'astroai-internal-2024')) {
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  }

  const results = {};
  const start = Date.now();

  // ── TEST 1: Environment Variables ────────────────────────────────────────
  results.env = {
    ANTHROPIC_API_KEY:    !!process.env.ANTHROPIC_API_KEY   ? `set (${process.env.ANTHROPIC_API_KEY.slice(0,12)}...)` : 'MISSING',
    FIREBASE_CLIENT_EMAIL:!!process.env.FIREBASE_CLIENT_EMAIL ? process.env.FIREBASE_CLIENT_EMAIL : 'MISSING',
    FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY  ? `set (${process.env.FIREBASE_PRIVATE_KEY.length} chars)` : 'MISSING',
    FIREBASE_PROJECT_ID:  process.env.FIREBASE_PROJECT_ID  || 'MISSING',
    GMAIL_USER:           process.env.GMAIL_USER            || 'MISSING',
    NETLIFY_SITE_ID:      process.env.NETLIFY_SITE_ID       || 'MISSING (blobs need this)',
    INTERNAL_KEY:         !!process.env.INTERNAL_KEY ? 'set' : 'MISSING',
  };

  // ── TEST 2: Firebase Token ───────────────────────────────────────────────
  let fbToken = null;
  try {
    fbToken = await getFirebaseToken();
    results.firebase_token = { ok: true, token_preview: fbToken.slice(0,20)+'...' };
  } catch(e) {
    results.firebase_token = { ok: false, error: e.message };
  }

  // ── TEST 3: Firestore Read ───────────────────────────────────────────────
  if (fbToken) {
    try {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const doc = await fsGet(fbToken, projectId, 'agencies?pageSize=1');
      const count = doc.documents?.length || 0;
      results.firestore_read = { ok: true, agencies_found: count };
    } catch(e) {
      results.firestore_read = { ok: false, error: e.message };
    }
  }

  // ── TEST 4: Claude API ───────────────────────────────────────────────────
  try {
    const t1 = Date.now();
    const resp = await callClaude(process.env.ANTHROPIC_API_KEY);
    results.claude_api = { ok: true, response: resp, ms: Date.now()-t1 };
  } catch(e) {
    results.claude_api = { ok: false, error: e.message };
  }

  // ── TEST 5: Netlify Blobs ────────────────────────────────────────────────
  try {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore('client-files');
    const testKey = 'debug-test-' + Date.now();
    await store.set(testKey, 'test');
    const val = await store.get(testKey);
    await store.delete(testKey);
    results.netlify_blobs = { ok: true, write_read_delete: 'all passed' };
  } catch(e) {
    results.netlify_blobs = { ok: false, error: e.message };
  }

  // ── TEST 6: Background function reachability ─────────────────────────────
  try {
    const bgResp = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'marketingplan.astroaibots.com',
        path: '/.netlify/functions/agency-generate-background',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 2 }
      }, res => {
        let d=''; res.on('data',c=>d+=c);
        res.on('end',()=>resolve({status:res.statusCode,body:d.slice(0,100)}));
      });
      r.on('error', reject);
      r.write('{}');
      r.end();
    });
    results.background_fn_reachable = { ok: bgResp.status === 202, status: bgResp.status, body: bgResp.body };
  } catch(e) {
    results.background_fn_reachable = { ok: false, error: e.message };
  }

  results.total_ms = Date.now() - start;
  results.timestamp = new Date().toISOString();

  return new Response(JSON.stringify(results, null, 2), {status:200, headers:CORS});
};

export const config = { path: '/api/debug-plan' };
