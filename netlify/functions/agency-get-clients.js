// netlify/functions/agency-get-clients.js
// GET /api/agency/clients?agencyId=X&token=Y
const { fsListSub, parseJSON } = require('./_firebase');
const { verifyToken, unauth, err, ok, CORS } = require('./_auth');

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const auth = await verifyToken(req);
  if (auth.error) return unauth(auth.error);

  const agencyId = new URL(req.url).searchParams.get('agencyId') || auth.agencyId;
  if (!auth.isAdmin && agencyId !== auth.agencyId) return unauth('Forbidden');

  try {
    const docs = await fsListSub(agencyId, 'clients');
    const clients = docs
      .map(c => parseJSON(c, 'dashboardJSON'))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return ok({ clients });
  } catch(e) {
    return err(e.message);
  }
};

export const config = { path: '/api/agency/clients' };
