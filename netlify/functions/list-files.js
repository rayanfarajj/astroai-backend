// netlify/functions/list-files.js
import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });

  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) return new Response(JSON.stringify({ error: 'slug required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const store = getStore('client-files');
    const { blobs } = await store.list({ prefix: `${slug}/` });

    const files = await Promise.all(blobs.map(async (blob) => {
      try {
        const meta = await store.getMetadata(blob.key);
        const m = meta?.metadata || {};
        return {
          key:          blob.key,
          name:         m.displayName || m.originalName || blob.key.split('/').pop(),
          originalName: m.originalName || blob.key.split('/').pop(),
          fileType:     m.fileType || '',
          size:         parseInt(m.fileSize || '0'),
          uploadedAt:   m.uploadedAt || '',
          protected:    m.protected === 'true',
          systemFile:   m.systemFile === 'true',
          docType:      m.docType || '',
          url: `https://marketingplan.astroaibots.com/api/get-file?key=${encodeURIComponent(blob.key)}`,
        };
      } catch(e) {
        return { key: blob.key, name: blob.key.split('/').pop(), size: 0, uploadedAt: '' };
      }
    }));

    files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    return new Response(JSON.stringify({ success: true, files }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch(e) {
    console.error('[list-files] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/list-files' };
