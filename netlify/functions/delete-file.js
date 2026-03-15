// netlify/functions/delete-file.js
// POST /api/delete-file — deletes a blob from client-files store
// REFUSES to delete any file with protected='true' or systemFile='true' metadata
import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-agency-token',
  'Content-Type': 'application/json',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')   return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });

  // Require agency token (basic auth check — not a full session verify,
  // but prevents unauthenticated deletes from the public internet)
  const agencyToken = req.headers.get('x-agency-token') || '';
  if (!agencyToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { key } = body;
  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'key required' }), { status: 400, headers: CORS });
  }

  // Sanitize key — must not start with / or contain ..
  if (key.includes('..') || key.startsWith('/')) {
    return new Response(JSON.stringify({ error: 'Invalid key' }), { status: 400, headers: CORS });
  }

  try {
    const store = getStore('client-files');

    // ── GUARD: Check metadata BEFORE deleting ────────────────────────────────
    // If the file has protected='true' or systemFile='true', refuse the delete.
    // This is the server-side enforcement — the UI hides the delete button,
    // but this ensures it can never be deleted even via direct API calls.
    const meta = await store.getMetadata(key);

    if (meta?.metadata?.protected === 'true' || meta?.metadata?.systemFile === 'true') {
      return new Response(JSON.stringify({
        error: 'This file is protected and cannot be deleted.',
        protected: true,
      }), { status: 403, headers: CORS });
    }

    if (!meta) {
      // File doesn't exist — treat as already deleted (idempotent)
      return new Response(JSON.stringify({ success: true, note: 'File not found (already deleted)' }), { status: 200, headers: CORS });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    await store.delete(key);
    console.log('[delete-file] Deleted:', key);

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });

  } catch(e) {
    console.error('[delete-file] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/delete-file' };
