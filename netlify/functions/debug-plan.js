// netlify/functions/debug-plan.js
// Tests the EXACT same code path as generateAndSavePlan step by step

import https from 'https';
import crypto from 'crypto';
import { getStore } from '@netlify/blobs';

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

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
      res.on('end',()=>{ try { const j=JSON.parse(d); j.access_token?resolve(j.access_token):reject(new Error('No token: '+d.slice(0,200))); } catch(e){reject(e);} });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function fsHttp(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s = body?JSON.stringify(body):null;
    const r = https.request({
      hostname:'firestore.googleapis.com', path, method,
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}
    },res=>{ let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){reject(new Error('Parse error: '+d.slice(0,200)));} }); });
    r.on('error',reject); if(s)r.write(s); r.end();
  });
}

function toFS(v) {
  if (v === null || v === undefined) return {nullValue:null};
  if (typeof v === 'boolean') return {booleanValue:v};
  if (typeof v === 'number') return {integerValue:String(v)};
  if (typeof v === 'string') return {stringValue:v};
  if (Array.isArray(v)) return {arrayValue:{values:v.map(toFS)}};
  if (typeof v === 'object') return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,val])=>[k,toFS(val)]))}};
  return {stringValue:String(v)};
}

function callClaude(prompt) {
  return new Promise((resolve,reject)=>{
    const body = JSON.stringify({model:'claude-sonnet-4-6',max_tokens:500,messages:[{role:'user',content:prompt}]});
    const r = https.request({
      hostname:'api.anthropic.com',path:'/v1/messages',method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}
    },res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        try {
          const j=JSON.parse(d);
          if(j.error){reject(new Error('Claude: '+j.error.message));return;}
          resolve(j.content?.[0]?.text||'');
        } catch(e){reject(new Error('Parse: '+d.slice(0,300)));}
      });
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

export default async (req, context) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});

  const key = req.headers.get('x-internal-key') || new URL(req.url).searchParams.get('key');
  if (key !== (process.env.INTERNAL_KEY||'astroai-internal-2024')) {
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  }

  const agencyId = new URL(req.url).searchParams.get('agencyId') || 'kaciekacie-mmqeijsz';
  const results = { agencyId, steps: {} };

  // STEP 1: Firebase token
  let token;
  try {
    const t0 = Date.now();
    token = await getToken();
    results.steps.s1_firebase_token = { ok: true, ms: Date.now()-t0 };
  } catch(e) {
    results.steps.s1_firebase_token = { ok: false, error: e.message };
    return new Response(JSON.stringify(results),{status:200,headers:CORS});
  }

  // STEP 2: Read agency from Firestore
  let agency;
  try {
    const t0 = Date.now();
    const BASE = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const doc = await fsHttp('GET', `${BASE}/agencies/${agencyId}`, null, token);
    if (doc.error) throw new Error(JSON.stringify(doc.error));
    agency = { name: doc.fields?.name?.stringValue || doc.fields?.brandName?.stringValue || '(unnamed)' };
    results.steps.s2_read_agency = { ok: true, name: agency.name, ms: Date.now()-t0, fields: Object.keys(doc.fields||{}) };
  } catch(e) {
    results.steps.s2_read_agency = { ok: false, error: e.message };
    return new Response(JSON.stringify(results),{status:200,headers:CORS});
  }

  // STEP 3: Write a test client to Firestore
  const testSlug = 'debug-test-' + Date.now();
  try {
    const t0 = Date.now();
    const BASE = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const fields = Object.fromEntries(Object.entries({
      agencyId, clientId: testSlug, businessName: 'Debug Test Co',
      dashboardJSON: '{}', status: 'test', createdAt: new Date().toISOString()
    }).map(([k,v])=>[k,toFS(v)]));
    const res = await fsHttp('PATCH', `${BASE}/agencies/${agencyId}/clients/${testSlug}`, {fields}, token);
    if (res.error) throw new Error(JSON.stringify(res.error));
    results.steps.s3_write_firestore = { ok: true, slug: testSlug, ms: Date.now()-t0 };
  } catch(e) {
    results.steps.s3_write_firestore = { ok: false, error: e.message };
  }

  // STEP 4: Call Claude with a realistic short prompt
  let claudeResponse;
  try {
    const t0 = Date.now();
    claudeResponse = await callClaude(
      'Generate a minimal marketing plan JSON for a plumbing company. ' +
      'Return ONLY: {"tagline":"one sentence","adAngles":[{"angleLabel":"Pain","ads":[{"headline":"h","primaryText":"p","cta":"c"}]}]}'
    );
    let parsed = null;
    let parseErr = null;
    try { parsed = JSON.parse(claudeResponse.replace(/^```json\s*/,'').replace(/\s*```$/,'').trim()); }
    catch(pe) { parseErr = pe.message; }
    results.steps.s4_claude_call = { ok: true, ms: Date.now()-t0, chars: claudeResponse.length, parsed_ok: !!parsed, parse_error: parseErr, preview: claudeResponse.slice(0,200) };
  } catch(e) {
    results.steps.s4_claude_call = { ok: false, error: e.message };
  }

  // STEP 5: Write Claude result back to Firestore (simulates saving plan)
  if (results.steps.s3_write_firestore?.ok && claudeResponse) {
    try {
      const t0 = Date.now();
      const BASE = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
      const fields = Object.fromEntries(Object.entries({
        agencyId, clientId: testSlug,
        dashboardJSON: claudeResponse,
        status: 'active',
        generatedAt: new Date().toISOString(),
      }).map(([k,v])=>[k,toFS(v)]));
      const res = await fsHttp('PATCH', `${BASE}/agencies/${agencyId}/clients/${testSlug}`, {fields}, token);
      if (res.error) throw new Error(JSON.stringify(res.error));
      results.steps.s5_save_plan_to_firestore = { ok: true, ms: Date.now()-t0 };
    } catch(e) {
      results.steps.s5_save_plan_to_firestore = { ok: false, error: e.message };
    }
  }

  // STEP 6: Write to Netlify Blobs (simulates auth PDF save)
  try {
    const t0 = Date.now();
    const store = getStore('client-files');
    const blobKey = `${testSlug}/test-auth.json`;
    await store.set(blobKey, JSON.stringify({test:true,ts:Date.now()}), {
      metadata: { displayName:'Test Auth', protected:'true', systemFile:'true', docType:'authorization', slug:testSlug, uploadedAt:new Date().toISOString() }
    });
    const readback = await store.get(blobKey);
    await store.delete(blobKey);
    results.steps.s6_blobs_write_read = { ok: true, readback_ok: !!readback, ms: Date.now()-t0 };
  } catch(e) {
    results.steps.s6_blobs_write_read = { ok: false, error: e.message };
  }

  // STEP 7: context.waitUntil availability
  results.steps.s7_context_waituntil = {
    context_exists: !!context,
    waitUntil_exists: !!(context?.waitUntil),
    note: context?.waitUntil ? 'waitUntil available — background work will run' : 'waitUntil NOT available — plan generation will be SYNCHRONOUS and may timeout'
  };

  // STEP 8: Test waitUntil actually runs (write a delayed record)
  if (context?.waitUntil) {
    const wuSlug = 'waituntil-test-' + Date.now();
    context.waitUntil((async () => {
      try {
        await new Promise(r => setTimeout(r, 1000)); // 1 second delay
        const BASE = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
        const tkn = await getToken();
        const fields = Object.fromEntries(Object.entries({
          agencyId, clientId: wuSlug, businessName: 'WaitUntil Test',
          dashboardJSON: '{"waitUntil":"worked"}', status: 'test',
          createdAt: new Date().toISOString(),
        }).map(([k,v])=>[k,toFS(v)]));
        await fsHttp('PATCH', `${BASE}/agencies/${agencyId}/clients/${wuSlug}`, {fields}, tkn);
        console.log('[debug] waitUntil test SUCCEEDED — wrote:', wuSlug);
      } catch(e) {
        console.error('[debug] waitUntil test FAILED:', e.message);
      }
    })());
    results.steps.s8_waituntil_test = {
      fired: true,
      slug: wuSlug,
      instruction: `Check Firestore for agencies/${agencyId}/clients/${wuSlug} — if it exists waitUntil works. Check in 5 seconds.`
    };
  }

  // Cleanup test record
  try {
    const BASE = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    await fsHttp('DELETE', `${BASE}/agencies/${agencyId}/clients/${testSlug}`, null, token);
  } catch(e) {}

  results.total_ms = Object.values(results.steps).reduce((a,s)=>a+(s.ms||0),0);
  return new Response(JSON.stringify(results, null, 2), {status:200,headers:CORS});
};

export const config = { path: '/api/debug-plan' };
