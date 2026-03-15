// netlify/functions/health-check.js
// Tests every feature of the AstroAI platform
// GET /api/health?key=AstroAdmin2024! — runs all checks
// GET /api/health?key=AstroAdmin2024!&test=plan&a=AGENCY_ID&c=CLIENT_ID — specific test
import https from 'https';
import crypto from 'crypto';

const CORS = { 'Access-Control-Allow-Origin':'*','Content-Type':'application/json' };
const BASE_URL = 'marketingplan.astroaibots.com';

// ── HTTP HELPERS ──────────────────────────────────────────────
function req(opts, body) {
  return new Promise((resolve) => {
    const s = body ? JSON.stringify(body) : null;
    const start = Date.now();
    const r = https.request({
      ...opts,
      hostname: opts.hostname || BASE_URL,
      headers: { 'Content-Type':'application/json', ...(opts.headers||{}), ...(s?{'Content-Length':Buffer.byteLength(s)}:{}) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        const ms = Date.now() - start;
        try {
          const parsed = JSON.parse(d);
          resolve({ status: res.statusCode, body: parsed, ms, ok: res.statusCode < 400 });
        } catch(e) {
          resolve({ status: res.statusCode, body: d.slice(0,200), ms, ok: false, parseError: true });
        }
      });
    });
    r.on('error', e => resolve({ status: 0, body: e.message, ms: Date.now()-Date.now(), ok: false, error: e.message }));
    r.setTimeout(8000, () => { r.destroy(); resolve({ status: 0, body: 'TIMEOUT', ms: 8000, ok: false, timeout: true }); });
    if (s) r.write(s);
    r.end();
  });
}

function api(path, method='GET', body=null, headers={}) {
  return req({ hostname: BASE_URL, path, method, headers }, body);
}

// ── FIREBASE TOKEN ────────────────────────────────────────────
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
    const r = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error(d));});
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

function fsRead(token, path) {
  return new Promise((resolve) => {
    const proj = process.env.FIREBASE_PROJECT_ID;
    const r = https.request({
      hostname:'firestore.googleapis.com',
      path:`/v1/projects/${proj}/databases/(default)/documents/${path}`,
      method:'GET',
      headers:{'Authorization':'Bearer '+token}
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){resolve({error:e.message})} });
    });
    r.on('error',e=>resolve({error:e.message})); r.end();
  });
}

// ── RUN ALL CHECKS ────────────────────────────────────────────
async function runAllChecks(agencyId, clientId, agencyToken) {
  const checks = [];
  const pass = (name, detail='', ms=0) => checks.push({ name, status:'pass', detail, ms });
  const fail = (name, detail='', ms=0) => checks.push({ name, status:'fail', detail, ms });
  const warn = (name, detail='', ms=0) => checks.push({ name, status:'warn', detail, ms });

  // ── INFRA CHECKS ─────────────────────────────────────────
  // 1. Firebase Auth
  try {
    const t = await getFirebaseToken();
    t.length > 100 ? pass('🔥 Firebase Auth', `Token: ${t.length} chars`) : fail('🔥 Firebase Auth', 'Token too short');
  } catch(e) { fail('🔥 Firebase Auth', e.message); }

  // 2. Anthropic API
  const anthropicRes = await req({
    hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
    headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'}
  }, {model:'claude-haiku-4-5-20251001',max_tokens:10,messages:[{role:'user',content:'Say OK'}]});
  anthropicRes.ok && anthropicRes.body?.content?.[0]?.text
    ? pass('🤖 Anthropic API', `Model responding (${anthropicRes.ms}ms)`, anthropicRes.ms)
    : fail('🤖 Anthropic API', anthropicRes.body?.error?.message || JSON.stringify(anthropicRes.body).slice(0,80), anthropicRes.ms);

  // 3. GitHub Token
  const ghRes = await req({
    hostname:'api.github.com', path:'/repos/rayanfarajj/astroai-backend', method:'GET',
    headers:{'Authorization':`token ${process.env.GITHUB_TOKEN}`,'User-Agent':'AstroAI'}
  });
  ghRes.ok ? pass('📦 GitHub Token', `Repo: ${ghRes.body?.name}`, ghRes.ms)
           : fail('📦 GitHub Token', ghRes.body?.message || 'Failed', ghRes.ms);

  // 4. Gmail Config
  (process.env.GMAIL_USER && process.env.GMAIL_PASS)
    ? pass('📧 Gmail Config', process.env.GMAIL_USER)
    : fail('📧 Gmail Config', 'GMAIL_USER or GMAIL_PASS missing');

  // ── PAGE AVAILABILITY ─────────────────────────────────────
  const pages = [
    ['/saas-dashboard.html', '🖥 Agency Dashboard HTML'],
    ['/client-portal.html',  '👤 Client Portal HTML'],
    ['/onboard.html',        '📋 Onboard Form HTML'],
    ['/join.html',           '🚪 Join Page HTML'],
  ];
  for (const [path, name] of pages) {
    const r = await api(path);
    r.status === 200 ? pass(name, `${r.ms}ms`, r.ms) : fail(name, `HTTP ${r.status}`, r.ms);
  }

  // ── API ENDPOINT CHECKS ───────────────────────────────────
  // Agency login endpoint
  const loginRes = await api('/api/agency/login', 'POST', {email:'test@notreal.com',password:'wrong'});
  loginRes.status < 500 ? pass('🔐 Agency Login Endpoint', `Returns ${loginRes.status}`, loginRes.ms)
                        : fail('🔐 Agency Login Endpoint', `HTTP ${loginRes.status}`, loginRes.ms);

  // Agency register endpoint
  const regRes = await api('/api/agency/register', 'POST', {email:'',password:''});
  regRes.status < 500 ? pass('📝 Agency Register Endpoint', `Returns ${regRes.status}`, regRes.ms)
                      : fail('📝 Agency Register Endpoint', `HTTP ${regRes.status}`, regRes.ms);

  // Get portal endpoint
  const portalRes = await api('/api/get-portal?slug=nonexistent');
  portalRes.status === 404 && portalRes.body?.error
    ? pass('🌐 Get Portal Endpoint', `Returns JSON 404 correctly`, portalRes.ms)
    : portalRes.parseError
    ? fail('🌐 Get Portal Endpoint', 'Returns HTML instead of JSON — function crashed', portalRes.ms)
    : pass('🌐 Get Portal Endpoint', `Returns ${portalRes.status}`, portalRes.ms);

  // Submit referral endpoint
  const refRes = await api('/api/submit-referral', 'POST', {referrerSlug:'',refereeEmail:''});
  refRes.status < 500 ? pass('🤝 Submit Referral Endpoint', `Returns ${refRes.status}`, refRes.ms)
                      : fail('🤝 Submit Referral Endpoint', `HTTP ${refRes.status} — function crashed`, refRes.ms);

  // Background function reachable
  const bgRes = await api('/.netlify/functions/agency-generate-background', 'POST', {test:true});
  bgRes.status === 202 ? pass('⚡ Background Function Reachable', '202 accepted', bgRes.ms)
                       : fail('⚡ Background Function Reachable', `HTTP ${bgRes.status}`, bgRes.ms);

  // Agency-specific checks if agencyId provided
  if (agencyId && agencyToken) {
    const headers = { 'x-agency-token': agencyToken };

    // Get clients
    const clientsRes = await api(`/api/agency/clients?agencyId=${agencyId}`, 'GET', null, headers);
    clientsRes.ok && Array.isArray(clientsRes.body?.clients)
      ? pass('👥 Agency Get Clients', `${clientsRes.body.clients.length} clients found`, clientsRes.ms)
      : fail('👥 Agency Get Clients', clientsRes.body?.error || `HTTP ${clientsRes.status}`, clientsRes.ms);

    // Agency settings
    const settingsRes = await api(`/api/agency/settings?agencyId=${agencyId}`, 'GET', null, headers);
    settingsRes.ok && settingsRes.body?.agency
      ? pass('⚙️ Agency Settings', `Agency: ${settingsRes.body.agency.name||settingsRes.body.agency.brandName}`, settingsRes.ms)
      : fail('⚙️ Agency Settings', settingsRes.body?.error || `HTTP ${settingsRes.status}`, settingsRes.ms);

    // Agency referrals
    const refListRes = await api('/api/agency/referrals', 'GET', null, headers);
    refListRes.ok
      ? pass('◎ Agency Referrals', `${refListRes.body?.referrals?.length||0} referrals`, refListRes.ms)
      : fail('◎ Agency Referrals', refListRes.body?.error || `HTTP ${refListRes.status}`, refListRes.ms);

    // Billing endpoint
    if (clientId) {
      const billingRes = await api(`/api/agency/billing?clientId=${clientId}`, 'GET', null, headers);
      billingRes.ok
        ? pass('💳 Agency Billing Endpoint', `config: ${billingRes.body?.config?'found':'empty'}, payments: ${billingRes.body?.payments?.length||0}`, billingRes.ms)
        : fail('💳 Agency Billing Endpoint', billingRes.body?.error || `HTTP ${billingRes.status}`, billingRes.ms);

      // Client portal data
      const portalDataRes = await api(`/api/get-portal?s=${clientId}&a=${agencyId}`);
      portalDataRes.ok && portalDataRes.body?.client
        ? pass('👤 Client Portal Data', `Client: ${portalDataRes.body.client.businessName}, billing: ${portalDataRes.body.billing?'yes':'no'}, referralBonus: ${portalDataRes.body.referralBonus?'set':'empty'}`, portalDataRes.ms)
        : fail('👤 Client Portal Data', portalDataRes.body?.error || 'No client returned', portalDataRes.ms);

      // Plan generation check — does client have a plan?
      try {
        const fbToken = await getFirebaseToken();
        const clientDoc = await fsRead(fbToken, `agencies/${agencyId}/clients/${clientId}`);
        const hasJSON = clientDoc?.fields?.dashboardJSON?.stringValue &&
                        clientDoc.fields.dashboardJSON.stringValue !== '{}';
        hasJSON
          ? pass('📊 Client Plan Data', `dashboardJSON: ${clientDoc.fields.dashboardJSON.stringValue.length} chars`, 0)
          : warn('📊 Client Plan Data', 'dashboardJSON is empty — plan not generated yet', 0);

        const hasBilling = !!clientDoc?.fields?.dashboardUrl?.stringValue;
        hasBilling ? pass('🔗 Client Dashboard URL', clientDoc.fields.dashboardUrl.stringValue, 0)
                   : warn('🔗 Client Dashboard URL', 'No dashboardUrl set', 0);
      } catch(e) { fail('📊 Client Plan Data', e.message); }
    }

    // Process plan endpoint (just validate it returns JSON, don't actually trigger)
    const processRes = await api('/api/agency/process-plan', 'POST', {agencyId, firstName:'', lastName:'', email:'', businessName:'', industry:'', primaryService:'', adBudget:'', adPlatforms:'', goal90Days:''});
    processRes.status < 500 && !processRes.parseError
      ? pass('🚀 Process Plan Endpoint', `Returns JSON ${processRes.status}`, processRes.ms)
      : fail('🚀 Process Plan Endpoint', processRes.parseError ? 'Returns HTML — crashed/timed out' : `HTTP ${processRes.status}`, processRes.ms);
  }

  // ── ADMIN CHECKS ──────────────────────────────────────────
  const adminKey = 'AstroAdmin2024!';
  const leadsRes = await api(`/api/admin/leads?key=${adminKey}`);
  leadsRes.ok ? pass('🎯 Admin Leads Endpoint', `${leadsRes.ms}ms`, leadsRes.ms)
              : fail('🎯 Admin Leads Endpoint', `HTTP ${leadsRes.status}`, leadsRes.ms);

  return checks;
}

// ── HANDLER ───────────────────────────────────────────────────
export default async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== 'AstroAdmin2024!') {
    return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  }

  const agencyId    = url.searchParams.get('a') || '';
  const clientId    = url.searchParams.get('c') || '';
  const agencyToken = url.searchParams.get('t') || '';

  try {
    const checks = await runAllChecks(agencyId, clientId, agencyToken);
    const passed  = checks.filter(c=>c.status==='pass').length;
    const failed  = checks.filter(c=>c.status==='fail').length;
    const warned  = checks.filter(c=>c.status==='warn').length;
    return new Response(JSON.stringify({
      summary: { passed, failed, warned, total: checks.length, healthy: failed === 0 },
      checks,
      timestamp: new Date().toISOString(),
    }, null, 2), {status:200,headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/health' };
