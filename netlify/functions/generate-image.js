// netlify/functions/generate-image.js
export default async (req) => {
  const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: CORS });

  if (req.headers.get('x-internal-key') !== process.env.INTERNAL_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt) return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:   'dall-e-3',
        prompt,
        n:       1,
        size:    '1024x1024',
        quality: 'standard',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[generate-image] OpenAI error:', JSON.stringify(data));
      return new Response(JSON.stringify({ error: data?.error?.message || 'OpenAI error' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const imageUrl = data?.data?.[0]?.url;
    if (!imageUrl) return new Response(JSON.stringify({ error: 'No image returned' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify({ imageUrl }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch(e) {
    console.error('[generate-image] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/generate-image' };
