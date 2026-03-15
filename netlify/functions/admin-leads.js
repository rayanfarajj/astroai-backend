// netlify/functions/admin-leads.js
import https from 'https';
import crypto from 'crypto';

const ADMIN_KEY = 'AstroAdmin2024!';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key, x-agency-token',
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

function fsReq(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s = body ? JSON.stringify(body) : null;
    const r = https.request({hostname:'firestore.googleapis.com',path,method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); if(s) r.write(s); r.end();
  });
}

function extractDoc(doc) {
  if (!doc||!doc.fields) return null;
  const o = {};
  for (const [k,v] of Object.entries(doc.fields)) o[k] = fromFS(v);
  o.id = (doc.name||'').split('/').pop();
  return o;
}

async function listLeads() {
  const t = await getToken();
  const res = await fsReq('GET', `${BASE()}/lead_pool?pageSize=300`, null, t);
  if (!res.documents) return [];
  return res.documents.map(extractDoc).filter(Boolean);
}

async function getDoc(path) {
  const t = await getToken();
  const res = await fsReq('GET', `${BASE()}/${path}`, null, t);
  return res.error ? null : extractDoc(res);
}

async function setDoc(path, data) {
  const t = await getToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsReq('PATCH', `${BASE()}/${path}`, {fields}, t);
}

async function deleteDoc(path) {
  const t = await getToken();
  return new Promise((resolve,reject)=>{
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/${path}`,method:'DELETE',headers:{'Authorization':'Bearer '+t}},res=>{res.resume();res.on('end',resolve);});
    r.on('error',reject); r.end();
  });
}

async function verifyAgencySession(sessionToken) {
  const doc = await getDoc(`agency_sessions/${sessionToken}`);
  if (!doc) return null;
  if (new Date(doc.expiresAt||0) < new Date()) return null;
  return doc.agencyId || null;
}

async function setSubDoc(agencyId, sub, docId, data) {
  const t = await getToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsReq('PATCH', `${BASE()}/agencies/${agencyId}/${sub}/${docId}`, {fields}, t);
}

// ── HANDLER ───────────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', {status:200,headers:CORS});

  const adminKey    = req.headers.get('x-admin-key') || '';
  const agencyToken = req.headers.get('x-agency-token') || '';
  const isAdmin     = adminKey === ADMIN_KEY;

  // ── GET: list leads ───────────────────────────────────────
  if (req.method === 'GET') {
    if (!isAdmin && !agencyToken) {
      return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
    }

    let agencyId = null;
    if (!isAdmin && agencyToken) {
      agencyId = await verifyAgencySession(agencyToken);
      if (!agencyId) return new Response(JSON.stringify({error:'Invalid session'}),{status:401,headers:CORS});
    }

    try {
      const leads = await listLeads();
      leads.sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));

      if (isAdmin) {
        // Admin sees everything including pending and claimed
        return new Response(JSON.stringify({success:true, leads}),{status:200,headers:CORS});
      } else {
        // Agencies only see ACTIVE unclaimed leads — contact info hidden
        const visible = leads
          .filter(l => !l.claimedBy && l.status === 'active')
          .map(l => ({
            id:           l.id,
            businessName: l.businessName,
            service:      l.service,
            industry:     l.industry||'',
            location:     l.location,
            price:        l.price||0,
            createdAt:    l.createdAt,
            contactName:  '••••••',
            phone:        '••• ••• ••••',
            email:        '••••@••••.com',
          }));
        return new Response(JSON.stringify({success:true, leads:visible}),{status:200,headers:CORS});
      }
    } catch(e) {
      console.error('[admin-leads GET]', e.message);
      return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
    }
  }

  // ── POST: add / delete / claim ────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

    const { action } = body;

    // ADD — admin only
    if (action === 'add') {
      if (!isAdmin) return new Response(JSON.stringify({error:'Admin only'}),{status:403,headers:CORS});
      const { businessName, contactName, phone, email, location, service, industry, notes, price } = body;
      if (!businessName||!contactName||!phone||!location||!service) {
        return new Response(JSON.stringify({error:'Required: businessName, contactName, phone, location, service'}),{status:400,headers:CORS});
      }
      const leadId = businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-'+Date.now().toString(36);
      await setDoc(`lead_pool/${leadId}`, {
        businessName, contactName, phone:phone||'', email:email||'',
        location, service, industry:industry||'', notes:notes||'',
        price:price||0,
        status:'active', // manually added leads go live immediately
        claimedBy:'', claimedAt:'', claimedByName:'',
        createdAt: new Date().toISOString(),
      });
      return new Response(JSON.stringify({success:true, leadId}),{status:200,headers:CORS});
    }

    // DELETE — admin only
    if (action === 'delete') {
      if (!isAdmin) return new Response(JSON.stringify({error:'Admin only'}),{status:403,headers:CORS});
      const { leadId } = body;
      if (!leadId) return new Response(JSON.stringify({error:'leadId required'}),{status:400,headers:CORS});
      await deleteDoc(`lead_pool/${leadId}`);
      return new Response(JSON.stringify({success:true}),{status:200,headers:CORS});
    }

    // CLAIM — agency only
    if (action === 'claim') {
      if (!agencyToken) return new Response(JSON.stringify({error:'Agency token required'}),{status:401,headers:CORS});
      const agencyId = await verifyAgencySession(agencyToken);
      if (!agencyId) return new Response(JSON.stringify({error:'Invalid session'}),{status:401,headers:CORS});

      const { leadId } = body;
      if (!leadId) return new Response(JSON.stringify({error:'leadId required'}),{status:400,headers:CORS});

      const lead = await getDoc(`lead_pool/${leadId}`);
      if (!lead) return new Response(JSON.stringify({error:'Lead not found'}),{status:404,headers:CORS});
      if (lead.claimedBy) return new Response(JSON.stringify({error:'Lead already claimed'}),{status:409,headers:CORS});

      const agency = await getDoc(`agencies/${agencyId}`);
      const agencyName = agency ? (agency.brandName||agency.name||agencyId) : agencyId;

      // Mark as claimed
      await setDoc(`lead_pool/${leadId}`, {
        ...lead, claimedBy:agencyId, claimedByName:agencyName,
        claimedAt: new Date().toISOString(),
      });

      // Add to agency clients as paid lead
      const clientId = lead.businessName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-lead-'+Date.now().toString(36);
      await setSubDoc(agencyId, 'clients', clientId, {
        agencyId, clientId,
        clientName:     lead.contactName,
        clientEmail:    lead.email||'',
        businessName:   lead.businessName,
        phone:          lead.phone||'',
        industry:       lead.industry||'',
        primaryService: lead.service,
        adBudget:'', adPlatforms:'',
        serviceAreaType:'', serviceDetails:lead.location||'',
        website:'', companySize:'', goal90:'',
        status:'new',
        tags:'paid-lead',
        leadSource:'Lead Pool',
        notes:lead.notes||'',
        dashboardUrl:'', dashboardJSON:'{}',
        createdAt: new Date().toISOString(),
      });

      return new Response(JSON.stringify({
        success: true, clientId,
        lead: {
          businessName: lead.businessName,
          contactName:  lead.contactName,
          phone:        lead.phone,
          email:        lead.email,
          location:     lead.location,
          service:      lead.service,
        },
      }),{status:200,headers:CORS});
    }

    return new Response(JSON.stringify({error:'Unknown action'}),{status:400,headers:CORS});
  }

  return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:CORS});
};

export const config = { path: '/api/admin/leads' };
