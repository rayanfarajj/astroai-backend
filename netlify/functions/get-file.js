// netlify/functions/get-file.js
// Serves a stored blob as a downloadable file
import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const key = new URL(req.url).searchParams.get('key');
  if (!key) return new Response('Missing key', { status: 400 });

  try {
    const store = getStore('client-files');
    const result = await store.getWithMetadata(key, { type: 'arrayBuffer' });

    if (!result || result.data === null) {
      return new Response('File not found', { status: 404 });
    }

    const m = result.metadata || {};
    const fileName = m.originalName || key.split('/').pop();
    const fileType = m.fileType || 'application/octet-stream';

    return new Response(result.data, {
      status: 200,
      headers: {
        'Content-Type': fileType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, max-age=3600',
        ...CORS,
      }
    });

  } catch(e) {
    console.error('[get-file] Error:', e.message);
    return new Response('Error retrieving file', { status: 500 });
  }
};

export const config = { path: '/api/get-file' };
