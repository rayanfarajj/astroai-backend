// netlify/functions/agency-public.js
// GET /api/agency/public?id=agencyId — returns public branding config (no auth needed)
// Used by the onboarding form to load agency name, colors, terms, etc.
const { fsGet } = require('./_firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const agencyId = new URL(req.url).searchParams.get('id');
  if (!agencyId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id required' }) };

  try {
    const agency = await fsGet('agencies', agencyId);
    if (!agency || agency.status === 'suspended') {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Agency not found' }) };
    }

    // Only return public-safe fields
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      agencyId:        agency.agencyId || agencyId,
      name:            agency.name,
      brandName:       agency.brandName || agency.name,
      brandColor:      agency.brandColor || '#00d9a3',
      brandLogo:       agency.brandLogo || '',
      onboardingTitle: agency.onboardingTitle || `${agency.name} — Get Your AI Marketing Plan`,
      welcomeMsg:      agency.welcomeMsg || '',
      termsText:       agency.termsText || '',
      termsUrl:        agency.termsUrl  || '',
      plan:            agency.plan,
    }) };

  } catch(e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
