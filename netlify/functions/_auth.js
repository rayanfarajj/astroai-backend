// _auth.js — shared auth middleware for agency-scoped functions
const { fsGet } = require('./_firebase');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-agency-token',
  'Content-Type': 'application/json',
};

async function verifyToken(req) {
  // Support both header and query param for GET requests
  const token = req.headers.get('x-agency-token') || new URL(req.url).searchParams.get('token');
  if (!token) return { error: 'No token', status: 401 };

  // Super-admin internal key (for your own use)
  if (token === process.env.INTERNAL_KEY) {
    return { agencyId: '__admin__', isAdmin: true };
  }

  const session = await fsGet('agency_sessions', token);
  if (!session) return { error: 'Invalid token', status: 401 };
  if (new Date(session.expiresAt) < new Date()) return { error: 'Session expired', status: 401 };

  return { agencyId: session.agencyId, isAdmin: false };
}

function unauth(msg) {
  return new Response(JSON.stringify({ error: msg }), { status: 401, headers: CORS });
}

function err(msg, status = 500) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: CORS });
}

function ok(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: CORS });
}

module.exports = { verifyToken, unauth, err, ok, CORS };
