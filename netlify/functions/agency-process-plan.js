// netlify/functions/agency-process-plan.js
// Fast handler — saves client record, triggers background job, returns immediately
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

function toFS(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean') return {booleanValue:v};
  if (typeof v==='number') return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if (typeof v==='string') return {stringValue:v};
  if (Array.isArray(v)) return {arrayValue:{values:v.map(toFS)}};
  if (typeof v==='object') return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,val])=>[k,toFS(val)]))}};
  return {stringValue:String(v)};
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

async function fsGet(col, id) {
  const t = await getToken();
  const d = await fsHttp('GET',`${BASE()}/${col}/${id}`,null,t);
  return d.error?null:extractDoc(d);
}

async function fsSetSub(agencyId, sub, docId, data) {
  const t = await getToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsHttp('PATCH',`${BASE()}/agencies/${agencyId}/${sub}/${docId}`,{fields},t);
}

// Trigger background function via Netlify public URL
function triggerBackground(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    // Always use the production URL — background functions must be called via HTTP
    const r = https.request({
      hostname: 'marketingplan.astroaibots.com',
      path: '/.netlify/functions/agency-generate-background',
      method: 'POST',
      headers: {'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},
    }, res => { res.resume(); res.on('end', resolve); });
    r.on('error', (e) => { console.error('[trigger-bg] FAILED to trigger background:', e.message); resolve(); });
    r.write(body); r.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', {status:200,headers:CORS});
  if (req.method !== 'POST')   return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  let data;
  try { data = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  const { agencyId } = data;
  if (!agencyId) return new Response(JSON.stringify({error:'agencyId required'}),{status:400,headers:CORS});

  const required = ['firstName','lastName','email','businessName','industry','primaryService','adBudget','adPlatforms','goal90Days'];
  for (const f of required) {
    if (!data[f]) return new Response(JSON.stringify({error:`${f} is required`}),{status:400,headers:CORS});
  }

  try {
    // 1. Validate agency exists
    const agency = await fsGet('agencies', agencyId);
    if (!agency) return new Response(JSON.stringify({error:'Agency not found'}),{status:404,headers:CORS});

    // 2. Create client ID and URLs
    const clientId  = data.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)+'-'+Date.now().toString(36);
    const planUrl   = `https://marketingplan.astroaibots.com/plans/${agencyId}/${clientId}.html`;
    const portalUrl = `https://marketingplan.astroaibots.com/onboard/portal?a=${agencyId}&s=${clientId}`;

    // 3. Save client record immediately (status: new)
    const clientData = {
      agencyId, clientId,
      firstName:data.firstName, lastName:data.lastName,
      clientName:`${data.firstName} ${data.lastName}`.trim(),
      clientEmail:data.email, businessName:data.businessName,
      phone:data.phone||'', industry:data.industry,
      primaryService:data.primaryService, adBudget:data.adBudget,
      adPlatforms:data.adPlatforms, serviceAreaType:data.serviceAreaType||'',
      serviceDetails:data.serviceDetails||'', website:data.website||'',
      companySize:data.companySize||'', goal90:data.goal90Days,
      status:'new', createdAt:new Date().toISOString(),
      dashboardUrl:'', dashboardJSON:'{}', notes:'',
    };
    await fsSetSub(agencyId, 'clients', clientId, clientData);

    // 4. Fire background job (non-blocking)
    triggerBackground({ ...data, clientId, planUrl, portalUrl }).catch(() => {});

    // 5. Return immediately
    return new Response(
      JSON.stringify({success:true, clientId, planUrl, portalUrl}),
      {status:200, headers:CORS}
    );

  } catch(err) {
    console.error('[agency-process-plan]', err.message);
    return new Response(JSON.stringify({error:err.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/agency/process-plan' };
