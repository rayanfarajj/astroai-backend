// netlify/functions/agency-services.js
const { fsListSub, fsSetSub, fsDeleteSub } = require('./_firebase');
const { verifyToken, unauth, err, ok, CORS } = require('./_auth');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const auth = await verifyToken(event);
  if (auth.error) return unauth(auth.error);

  const agencyId = auth.agencyId;
  const qs       = event.queryStringParameters || {};
  const clientId = qs.clientId || '';
  if (!clientId) return err('clientId required', 400);

  // Path inside agencies/{agencyId}/: clients/{clientId}/services
  const subPath = `clients/${clientId}/services`;

  // GET: list all services for this client
  if (event.httpMethod === 'GET') {
    try {
      const docs = await fsListSub(agencyId, subPath, 100);
      const services = docs
        .map(d => ({
          id:            d._id           || '',
          headline:      d.headline      || '',
          description:   d.description   || '',
          amount:        d.amount        || '',
          paymentStatus: d.paymentStatus || 'pending',
          orderDate:     d.orderDate     || '',
          orderStatus:   d.orderStatus   || 'pending',
          createdAt:     d.createdAt     || '',
        }))
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return ok({ success: true, services });
    } catch(e) { return err(e.message); }
  }

  // POST: save or delete
  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON', 400); }

    if (body.action === 'delete') {
      if (!body.serviceId) return err('serviceId required', 400);
      try {
        await fsDeleteSub(agencyId, subPath, body.serviceId);
        return ok({ success: true });
      } catch(e) { return err(e.message); }
    }

    // save (add or update)
    const serviceId = body.serviceId || ('svc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    const now = new Date().toISOString();
    const doc = {
      headline:      body.headline      || '',
      description:   body.description   || '',
      amount:        body.amount        || '',
      paymentStatus: body.paymentStatus || 'pending',
      orderDate:     body.orderDate     || now.slice(0, 10),
      orderStatus:   body.orderStatus   || 'pending',
      createdAt:     body.createdAt     || now,
    };
    try {
      await fsSetSub(agencyId, subPath, serviceId, doc);
      return ok({ success: true, serviceId });
    } catch(e) { return err(e.message); }
  }

  return err('Method not allowed', 405);
};
