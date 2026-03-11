// netlify/functions/send-pdf.js
// Receives base64 PDF + client metadata, emails it to owner via Gmail/nodemailer

const nodemailer = require('nodemailer');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

exports.handler = async (event) => {
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    pdfBase64,
    filename,
    clientName,
    clientBusiness,
    clientEmail,
    clientPhone,
    signedAt,
    clientIP,
    docRef,
    accessMethod,
    adPlatforms,
    adBudget,
  } = body;

  if (!pdfBase64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No PDF provided' }) };
  }

  // ── Gmail transporter ─────────────────────────────────
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,  // e.g. rayan@farajcorp.com
      pass: process.env.GMAIL_PASS,  // Gmail App Password (16 chars, no spaces)
    },
  });

  const emailBody = `
New onboarding authorization signed and submitted.

────────────────────────────────
CLIENT DETAILS
────────────────────────────────
Name:         ${clientName || 'N/A'}
Business:     ${clientBusiness || 'N/A'}
Email:        ${clientEmail || 'N/A'}
Phone:        ${clientPhone || 'N/A'}

────────────────────────────────
AUTHORIZATION RECORD
────────────────────────────────
Signed At:    ${signedAt || 'N/A'}
IP Address:   ${clientIP || 'N/A'}
Doc Ref:      ${docRef || 'N/A'}

────────────────────────────────
CAMPAIGN INFO
────────────────────────────────
Access Method:  ${accessMethod || 'N/A'}
Ad Platforms:   ${adPlatforms || 'N/A'}
Ad Budget:      ${adBudget || 'N/A'}

────────────────────────────────
The signed authorization PDF is attached.
────────────────────────────────

Astro A.I. Marketing Platform
`.trim();

  const mailOptions = {
    from:    `"Astro A.I. Onboarding" <${process.env.GMAIL_USER}>`,
    to:      'rayan@farajcorp.com',
    subject: `New Onboarding Signed — ${clientName || 'Unknown'} (${clientBusiness || 'Unknown'})`,
    text:    emailBody,
    attachments: [
      {
        filename:    filename || 'AstroAI_Authorization.pdf',
        content:     pdfBase64,
        encoding:    'base64',
        contentType: 'application/pdf',
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true, message: 'PDF emailed successfully' }),
    };
  } catch (err) {
    console.error('Email send error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Failed to send email', details: err.message }),
    };
  }
};
