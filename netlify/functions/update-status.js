// netlify/functions/update-status.js
const https = require('https');
const nodemailer = require('nodemailer');

// ── Status config — emoji, label, custom SMS + email per status ──────────────
const STATUS_CONFIG = {
  new: {
    label: '🆕 New',
    sms: (c) => `Hi ${c.clientName}! Welcome to Astro AI Marketing 🚀 We've received your onboarding for ${c.businessName}. Your Marketing Command Center is ready: ${c.dashboardUrl} — Your coordinator will be in touch shortly!`,
    emailSubject: (c) => `Welcome to Astro AI — ${c.businessName} is officially onboarded!`,
    emailBody: (c) => `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;">
        <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center;">
          <div style="font-size:2rem;margin-bottom:8px;">🚀</div>
          <h1 style="color:#fff;font-size:1.3rem;margin:0;">Welcome to Astro AI Marketing!</h1>
          <p style="color:rgba(255,255,255,0.65);font-size:0.85rem;margin:8px 0 0;">Your marketing machine is warming up</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e5e7eb;">
          <p style="font-size:1rem;color:#1a1d2e;">Hi <strong>${c.clientName}</strong>,</p>
          <p style="color:#4b5563;line-height:1.7;">We've officially onboarded <strong>${c.businessName}</strong> into the Astro AI Marketing system. Your personalized Marketing Command Center has been generated and is ready for you to explore.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${c.dashboardUrl}" style="background:#f97316;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">View Your Dashboard →</a>
          </div>
          <p style="color:#4b5563;line-height:1.7;">Your dedicated coordinator will reach out shortly to walk you through your strategy and get your first campaign launched.</p>
          <p style="color:#4b5563;">Talk soon,<br><strong>The Astro AI Team</strong></p>
        </div>
      </div>`,
  },

  active: {
    label: '📋 Plan Ready',
    sms: (c) => `Hi ${c.clientName}! Great news — your marketing plan for ${c.businessName} is finalized and ready 📋 We're now preparing your campaign launch. Questions? Reply anytime!`,
    emailSubject: (c) => `Your Marketing Plan is Finalized — ${c.businessName}`,
    emailBody: (c) => `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;">
        <div style="background:#1e3a5f;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center;">
          <div style="font-size:2rem;margin-bottom:8px;">📋</div>
          <h1 style="color:#fff;font-size:1.3rem;margin:0;">Your Plan is Finalized!</h1>
          <p style="color:rgba(255,255,255,0.65);font-size:0.85rem;margin:8px 0 0;">${c.businessName}</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e5e7eb;">
          <p style="font-size:1rem;color:#1a1d2e;">Hi <strong>${c.clientName}</strong>,</p>
          <p style="color:#4b5563;line-height:1.7;">Your AI-generated marketing strategy for <strong>${c.businessName}</strong> is finalized. This includes your custom ad angles, targeting strategy, 8-week roadmap, and lead qualification script — all tailored to your business.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${c.dashboardUrl}" style="background:#f97316;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">Review Your Full Strategy →</a>
          </div>
          <p style="color:#4b5563;line-height:1.7;">We're now moving into campaign setup. You'll hear from us once everything is live!</p>
          <p style="color:#4b5563;">— <strong>The Astro AI Team</strong></p>
        </div>
      </div>`,
  },

  launched: {
    label: '🚀 Campaign Live',
    sms: (c) => `🚀 ${c.clientName}, your ${c.businessName} campaign just went LIVE on ${c.adPlatforms||'your ad platforms'}! Your ads are running. We'll send you performance updates as results come in. Let's get some leads!`,
    emailSubject: (c) => `🚀 Your Campaign is LIVE — ${c.businessName}`,
    emailBody: (c) => `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;">
        <div style="background:linear-gradient(135deg,#1e3a5f,#2d5282);border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center;">
          <div style="font-size:2.5rem;margin-bottom:8px;">🚀</div>
          <h1 style="color:#fff;font-size:1.4rem;margin:0;">Your Campaign is LIVE!</h1>
          <p style="color:rgba(255,255,255,0.65);font-size:0.85rem;margin:8px 0 0;">${c.businessName} — Ads are running now</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e5e7eb;">
          <p style="font-size:1rem;color:#1a1d2e;">Hi <strong>${c.clientName}</strong>,</p>
          <p style="color:#4b5563;line-height:1.7;"><strong>Big moment</strong> — your ads for <strong>${c.businessName}</strong> are officially live on ${c.adPlatforms||'your ad platforms'}! Your custom ad angles, targeting, and copy are all active and working to bring you leads.</p>
          <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px 20px;margin:20px 0;">
            <p style="color:#065f46;font-size:0.85rem;margin:0;font-weight:600;">✅ What's running:</p>
            <p style="color:#065f46;font-size:0.82rem;margin:8px 0 0;line-height:1.6;">Your AI-generated ad copy across 5 angles is live. We'll monitor performance and optimize over the coming weeks.</p>
          </div>
          <div style="text-align:center;margin:28px 0;">
            <a href="${c.dashboardUrl}" style="background:#f97316;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">View Your Dashboard →</a>
          </div>
          <p style="color:#4b5563;">— <strong>The Astro AI Team</strong></p>
        </div>
      </div>`,
  },

  paused: {
    label: '⏸ Paused',
    sms: (c) => `Hi ${c.clientName}, your ${c.businessName} campaign has been temporarily paused ⏸ Our team is making optimizations. We'll notify you the moment it's back live. Thank you for your patience!`,
    emailSubject: (c) => `Campaign Temporarily Paused — ${c.businessName}`,
    emailBody: (c) => `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;">
        <div style="background:#92400e;border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center;">
          <div style="font-size:2rem;margin-bottom:8px;">⏸</div>
          <h1 style="color:#fff;font-size:1.3rem;margin:0;">Campaign Temporarily Paused</h1>
          <p style="color:rgba(255,255,255,0.65);font-size:0.85rem;margin:8px 0 0;">${c.businessName}</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e5e7eb;">
          <p style="font-size:1rem;color:#1a1d2e;">Hi <strong>${c.clientName}</strong>,</p>
          <p style="color:#4b5563;line-height:1.7;">We've temporarily paused your campaign for <strong>${c.businessName}</strong> while our team makes performance optimizations. This is a normal part of our process to ensure you're getting the best results possible.</p>
          <p style="color:#4b5563;line-height:1.7;">You don't need to do anything — we'll notify you as soon as your campaign is back live. If you have questions in the meantime, just reply to this email.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${c.dashboardUrl}" style="background:#1e3a5f;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">View Your Dashboard →</a>
          </div>
          <p style="color:#4b5563;">— <strong>The Astro AI Team</strong></p>
        </div>
      </div>`,
  },

  completed: {
    label: '✅ Completed',
    sms: (c) => `Hi ${c.clientName}! We've wrapped up your campaign cycle for ${c.businessName} ✅ It's been a pleasure working with you. Your dashboard has a full summary of everything we built. Ready to scale? Let's talk! 👉 https://link.astroaibots.com/widget/booking/fp48fbNtkGyPlqJJWEUh`,
    emailSubject: (c) => `Campaign Complete — Here's What We Built for ${c.businessName} 🎉`,
    emailBody: (c) => `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#f8fafc;padding:32px;">
        <div style="background:linear-gradient(135deg,#065f46,#047857);border-radius:12px;padding:28px 32px;margin-bottom:24px;text-align:center;">
          <div style="font-size:2.5rem;margin-bottom:8px;">🎉</div>
          <h1 style="color:#fff;font-size:1.4rem;margin:0;">Campaign Complete!</h1>
          <p style="color:rgba(255,255,255,0.65);font-size:0.85rem;margin:8px 0 0;">${c.businessName} — Great work!</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e5e7eb;">
          <p style="font-size:1rem;color:#1a1d2e;">Hi <strong>${c.clientName}</strong>,</p>
          <p style="color:#4b5563;line-height:1.7;">We've officially wrapped up this campaign cycle for <strong>${c.businessName}</strong>. It's been a pleasure working with you. Your Marketing Command Center has a full record of everything — your ad copy, strategy, roadmap, and targeting — available any time.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${c.dashboardUrl}" style="background:#f97316;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.9rem;">View Full Campaign Summary →</a>
          </div>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;margin:20px 0;text-align:center;">
            <p style="color:#1e3a5f;font-size:0.85rem;font-weight:600;margin:0 0 8px;">Ready to scale to the next level?</p>
            <a href="https://link.astroaibots.com/widget/booking/fp48fbNtkGyPlqJJWEUh" style="background:#1e3a5f;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:0.8rem;font-weight:600;">Book Your Strategy Call →</a>
          </div>
          <p style="color:#4b5563;">Thank you for trusting Astro AI with your business.<br><strong>— The Astro AI Team</strong></p>
        </div>
      </div>`,
  },
};

// ── Firebase helpers (same pattern as process-plan.js) ───────────────────────
function getFirebaseToken() {
  return new Promise((resolve, reject) => {
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const crypto = require('crypto');
    function b64u(s) { return Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); }
    const now = Math.floor(Date.now() / 1000);
    const hdr = b64u(JSON.stringify({ alg:'RS256', typ:'JWT' }));
    const pay = b64u(JSON.stringify({ iss:clientEmail, sub:clientEmail, aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/datastore' }));
    const sig = b64u(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(privateKey));
    const jwt = hdr+'.'+pay+'.'+sig;
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request({ hostname:'oauth2.googleapis.com', path:'/token', method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error('No token: '+d)); });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function firestoreGet(token, slug) {
  return new Promise((resolve, reject) => {
    const path = `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/clients/${slug}`;
    const req = https.request({ hostname:'firestore.googleapis.com', path, method:'GET', headers:{'Authorization':'Bearer '+token} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)}; });
    });
    req.on('error',reject); req.end();
  });
}

function firestorePatch(token, slug, fields) {
  return new Promise((resolve, reject) => {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const fieldMask = Object.keys(fields).map(k=>`updateMask.fieldPaths=${k}`).join('&');
    const path = `/v1/projects/${projectId}/databases/(default)/documents/clients/${slug}?${fieldMask}`;
    const fsFields = {};
    Object.entries(fields).forEach(([k,v]) => { fsFields[k] = { stringValue: String(v) }; });
    const body = JSON.stringify({ fields: fsFields });
    const req = https.request({ hostname:'firestore.googleapis.com', path, method:'PATCH', headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)}; });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

function hlRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': process.env.HL_API_KEY,  // LeadConnector key — no "Bearer" prefix
      'Accept':        'application/json',
      'Version':       '2021-07-28',
    };
    if (bodyStr) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }
    const req = https.request({ hostname: 'services.leadconnectorhq.com', path, method, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        console.log('[HL] ' + method + ' ' + path + ' => HTTP ' + res.statusCode + ' | ' + d.slice(0,400));
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', e => { console.error('[HL] request error:', e.message); reject(e); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function sendHL_SMS(toPhone, message) {
  let p = (toPhone || '').replace(/[\s\-().]/g, '');
  if (!p.startsWith('+')) p = '+1' + p.replace(/^1/, '');
  console.log('[HL SMS] sending to:', p);

  // Search for contact
  const search = await hlRequest('GET', '/contacts/?locationId=' + process.env.HL_LOCATION_ID + '&query=' + encodeURIComponent(p));
  let contacts = search.body?.contacts || [];
  console.log('[HL SMS] contacts found:', contacts.length, '| HTTP:', search.status);

  // Auto-create contact if not found
  if (!contacts.length) {
    console.log('[HL SMS] creating contact on the fly');
    const created = await hlRequest('POST', '/contacts/', {
      locationId: process.env.HL_LOCATION_ID,
      phone: p,
      tags: ['astroai-client'],
    });
    console.log('[HL SMS] create contact HTTP:', created.status);
    if (created.body?.contact?.id) {
      contacts = [created.body.contact];
    } else {
      throw new Error('Could not find or create HL contact for: ' + p);
    }
  }

  const contactId = contacts[0].id;
  console.log('[HL SMS] contactId:', contactId);

  // Send SMS
  const smsResp = await hlRequest('POST', '/conversations/messages', {
    type: 'SMS',
    contactId,
    message,
  });

  console.log('[HL SMS] send result HTTP:', smsResp.status);
  if (smsResp.status >= 400) {
    throw new Error('HL SMS failed HTTP ' + smsResp.status + ': ' + JSON.stringify(smsResp.body).slice(0, 200));
  }
  return smsResp.body;
}

function sendEmail(to, subject, html) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
  return transporter.sendMail({
    from: `"Astro AI Marketing" <${process.env.GMAIL_USER}>`,
    to, subject, html,
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async (req) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

  // Simple internal key check
  if (req.headers.get('x-internal-key') !== process.env.INTERNAL_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const { slug, status, notify } = await req.json();
    if (!slug || !status) return new Response(JSON.stringify({ error: 'slug and status required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    if (!STATUS_CONFIG[status]) return new Response(JSON.stringify({ error: 'Invalid status' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // Get Firebase token + client record
    const token = await getFirebaseToken();
    const doc   = await firestoreGet(token, slug);
    if (!doc.fields) return new Response(JSON.stringify({ error: 'Client not found' }), { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const get = (k) => doc.fields[k]?.stringValue || '';
    const client = {
      slug,
      clientName:   get('clientName'),
      businessName: get('businessName'),
      clientEmail:  get('clientEmail'),
      phone:        get('phone'),
      adPlatforms:  get('adPlatforms'),
      dashboardUrl: get('dashboardUrl'),
    };

    // Update Firestore
    await firestorePatch(token, slug, {
      status,
      statusLabel:   STATUS_CONFIG[status].label,
      statusUpdated: new Date().toISOString(),
    });
    console.log(`[update-status] Firestore updated: ${slug} → ${status}`);

    const results = { firestoreUpdated: true, emailSent: false, smsSent: false };

    // Fire notifications if requested
    if (notify !== false) {
      const cfg = STATUS_CONFIG[status];

      // Email
      if (client.clientEmail) {
        try {
          await sendEmail(client.clientEmail, cfg.emailSubject(client), cfg.emailBody(client));
          results.emailSent = true;
          console.log(`[update-status] Email sent to ${client.clientEmail}`);
        } catch(e) { console.error('[update-status] Email failed:', e.message); }
      }

      // SMS via HighLevel
      if (client.phone) {
        try {
          await sendHL_SMS(client.phone, cfg.sms(client));
          results.smsSent = true;
          console.log(`[update-status] SMS sent to ${client.phone}`);
        } catch(e) { console.error('[update-status] SMS failed:', e.message); }
      }
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[update-status] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};

export const config = {
  path: '/api/update-status',
};
