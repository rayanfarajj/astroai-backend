// netlify/functions/upload-file.js
import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

  const { slug, fileName, fileBase64, fileType, fileSize } = body;

  if (!slug || !fileName || !fileBase64) {
    return new Response(JSON.stringify({ error: 'slug, fileName, fileBase64 required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  if (fileSize > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'File too large (max 10MB)' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const store = getStore('client-files');

    // Convert base64 to buffer
    const buffer = Buffer.from(fileBase64, 'base64');

    // Key: slug/timestamp-filename
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const key = `${slug}/${Date.now()}-${safeFileName}`;

    await store.set(key, buffer, {
      metadata: {
        originalName: fileName,
        fileType:     fileType || 'application/octet-stream',
        fileSize:     fileSize || buffer.length,
        uploadedAt:   new Date().toISOString(),
        slug,
      }
    });

    return new Response(JSON.stringify({ success: true, key }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch(e) {
    console.error('[upload-file] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/upload-file' };
