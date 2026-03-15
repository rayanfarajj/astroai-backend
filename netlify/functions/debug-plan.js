// netlify/functions/debug-plan.js
// Tests each step of plan generation to find where it fails
import https from 'https';
import crypto from 'crypto';

const CORS = { 'Access-Control-Allow-Origin':'*','Content-Type':'application/json' };

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
    const req = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('Firebase token failed: '+d));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function httpReq(opts, body) {
  return new Promise((resolve) => {
    const s = body ? JSON.stringify(body) : null;
    const r = https.request({...opts, headers:{...opts.headers,...(s?{'Content-Length':Buffer.byteLength(s)}:{})}}, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve({status:res.statusCode,body:JSON.parse(d)})}catch(e){resolve({status:res.statusCode,body:d})} });
    });
    r.on('error',e=>resolve({status:0,error:e.message}));
    if(s) r.write(s); r.end();
  });
}

export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== 'AstroAdmin2024!') {
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  }

  const results = {};

  // STEP 1: Test Firebase token
  try {
    const token = await getToken();
    results.step1_firebase = { ok: true, tokenLength: token.length };
  } catch(e) {
    results.step1_firebase = { ok: false, error: e.message };
    return new Response(JSON.stringify(results),{status:200,headers:CORS});
  }

  // STEP 2: Test Anthropic API key
  try {
    const res = await httpReq({
      hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
      headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'}
    }, {model:'claude-haiku-4-5-20251001',max_tokens:50,messages:[{role:'user',content:'Say OK'}]});
    results.step2_anthropic = { ok: res.status===200, status: res.status, response: typeof res.body==='object' ? (res.body.content?.[0]?.text||res.body.error?.message||JSON.stringify(res.body).slice(0,100)) : String(res.body).slice(0,100) };
  } catch(e) {
    results.step2_anthropic = { ok: false, error: e.message };
  }

  // STEP 3: Test GitHub token
  try {
    const res = await httpReq({
      hostname:'api.github.com', path:'/repos/rayanfarajj/astroai-backend', method:'GET',
      headers:{'Authorization':`token ${process.env.GITHUB_TOKEN}`,'User-Agent':'AstroAI'}
    });
    results.step3_github = { ok: res.status===200, status: res.status, repoName: res.body?.name, error: res.body?.message };
  } catch(e) {
    results.step3_github = { ok: false, error: e.message };
  }

  // STEP 4: Test background function trigger
  try {
    const testPayload = { agencyId:'test-debug', clientId:'test-client', planUrl:'https://test.com', portalUrl:'https://test.com', businessName:'Debug Test', firstName:'Debug', lastName:'Test', email:'test@test.com', industry:'Technology', primaryService:'Testing', adBudget:'1000', adPlatforms:'Meta', goal90Days:'Test goal' };
    const body = JSON.stringify(testPayload);
    const res = await httpReq({
      hostname:'marketingplan.astroaibots.com',
      path:'/.netlify/functions/agency-generate-background',
      method:'POST',
      headers:{'Content-Type':'application/json'}
    }, testPayload);
    results.step4_background_trigger = { ok: res.status===202, status: res.status, note: res.status===202?'Background function accepted (202 is correct)':'Unexpected status' };
  } catch(e) {
    results.step4_background_trigger = { ok: false, error: e.message };
  }

  // STEP 5: Check process-plan function works
  const agencyId = url.searchParams.get('a') || '';
  const clientId = url.searchParams.get('c') || '';
  if (agencyId && clientId) {
    try {
      const firebaseToken = await getToken();
      const BASE = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
      const res = await httpReq({
        hostname:'firestore.googleapis.com',
        path:`${BASE}/agencies/${agencyId}/clients/${clientId}`,
        method:'GET',
        headers:{'Authorization':'Bearer '+firebaseToken}
      });
      const fields = res.body?.fields || {};
      results.step5_client_doc = {
        ok: !!res.body?.fields,
        status: res.status,
        hasDashboardJSON: !!(fields.dashboardJSON?.stringValue && fields.dashboardJSON.stringValue !== '{}'),
        dashboardJSONLength: fields.dashboardJSON?.stringValue?.length || 0,
        hasStatus: fields.status?.stringValue,
        generatedAt: fields.generatedAt?.stringValue || 'NEVER GENERATED',
      };
    } catch(e) {
      results.step5_client_doc = { ok: false, error: e.message };
    }
  }

  return new Response(JSON.stringify(results, null, 2),{status:200,headers:CORS});
};

export const config = { path: '/api/debug-plan' };
