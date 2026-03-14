// netlify/functions/agency-login.js
// POST /api/agency/login
const crypto = require('crypto');
const { fsList, fsSet, fsGet } = require('./_firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function hashPw(pw) {
  return crypto.createHash('sha256').update(pw + 'astroai-saas-salt').digest('hex');
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { agencyId, email, password } = body;
  if ((!agencyId && !email) || !password) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'email/agencyId and password required' }) };
  }

  try {
    let agency = null;
    let resolvedAgencyId = agencyId;

    if (agencyId) {
      // Login by agencyId (direct lookup)
      agency = await fsGet('agencies', agencyId);
    } else {
      // Login by email — scan agencies for matching ownerEmail
      const all = await fsList('agencies');
      const match = all.find(a => a.ownerEmail && a.ownerEmail.toLowerCase() === email.toLowerCase());
      if (match) {
        agency = match;
        resolvedAgencyId = match.agencyId || match.id;
      }
    }

    if (!agency) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Agency not found' }) };
    if (agency.passwordHash !== hashPw(password)) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Incorrect password' }) };
    }

    // Issue session token (7-day expiry)
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await fsSet('agency_sessions', token, { agencyId: resolvedAgencyId, expiresAt, createdAt: new Date().toISOString() });

    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      success: true,
      token,
      agencyId: resolvedAgencyId,
      agency: {
        name:            agency.name,
        ownerName:       agency.ownerName,
        ownerEmail:      agency.ownerEmail,
        plan:            agency.plan,
        brandColor:      agency.brandColor,
        brandName:       agency.brandName,
        brandLogo:       agency.brandLogo,
        onboardingTitle: agency.onboardingTitle,
        welcomeMsg:      agency.welcomeMsg,
        termsText:       agency.termsText,
        termsUrl:        agency.termsUrl,
      },
    }) };

  } catch(err) {
    console.error('[agency-login]', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

