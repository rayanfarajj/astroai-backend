// netlify/functions/agency-update-client.js
// POST /api/agency/update-client
const nodemailer  = require('nodemailer');
const https       = require('https');
const { fsGetSub, fsSetSub, fsGet, parseJSON } = require('./_firebase');
const { verifyToken, unauth, err, ok, CORS }   = require('./_auth');

const STATUS_LABELS = {
  new: '🆕 New', active: '📋 Plan Ready', launched: '🚀 Campaign Live', paused: '⏸ Paused', completed: '✅ Completed',
};

async function sendEmail(agency, client, subject, html) {
  // Always uses shared platform keys (Tier 1 / shared-keys model)
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
  const fromName = agency.brandName || agency.name || 'Astro AI';
  await transporter.sendMail({
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to: client.clientEmail,
    subject,
    html,
  });
}

async function sendSMS(to, message) {
  const hlKey      = process.env.HL_API_KEY;
  const locationId = process.env.HL_LOCATION_ID;
  if (!hlKey || !locationId) return;
  const body = JSON.stringify({ type:'SMS', message, toNumber: to, fromNumber:'+12107260680', locationId });
  await new Promise((res, rej) => {
    const req = https.request({ hostname:'services.leadconnectorhq.com', path:'/conversations/messages', method:'POST', headers:{'Authorization':'Bearer '+hlKey,'Content-Type':'application/json','Version':'2021-04-15','Content-Length':Buffer.byteLength(body)} }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(d)); });
    req.on('error', rej); req.write(body); req.end();
  });
}

function buildStatusEmail(agency, client, newStatus) {
  const portalUrl = `https://marketingplan.astroaibots.com/onboard/portal?a=${client.agencyId}&s=${client._id}`;
  const brand     = agency.brandName || agency.name || 'Astro AI';
  const color     = agency.brandColor || '#00d9a3';
  const msgs = {
    active:    { sub:`Your Marketing Plan is Ready!`,    body:`Great news — your AI marketing plan has been created. <a href="${client.dashboardUrl}">View your plan</a> or <a href="${portalUrl}">log into your portal</a>.` },
    launched:  { sub:`Your Campaign is Live! 🚀`,        body:`Your campaign just went live. We'll send you performance updates regularly. <a href="${portalUrl}">View your portal</a>.` },
    paused:    { sub:`Campaign Update`,                  body:`Your campaign has been temporarily paused. We'll be in touch shortly with next steps.` },
    completed: { sub:`Campaign Complete ✅`,              body:`Your campaign has completed. Thank you for working with ${brand}! <a href="${portalUrl}">View your final report</a>.` },
  };
  const m = msgs[newStatus];
  if (!m) return null;
  return {
    subject: m.sub,
    html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
      <h2 style="color:${color}">${brand}</h2>
      <p>Hi ${client.clientName || 'there'},</p>
      <p>${m.body}</p>
      <p style="color:#888;font-size:12px">Powered by Astro AI</p>
    </div>`,
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return err('POST only', 405);

  const auth = await verifyToken(req);
  if (auth.error) return unauth(auth.error);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON', 400); }

  const { agencyId, clientId, status, notes, notify, customMessage, customSubject, messageType } = body;
  if (!agencyId || !clientId) return err('agencyId and clientId required', 400);
  if (!auth.isAdmin && agencyId !== auth.agencyId) return unauth('Forbidden');

  try {
    const client  = await fsGetSub(agencyId, 'clients', clientId);
    if (!client) return err('Client not found', 404);
    const agency  = await fsGet('agencies', agencyId);

    // Apply updates
    const updates = { ...client };
    if (status) {
      updates.status       = status;
      updates.statusLabel  = STATUS_LABELS[status] || status;
      updates.statusUpdated = new Date().toISOString();
    }
    if (notes !== undefined) updates.notes = notes;
    await fsSetSub(agencyId, 'clients', clientId, updates);

    let emailSent = false, smsSent = false;

    if (notify && client.clientEmail) {
      try {
        let subject, html;
        if (customMessage) {
          subject = customSubject || `Message from ${agency?.brandName || agency?.name || 'Your Agency'}`;
          html    = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px"><p>${customMessage.replace(/\n/g,'<br>')}</p></div>`;
        } else {
          const tpl = buildStatusEmail(agency, { ...client, agencyId }, status);
          if (tpl) { subject = tpl.subject; html = tpl.html; }
        }

        if (subject && html && messageType !== 'sms') {
          await sendEmail(agency, client, subject, html);
          emailSent = true;
        }
        if (client.phone && messageType !== 'email') {
          const smsMsg = customMessage || `${agency?.brandName||'Your Agency'}: ${STATUS_LABELS[status]||'Status updated'}. Visit your portal: https://marketingplan.astroaibots.com/onboard/portal?a=${agencyId}&s=${clientId}`;
          await sendSMS(client.phone, smsMsg);
          smsSent = true;
        }
      } catch(e) { console.error('[agency-update-client] notify failed:', e.message); }
    }

    return ok({ success: true, emailSent, smsSent });
  } catch(e) {
    return err(e.message);
  }
};
