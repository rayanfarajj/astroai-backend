// netlify/functions/hl-webhook.js
// Receives HighLevel webhook when a lead moves to the "leadpool" pipeline stage
// Auto-prices the lead using Facebook CPL × markup, saves as pending in Firestore
// Then sends admin an email notification to approve
import https from 'https';
import crypto from 'crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-hl-signature',
  'Content-Type': 'application/json',
};

// ── FIREBASE ──────────────────────────────────────────────────
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

async function fsGet(collection, docId) {
  const t   = await getFirebaseToken();
  const doc = await fsHttp('GET',`${BASE()}/${collection}/${docId}`,null,t);
  if (!doc.fields) return null;
  const o={};
  for (const [k,v] of Object.entries(doc.fields)) o[k]=fromFS(v);
  return o;
}

async function fsSet(collection, docId, data) {
  const t      = await getFirebaseToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return fsHttp('PATCH',`${BASE()}/${collection}/${docId}`,{fields},t);
}

// ── EMAIL NOTIFICATION ────────────────────────────────────────
async function sendAdminEmail(lead, price, approveUrl) {
  try {
    const { createTransport } = await import('nodemailer');
    const t = createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});
    await t.sendMail({
      from: `"AstroAI Platform" <${process.env.GMAIL_USER}>`,
      to:   process.env.GMAIL_USER,
      subject: `🎯 New Lead Pool Lead — ${lead.businessName} (${lead.service})`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#0d1117;color:#eef2f7;border-radius:12px">
          <h2 style="color:#00d9a3;margin-bottom:4px">🎯 New Lead Ready for Review</h2>
          <p style="color:#6b7a99;margin-bottom:24px">A HighLevel lead moved to the Lead Pool stage</p>
          
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            <tr><td style="padding:8px 0;color:#6b7a99;font-size:.85rem">Business</td><td style="padding:8px 0;font-weight:600">${lead.businessName}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7a99;font-size:.85rem">Contact</td><td style="padding:8px 0">${lead.contactName}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7a99;font-size:.85rem">Phone</td><td style="padding:8px 0">${lead.phone}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7a99;font-size:.85rem">Email</td><td style="padding:8px 0">${lead.email}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7a99;font-size:.85rem">Service</td><td style="padding:8px 0">${lead.service}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7a99;font-size:.85rem">Location</td><td style="padding:8px 0">${lead.location}</td></tr>
            <tr><td style="padding:8px 0;color:#6b7a99;font-size:.85rem">Auto-price</td><td style="padding:8px 0;color:#00d9a3;font-weight:700;font-size:1.1rem">$${price}</td></tr>
          </table>

          <p style="margin-bottom:16px;color:#6b7a99;font-size:.85rem">Based on your 7-day Facebook CPL × 2.5x markup. You can change the price in the admin dashboard.</p>

          <a href="${approveUrl}" style="display:inline-block;padding:14px 28px;background:#00d9a3;color:#06070d;border-radius:8px;text-decoration:none;font-weight:700;font-size:.9rem">✅ Approve & Go Live →</a>
          
          <p style="margin-top:16px;font-size:.8rem;color:#555">Or visit <a href="https://marketingplan.astroaibots.com/admin" style="color:#00d9a3">Admin Dashboard</a> to review and adjust pricing.</p>
        </div>
      `,
    });
    console.log('[hl-webhook] Admin email sent');
  } catch(e) {
    console.error('[hl-webhook] Email failed:', e.message);
  }
}

// ── HANDLER ───────────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', {status:200,headers:CORS});
  if (req.method !== 'POST')   return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  console.log('[hl-webhook] Received:', JSON.stringify(body).slice(0,500));

  // HighLevel sends different formats — handle both
  // Format 1: {type, contact_id, pipeline_stage_name, contact: {...}}
  // Format 2: {event, data: {contact: {...}, pipeline: {...}}}
  const stageName = (
    body.pipeline_stage_name ||
    body.stage?.name ||
    body.data?.pipeline?.stage?.name ||
    body.pipelineStageName ||
    ''
  ).toLowerCase().replace(/\s+/g,'-');

  console.log('[hl-webhook] Stage:', stageName);

  // Only process "leadpool" stage (case insensitive, spaces or hyphens)
  if (!stageName.includes('leadpool') && !stageName.includes('lead-pool') && !stageName.includes('lead pool')) {
    console.log('[hl-webhook] Not the leadpool stage — ignoring');
    return new Response(JSON.stringify({success:true, message:'Stage not leadpool — ignored'}),{status:200,headers:CORS});
  }

  // Extract contact info from various HL payload formats
  const contact = body.contact || body.data?.contact || body.contactData || {};
  const tags    = body.tags || body.data?.tags || contact.tags || [];
  const custom  = body.customFields || body.data?.customFields || contact.customFields || [];

  // Helper to get custom field value
  const getCustom = (keys) => {
    for (const k of (Array.isArray(keys)?keys:[keys])) {
      const f = custom.find(c => (c.name||c.fieldKey||'').toLowerCase().includes(k.toLowerCase()));
      if (f) return f.value||f.fieldValue||'';
    }
    return '';
  };

  const firstName   = contact.firstName || contact.first_name || body.firstName || '';
  const lastName    = contact.lastName  || contact.last_name  || body.lastName  || '';
  const fullName    = `${firstName} ${lastName}`.trim() || contact.name || contact.fullName || 'Unknown';
  const email       = contact.email     || body.email  || '';
  const phone       = contact.phone     || body.phone  || contact.phoneRaw || '';
  const companyName = contact.companyName || contact.company || getCustom(['business','company']) || fullName;
  const location    = contact.city ? `${contact.city}${contact.state?', '+contact.state:''}` : getCustom(['city','location','area']) || 'Location not specified';
  const service     = getCustom(['service','looking for','need','industry','marketing']) || tags[0] || 'Marketing Agency Services';
  const industry    = getCustom(['industry']) || '';
  const notes       = contact.notes || getCustom(['notes','comments']) || '';

  // Get current CPL from Firestore (saved by fb-cpl-sync)
  let suggestedPrice = 37; // fallback default
  try {
    const cplData = await fsGet('platform_config', 'fb_cpl');
    if (cplData && cplData.suggestedPrice) {
      suggestedPrice = Math.ceil(cplData.suggestedPrice);
      console.log(`[hl-webhook] Using FB CPL price: $${suggestedPrice}`);
    }
  } catch(e) {
    console.log('[hl-webhook] No CPL data found, using default $37');
  }

  // Build lead ID
  const leadId = companyName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)+'-hl-'+Date.now().toString(36);

  // Save lead as PENDING (not visible to agencies yet)
  const leadData = {
    businessName: companyName,
    contactName:  fullName,
    phone, email, location, service, industry, notes,
    price:      suggestedPrice,
    status:     'pending', // pending = in admin review queue
    claimedBy:  '', claimedAt: '', claimedByName: '',
    source:     'highlevel',
    hlContactId: contact.id || contact.contact_id || body.contact_id || '',
    createdAt:  new Date().toISOString(),
  };

  await fsSet('lead_pool', leadId, leadData);
  console.log(`[hl-webhook] Lead saved as pending: ${leadId}`);

  // Send admin email with one-click approve link
  const approveUrl = `https://marketingplan.astroaibots.com/api/admin/leads/approve?id=${leadId}&key=AstroAdmin2024!`;
  await sendAdminEmail(leadData, suggestedPrice, approveUrl);

  return new Response(JSON.stringify({success:true, leadId, price:suggestedPrice}),{status:200,headers:CORS});
};

export const config = { path: '/api/hl-webhook' };
