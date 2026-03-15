// netlify/functions/debug-plan.js
// Runs generateAndSavePlan SYNCHRONOUSLY and reports every step
import https from 'https';
import crypto from 'crypto';
import { getStore } from '@netlify/blobs';

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function getToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
    const b64 = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now = Math.floor(Date.now()/1000);
    const hdr = b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const pay = b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const sig = b64(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(key));
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`;
    const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error(d.slice(0,300)));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function toFS(v) {
  if(v===null||v===undefined) return {nullValue:null};
  if(typeof v==='boolean') return {booleanValue:v};
  if(typeof v==='number') return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(typeof v==='string') return {stringValue:v};
  if(Array.isArray(v)) return {arrayValue:{values:v.map(toFS)}};
  if(typeof v==='object') return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,val])=>[k,toFS(val)]))}};
  return {stringValue:String(v)};
}

function fsReq(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s = body ? JSON.stringify(body) : null;
    const r = https.request({hostname:'firestore.googleapis.com',path,method,
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(d)})}catch(e){resolve({status:res.statusCode,body:d})}});
    });
    r.on('error',reject); if(s)r.write(s); r.end();
  });
}

function callClaude(prompt) {
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify({model:'claude-sonnet-4-6',max_tokens:3000,messages:[{role:'user',content:prompt}]});
    const r = https.request({hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try{const j=JSON.parse(d);if(j.error)reject(new Error(j.error.message));else resolve(j.content?.[0]?.text||'');}
        catch(e){reject(new Error(d.slice(0,200)));}
      });
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

export default async (req) => {
  if(req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});
  const key = req.headers.get('x-internal-key')||new URL(req.url).searchParams.get('key');
  if(key !== (process.env.INTERNAL_KEY||'astroai-internal-2024'))
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});

  const url    = new URL(req.url);
  const agencyId = url.searchParams.get('agencyId') || 'kacie-mmrkkl3x';
  const steps  = {};
  const t0     = Date.now();

  // STEP 1: Firebase token
  let token;
  try { token = await getToken(); steps.s1_token = {ok:true, ms:Date.now()-t0}; }
  catch(e) { return new Response(JSON.stringify({fail:'s1_token', error:e.message}),{status:200,headers:CORS}); }

  // STEP 2: Call Claude with full prompt (same max_tokens as real function)
  let json = {};
  let raw = '';
  const t2 = Date.now();
  try {
    raw = await callClaude(`You are a marketing strategist. Generate a marketing plan for Test Plumbing Co.
Output ONLY raw JSON starting with { — no markdown, no explanation.
Business: Test Plumbing Co | Industry: Plumbing | Service: Drain cleaning
Budget: $35/day | Platforms: Facebook, Instagram | Area: San Antonio TX
Stand Out: Same day service | Goal: 40 calls/month

JSON format:
{"tagline":"one sentence","adAngles":[{"angleLabel":"Pain","angle":"strategy","ads":[{"title":"A","headline":"headline","primaryText":"3 sentences","description":"1 line","cta":"CTA"}]}],"targeting":{"demographics":["d1"],"interests":["i1"]},"roadmap":[{"phase":"Week 1","title":"Foundation","desc":"actions"}],"kpis":{"cpl":"$20-30"}}`);
    steps.s2_claude = {ok:true, ms:Date.now()-t2, chars:raw.length, preview:raw.slice(0,100)};
  } catch(e) { return new Response(JSON.stringify({fail:'s2_claude', error:e.message, ms:Date.now()-t2}),{status:200,headers:CORS}); }

  // STEP 3: Parse JSON
  try {
    json = JSON.parse(raw.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim());
    steps.s3_parse = {ok:true, keys:Object.keys(json)};
  } catch(e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if(m) { try{ json=JSON.parse(m[0]); steps.s3_parse={ok:true,method:'regex',keys:Object.keys(json)}; }
            catch(e2){ steps.s3_parse={ok:false,error:e2.message,raw_tail:raw.slice(-200)}; } }
    else  { steps.s3_parse={ok:false,error:e.message,raw_tail:raw.slice(-200)}; }
  }

  // STEP 4: Write to Firestore with dashboardJSON
  const slug = 'debug-full-'+Date.now().toString(36);
  const t4 = Date.now();
  const BASE = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  try {
    const doc = {fields: Object.fromEntries(Object.entries({
      agencyId, clientId:slug, businessName:'Debug Test Co',
      firstName:'Debug', lastName:'Test', clientEmail:'debug@test.com',
      status:'active', createdAt:new Date().toISOString(),
      dashboardJSON: JSON.stringify(json),
      dashboardUrl:`https://marketingplan.astroaibots.com/plans/${agencyId}/${slug}`,
      generatedAt:new Date().toISOString(),
    }).map(([k,v])=>[k,toFS(v)]))};
    const resp = await fsReq('PATCH', `${BASE}/agencies/${agencyId}/clients/${slug}`, doc, token);
    steps.s4_firestore_write = {ok:resp.status===200, status:resp.status, ms:Date.now()-t4,
      error: resp.status!==200 ? JSON.stringify(resp.body).slice(0,300) : null};
    if(resp.status!==200) return new Response(JSON.stringify({fail:'s4_firestore_write', steps}),{status:200,headers:CORS});
  } catch(e) { return new Response(JSON.stringify({fail:'s4_firestore_write', error:e.message, steps}),{status:200,headers:CORS}); }

  // STEP 5: Read it back to confirm it saved
  try {
    const resp = await fsReq('GET', `${BASE}/agencies/${agencyId}/clients/${slug}`, null, token);
    const dj = resp.body?.fields?.dashboardJSON?.stringValue;
    steps.s5_readback = {ok:!!dj && dj !== '{}', dashboardJSON_len:dj?.length, status:resp.status};
  } catch(e) { steps.s5_readback = {ok:false, error:e.message}; }

  // STEP 6: Write to Blobs
  const t6 = Date.now();
  try {
    const store = getStore('client-files');
    const blobKey = `${slug}/authorization-agreement.pdf`;
    await store.set(blobKey, Buffer.from('fake pdf content'), {metadata:{
      displayName:'Authorization Agreement', protected:'true', systemFile:'true',
      docType:'authorization', slug, uploadedAt:new Date().toISOString(),
      fileType:'application/pdf', fileSize:'16', originalName:'auth.pdf'
    }});
    const meta = await store.getMetadata(blobKey);
    steps.s6_blobs = {ok:true, ms:Date.now()-t6, metadata_ok:!!meta?.metadata?.protected};
    // cleanup
    await store.delete(blobKey);
  } catch(e) { steps.s6_blobs = {ok:false, error:e.message, ms:Date.now()-t6}; }

  // STEP 7: cleanup Firestore test doc
  try { await fsReq('DELETE',`${BASE}/agencies/${agencyId}/clients/${slug}`,null,token); steps.s7_cleanup={ok:true}; }
  catch(e) { steps.s7_cleanup={ok:false,error:e.message}; }

  steps.total_ms = Date.now()-t0;

  const allOk = ['s1_token','s2_claude','s3_parse','s4_firestore_write','s5_readback','s6_blobs']
    .every(k => steps[k]?.ok);

  return new Response(JSON.stringify({
    verdict: allOk ? '✅ ALL STEPS PASS — bug is in waitUntil timing or data flow, not infra' : '❌ STEP FAILED — see steps for which one',
    steps
  }, null, 2), {status:200, headers:CORS});
};

export const config = { path: '/api/debug-plan' };
