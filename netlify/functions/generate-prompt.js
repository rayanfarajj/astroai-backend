// netlify/functions/generate-prompt.js
// Generates Facebook ad image prompts using Claude
// Short prompt = fast response = no timeout
import https from 'https';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  'Content-Type': 'application/json',
};

function callClaude(messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages,
    });
    const r = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.error) reject(new Error(j.error.message));
          else resolve(j.content?.[0]?.text || '');
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject);
    r.setTimeout(8000, () => { r.destroy(); reject(new Error('Request timed out')); });
    r.write(body); r.end();
  });
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST') return new Response(JSON.stringify({error:'POST only'}), { status: 405, headers: CORS });
  if (req.headers.get('x-internal-key') !== process.env.INTERNAL_KEY) {
    return new Response(JSON.stringify({error:'Unauthorized'}), { status: 401, headers: CORS });
  }

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}), { status: 400, headers: CORS }); }

  const { businessName = '', industry = '', angleLabel = '', headline = '', primaryText = '', cta = 'Learn More' } = body;

  const userMsg = `Create a Facebook/Instagram ad image generation prompt (for gpt-image-1 or Midjourney).

Business: ${businessName} | Industry: ${industry} | Ad Angle: ${angleLabel}
Headline (must appear verbatim in bold in the image): "${headline}"
CTA button text: "${cta}"
Ad concept: ${primaryText.slice(0, 150)}

Rules:
- 1080x1080px square format
- Photorealistic, premium ad quality  
- Specific scene, subject, lighting details
- TEXT OVERLAY section: show exact headline "${headline}" in large bold text, CTA "${cta}" as a button
- No placeholder text anywhere
- 150-200 words total

Write only the prompt, nothing else.`;

  try {
    const result = await callClaude([{ role: 'user', content: userMsg }]);
    if (!result) throw new Error('No response');
    return new Response(JSON.stringify({ prompt: result.trim() }), { status: 200, headers: CORS });
  } catch(e) {
    console.error('[generate-prompt]', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/generate-prompt' };
