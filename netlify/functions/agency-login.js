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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { agencyId, password } = body;
  if (!agencyId || !password) {
    return new Response(JSON.stringify({ error: 'agencyId and password required' }), { status: 400, headers: CORS });
  }

  try {
    const agency = await fsGet('agencies', agencyId);
    if (!agency) return new Response(JSON.stringify({ error: 'Agency not found' }), { status: 404, headers: CORS });
    if (agency.passwordHash !== hashPw(password)) {
      return new Response(JSON.stringify({ error: 'Incorrect password' }), { status: 401, headers: CORS });
    }

    // Issue a simple session token (stored in Firestore, expires 7 days)
    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await fsSet('agency_sessions', token, { agencyId, expiresAt, createdAt: new Date().toISOString() });

    return new Response(JSON.stringify({
      success: true,
      token,
      agencyId,
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
    }), { status: 200, headers: CORS });

  } catch(err) {
    console.error('[agency-login]', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/agency/login' };
