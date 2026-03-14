// netlify/functions/agency-update-client.js
const { fsGetSub, fsSetSub } = require('./_firebase');
const { verifyToken, unauth, err, ok, CORS } = require('./_auth');

const nodemailer = require('nodemailer');

async function sendNotification(agency, client, status, customMessage, customSubject) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });
    const brand = agency.brandName || agency.name || 'Astro AI';
    const color = agency.brandColor || '#00d9a3';
    const subject = customSubject || `Update on your campaign — ${brand}`;
    const message = customMessage || `Your campaign status has been updated to: ${status}`;
    await transporter.sendMail({
      from: `"${brand}" <${process.env.GMAIL_USER}>`,
      to: client.clientEmail,
      subject,
      html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
        <h2 style="color:${color}">${brand}</h2>
        <p>Hi ${client.firstName || client.clientName},</p>
        <p>${message}</p>
        <p style="color:#888;font-size:12px">Powered by Astro AI · ${brand}</p>
      </div>`,
    });
    return true;
  } catch(e) {
    console.error('[agency-update-client] Email failed:', e.message);
    return false;
  }
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return err('POST only', 405);

  const auth = await verifyToken(event);
  if (auth.error) return unauth(auth.error);

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON', 400); }

  const { agencyId, clientId, status, notify, notes, customMessage, customSubject, _delete, offer } = body;
  if (!agencyId || !clientId) return err('agencyId and clientId required', 400);
  if (!auth.isAdmin && agencyId !== auth.agencyId) return unauth('Forbidden');

  // Handle delete
  if (_delete) {
    try {
      const { fsDeleteSub } = require('./_firebase');
      await fsDeleteSub(agencyId, 'clients', clientId);
      return ok({ success: true });
    } catch(e) { return err(e.message); }
  }

  try {
    const { fsGet } = require('./_firebase');
    const client = await fsGetSub(agencyId, 'clients', clientId);
    if (!client) return err('Client not found', 404);

    const updated = {
      ...client,
      ...(status  ? { status, statusLabel: status, statusUpdated: new Date().toISOString() } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(offer !== undefined ? { offer: offer ? JSON.stringify(offer) : '' } : {}),
      updatedAt: new Date().toISOString(),
    };

    await fsSetSub(agencyId, 'clients', clientId, updated);

    let emailSent = false;
    if (notify && client.clientEmail) {
      const agency = await fsGet('agencies', agencyId);
      if (agency) emailSent = await sendNotification(agency, client, status, customMessage, customSubject);
    }

    return ok({ success: true, emailSent });
  } catch(e) {
    return err(e.message);
  }
};
