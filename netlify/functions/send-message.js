// netlify/functions/send-message.js
const nodemailer = require('nodemailer');
const https      = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendHL_SMS(toPhone, message, client) {
  return new Promise((resolve, reject) => {
    const webhookUrl = process.env.HL_WEBHOOK_URL;
    if (!webhookUrl) return resolve(null);
    let p = (toPhone||'').replace(/[\s\-().]/g,'');
    if (!p.startsWith('+')) p = '+1' + p.replace(/^1/,'');
    const bodyStr = JSON.stringify({
      phone: p, message,
      firstName: (client.clientName||'').split(' ')[0] || '',
      lastName:  (client.clientName||'').split(' ').slice(1).join(' ') || '',
      email: client.clientEmail || '',
      businessName: client.businessName || '',
    });
    const url = new URL(webhookUrl);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode})); });
    req.on('error', reject);
    req.write(bodyStr); req.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { slug, clientName, businessName, clientEmail, subject, message } = body;
  if (!message) return new Response(JSON.stringify({ error: 'message required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });

    const emailSubject = subject
      ? `💬 Client Message: ${subject} — ${businessName}`
      : `💬 New Message from ${businessName}`;

    await transporter.sendMail({
      from: `"Astro AI Portal" <${process.env.GMAIL_USER}>`,
      to:   'rayan@farajcorp.com',
      replyTo: clientEmail || process.env.GMAIL_USER,
      subject: emailSubject,
      html: `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#f8fafc;">
          <div style="background:#1e3a5f;border-radius:12px;padding:24px 32px;text-align:center;margin-bottom:20px;">
            <h1 style="color:#fff;font-size:1.1rem;margin:0;">💬 New Client Message</h1>
          </div>
          <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb;">
            <table style="width:100%;margin-bottom:20px;font-size:.85rem;">
              <tr><td style="color:#6b7280;padding:4px 0;width:100px">From:</td><td style="font-weight:600;color:#1a202c">${clientName} — ${businessName}</td></tr>
              <tr><td style="color:#6b7280;padding:4px 0">Email:</td><td style="color:#1a202c">${clientEmail||'N/A'}</td></tr>
              ${subject ? `<tr><td style="color:#6b7280;padding:4px 0">Subject:</td><td style="color:#1a202c">${subject}</td></tr>` : ''}
              <tr><td style="color:#6b7280;padding:4px 0">Slug:</td><td style="color:#1a202c">${slug}</td></tr>
            </table>
            <div style="background:#f8fafc;border-left:3px solid #f97316;border-radius:0 8px 8px 0;padding:16px 20px;font-size:.9rem;color:#1a202c;line-height:1.7;white-space:pre-wrap;">${message}</div>
            <p style="margin-top:16px;font-size:.78rem;color:#9ca3af;">Reply directly to this email to respond to ${clientName}.</p>
          </div>
        </div>`,
    });

    // Also send yourself an SMS notification
    try {
      await sendHL_SMS(
        '', // no client phone needed — this is notifying YOU
        `💬 New message from ${clientName} (${businessName}): "${message.slice(0,100)}${message.length>100?'...':''}"`,
        { clientName, businessName, clientEmail }
      );
    } catch(e) { console.warn('[send-message] SMS notify failed:', e.message); }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch(e) {
    console.error('[send-message] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/send-message' };
