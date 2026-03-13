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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const agencyId = new URL(req.url).searchParams.get('id');
  if (!agencyId) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: CORS });

  try {
    const agency = await fsGet('agencies', agencyId);
    if (!agency || agency.status === 'suspended') {
      return new Response(JSON.stringify({ error: 'Agency not found' }), { status: 404, headers: CORS });
    }

    // Only return public-safe fields
    return new Response(JSON.stringify({
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
    }), { status: 200, headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/agency/public' };
