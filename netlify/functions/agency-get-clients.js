// netlify/functions/agency-get-clients.js
const { fsListSub } = require('./_firebase');
const { verifyToken, unauth, err, ok } = require('./_auth');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: require('./_auth').CORS, body: '' };

  const auth = await verifyToken(event);
  if (auth.error) return unauth(auth.error);

  const agencyId = (event.queryStringParameters || {}).agencyId || auth.agencyId;
  if (!auth.isAdmin && agencyId !== auth.agencyId) return unauth('Forbidden');

  try {
    const docs = await fsListSub(agencyId, 'clients');
    const clients = docs
      .map(c => {
        // Parse dashboardJSON if it's a string
        if (c.dashboardJSON && typeof c.dashboardJSON === 'string') {
          try { c.dashboardJSON = JSON.parse(c.dashboardJSON); } catch(e) { c.dashboardJSON = {}; }
        }
        return c;
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return ok({ clients });
  } catch(e) {
    return err(e.message);
  }
};
