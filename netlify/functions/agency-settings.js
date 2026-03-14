// netlify/functions/agency-settings.js
// GET  /api/agency/settings?token=X  — get agency config
// POST /api/agency/settings           — update agency config
const { fsGet, fsSet } = require('./_firebase');
const { verifyToken, unauth, err, ok, CORS } = require('./_auth');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const auth = await verifyToken(req);
  if (auth.error) return unauth(auth.error);

  const agencyId = event.httpMethod === 'POST'
    ? (JSON.parse(event.body || '{}').catch(() => ({}))).agencyId || auth.agencyId
    : new URL(req.url).searchParams.get('agencyId') || auth.agencyId;

  // Non-admins can only access their own agency
  if (!auth.isAdmin && agencyId !== auth.agencyId) return unauth('Forbidden');

  if (event.httpMethod === 'GET') {
    try {
      const agency = await fsGet('agencies', agencyId);
      if (!agency) return err('Agency not found', 404);
      // Remove sensitive fields
      delete agency.passwordHash;
      return ok({ agency });
    } catch(e) { return err(e.message); }
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON', 400); }

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
