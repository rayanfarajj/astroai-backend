// netlify/functions/agency-settings.js
// GET  /api/agency/settings?token=X  — get agency config
// POST /api/agency/settings           — update agency config
const { fsGet, fsSet } = require('./_firebase');
const { verifyToken, unauth, err, ok, CORS } = require('./_auth');

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const auth = await verifyToken(req);
  if (auth.error) return unauth(auth.error);

  const agencyId = req.method === 'POST'
    ? (await req.json().catch(() => ({}))).agencyId || auth.agencyId
    : new URL(req.url).searchParams.get('agencyId') || auth.agencyId;

  // Non-admins can only access their own agency
  if (!auth.isAdmin && agencyId !== auth.agencyId) return unauth('Forbidden');

  if (req.method === 'GET') {
    try {
      const agency = await fsGet('agencies', agencyId);
      if (!agency) return err('Agency not found', 404);
      // Remove sensitive fields
      delete agency.passwordHash;
      return ok({ agency });
    } catch(e) { return err(e.message); }
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return err('Invalid JSON', 400); }

    const allowed = [
      'name','brandName','brandColor','brandLogo',
      'termsUrl','termsText','welcomeMsg','onboardingTitle',
      'phone','website','ownerName',
    ];
    const updates = {};
    allowed.forEach(k => { if (body[k] !== undefined) updates[k] = body[k]; });

    if (Object.keys(updates).length === 0) return err('No valid fields to update', 400);

    try {
      const current = await fsGet('agencies', agencyId);
      if (!current) return err('Agency not found', 404);
      await fsSet('agencies', agencyId, { ...current, ...updates });
      return ok({ success: true, updated: Object.keys(updates) });
    } catch(e) { return err(e.message); }
  }

  return err('Method not allowed', 405);
};

export const config = { path: '/api/agency/settings' };
