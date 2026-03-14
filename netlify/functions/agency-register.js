// netlify/functions/agency-register.js
// POST /api/agency/register — self-serve agency signup
const crypto = require('crypto');
const { fsGet, fsSet } = require('./_firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function hashPw(pw) {
  return crypto.createHash('sha256').update(pw + 'astroai-saas-salt').digest('hex');
}

async function sendWelcomeEmail(agency) {
  // Use shared Gmail via nodemailer
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
  const dashUrl = `https://marketingplan.astroaibots.com/agency-dashboard.html?a=${agency.agencyId}`;
  const onbUrl  = `https://marketingplan.astroaibots.com/onboard/${agency.agencyId}`;
  await transporter.sendMail({
    from: `"Astro AI" <${process.env.GMAIL_USER}>`,
    to: agency.ownerEmail,
    subject: `🚀 Welcome to Astro AI — Your Agency is Live!`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
        <h2 style="color:#00d9a3">Welcome, ${agency.ownerName}! 🎉</h2>
        <p>Your agency <strong>${agency.name}</strong> is live on Astro AI.</p>
        <p>Here are your links:</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr><td style="padding:10px;background:#f4f4f4;font-weight:600">Agency Dashboard</td><td style="padding:10px"><a href="${dashUrl}">${dashUrl}</a></td></tr>
          <tr><td style="padding:10px;background:#f4f4f4;font-weight:600">Client Onboarding Form</td><td style="padding:10px"><a href="${onbUrl}">${onbUrl}</a></td></tr>
          <tr><td style="padding:10px;background:#f4f4f4;font-weight:600">Agency Password</td><td style="padding:10px">${agency.plainPassword}</td></tr>
        </table>
        <p style="color:#888;font-size:12px">Share the onboarding form link with your clients. Log into your dashboard with your password to manage them.</p>
      </div>`,
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { agencyName, ownerName, ownerEmail, password, phone, website } = body;
  if (!agencyName || !ownerName || !ownerEmail || !password) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'agencyName, ownerName, ownerEmail and password are required' }) };
  }
  if (password.length < 8) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Password must be at least 8 characters' }) };
  }

  // Generate a unique agencyId
  const agencyId = slug(agencyName) + '-' + Date.now().toString(36);

  // Check email not already registered (scan top-level agencies)
  // (lightweight: just try to find by email in the doc ID pattern)
  // We store agencies by agencyId, so just proceed — email uniqueness enforced client-side for now

  const agencyData = {
    agencyId,
    name:          agencyName,
    ownerName,
    ownerEmail,
    phone:         phone    || '',
    website:       website  || '',
    passwordHash:  hashPw(password),
    plan:          'starter',
    status:        'active',
    clientCount:   0,
    createdAt:     new Date().toISOString(),
    // Branding defaults
    brandName:     agencyName,
    brandColor:    '#00d9a3',
    brandLogo:     '',
    // Terms
    termsUrl:      '',
    termsText:     `By submitting this form, you authorize ${agencyName} to create and manage digital marketing campaigns on your behalf.`,
    // Settings
    welcomeMsg:    `Thank you for choosing ${agencyName}! We're excited to grow your business.`,
    onboardingTitle: `${agencyName} — Get Your AI Marketing Plan`,
  };

  try {
    await fsSet('agencies', agencyId, agencyData);

    // Send welcome email (non-blocking)
    sendWelcomeEmail({ ...agencyData, plainPassword: password }).catch(e => console.error('Welcome email failed:', e.message));

    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      success: true,
      agencyId,
      dashboardUrl: `https://marketingplan.astroaibots.com/agency-dashboard.html?a=${agencyId}`,
      onboardingUrl: `https://marketingplan.astroaibots.com/onboard/${agencyId}`,
    }) };

  } catch(err) {
    console.error('[agency-register]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

