// _auth.js — shared auth middleware (CommonJS event format)
const { fsGet } = require('./_firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-agency-token, x-internal-key',
  'Content-Type': 'application/json',
};

async function verifyToken(event) {
  const h = event.headers || {};
  const q = event.queryStringParameters || {};
  const token = h['x-agency-token'] || h['X-Agency-Token'] || q.token || '';

  if (!token) return { error: 'No token', status: 401 };
  if (token === process.env.INTERNAL_KEY) return { agencyId: '__admin__', isAdmin: true };

  const session = await fsGet('agency_sessions', token);
  if (!session) return { error: 'Invalid token', status: 401 };
  if (new Date(session.expiresAt) < new Date()) return { error: 'Session expired', status: 401 };

  return { agencyId: session.agencyId, isAdmin: false };
}

function unauth(msg) { return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: msg }) }; }
function err(msg, status=500) { return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) }; }
function ok(data) { return { statusCode: 200, headers: CORS, body: JSON.stringify(data) }; }

module.exports = { verifyToken, unauth, err, ok, CORS };
