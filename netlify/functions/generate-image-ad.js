// netlify/functions/generate-image-ad.js
// Generates ad images using gpt-image-1 (OpenAI) or Gemini
// POST /api/generate-image-ad { prompt, provider: 'openai'|'gemini' }
import https from 'https';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  'Content-Type': 'application/json',
};

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const s = JSON.stringify(body);
    const r = https.request({ hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(s) } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch(e) { reject(e); } });
    });
    r.on('error', reject); r.write(s); r.end();
  });
}

async function generateWithOpenAI(prompt) {
  const res = await httpsPost('api.openai.com', '/v1/images/generations', {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
  }, {
    model: 'gpt-image-1',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard',
    response_format: 'b64_json',
  });
  if (res.body.error) throw new Error('OpenAI: ' + res.body.error.message);
  const b64 = res.body.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image returned from OpenAI');
  return `data:image/png;base64,${b64}`;
}

async function generateWithGemini(prompt) {
  // Gemini Imagen 3 via Google AI API
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in environment variables');

  const res = await httpsPost('generativelanguage.googleapis.com',
    `/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
    { 'Content-Type': 'application/json' },
    {
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '1:1', safetySetting: 'block_only_high' }
    }
  );
  if (res.body.error) throw new Error('Gemini: ' + (res.body.error.message || JSON.stringify(res.body.error)));
  const b64 = res.body.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('No image returned from Gemini');
  return `data:image/png;base64,${b64}`;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return new Response(JSON.stringify({error:'POST only'}), { status: 405, headers: CORS });

  if (req.headers.get('x-internal-key') !== process.env.INTERNAL_KEY) {
    return new Response(JSON.stringify({error:'Unauthorized'}), { status: 401, headers: CORS });
  }

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}), { status: 400, headers: CORS }); }

  const { prompt, provider = 'openai' } = body;
  if (!prompt) return new Response(JSON.stringify({error:'prompt required'}), { status: 400, headers: CORS });

  try {
    console.log(`[generate-image-ad] provider=${provider}, prompt length=${prompt.length}`);
    let imageUrl;
    if (provider === 'gemini') {
      imageUrl = await generateWithGemini(prompt);
    } else {
      imageUrl = await generateWithOpenAI(prompt);
    }
    return new Response(JSON.stringify({ success: true, imageUrl }), { status: 200, headers: CORS });
  } catch(e) {
    console.error('[generate-image-ad] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/generate-image-ad' };
