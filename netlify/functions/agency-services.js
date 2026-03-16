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

  console.log('[svc] agencyId:', agencyId, 'clientId:', clientId, 'method:', event.httpMethod);

  if (!clientId) return err('clientId required', 400);

  const subPath = 'clients/' + clientId + '/services';
  console.log('[svc] subPath:', subPath);

  // GET: list services
  if (event.httpMethod === 'GET') {
    try {
      const docs = await fsListSub(agencyId, subPath, 100);
      console.log('[svc] GET docs count:', docs.length);
      const services = docs
        .map(function(d) {
          return {
            id:            d._id           || '',
            headline:      d.headline      || '',
            description:   d.description   || '',
            amount:        d.amount        || '',
            paymentStatus: d.paymentStatus || 'pending',
            orderDate:     d.orderDate     || '',
            orderStatus:   d.orderStatus   || 'pending',
            createdAt:     d.createdAt     || '',
          };
        })
        .sort(function(a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      return ok({ success: true, services: services });
    } catch(e) {
      console.error('[svc] GET error:', e.message);
      return err(e.message);
    }
  }

  // POST: save or delete
  if (event.httpMethod === 'POST') {
    var body;
    try { body = JSON.parse(event.body || '{}'); } catch(e) { return err('Invalid JSON', 400); }

    console.log('[svc] POST action:', body.action, 'serviceId:', body.serviceId);

    if (body.action === 'delete') {
      if (!body.serviceId) return err('serviceId required', 400);
      try {
        await fsDeleteSub(agencyId, subPath, body.serviceId);
        console.log('[svc] deleted:', body.serviceId);
        return ok({ success: true });
      } catch(e) {
        console.error('[svc] DELETE error:', e.message);
        return err(e.message);
      }
    }

    var serviceId = body.serviceId || ('svc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    var now = new Date().toISOString();
    var doc = {
      headline:      body.headline      || '',
      description:   body.description   || '',
      amount:        body.amount        || '',
      paymentStatus: body.paymentStatus || 'pending',
      orderDate:     body.orderDate     || now.slice(0, 10),
      orderStatus:   body.orderStatus   || 'pending',
      createdAt:     body.createdAt     || now,
    };

    console.log('[svc] saving serviceId:', serviceId, 'headline:', doc.headline);

    try {
      await fsSetSub(agencyId, subPath, serviceId, doc);
      console.log('[svc] saved OK');
      return ok({ success: true, serviceId: serviceId });
    } catch(e) {
      console.error('[svc] SAVE error:', e.message);
      return err(e.message);
    }
  }

  return err('Method not allowed', 405);
};
