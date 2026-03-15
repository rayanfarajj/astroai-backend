// netlify/functions/generate-prompt.js
import https from 'https';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  'Content-Type': 'application/json',
};

function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
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
          if (j.error) reject(new Error(j.error.message || JSON.stringify(j.error)));
          else resolve(j.content?.[0]?.text || '');
        } catch(e) { reject(e); }
      });
    });
    r.on('error', reject); r.write(body); r.end();
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

  const { businessName, industry, angleLabel, headline, primaryText, description, cta } = body;

  const systemPrompt = `You are a professional Facebook/Instagram ad creative director and AI image prompt engineer. Write a single production-ready image generation prompt that creates a complete, print-ready ad — no placeholder text, no "your headline here", no generic copy. The image must look exactly like a real scroll-stopping ad.

AD DETAILS:
Business: ${businessName || 'the business'}
Industry: ${industry || 'general'}
Marketing Angle: ${angleLabel || 'general'}
Headline (must appear VERBATIM in bold in the image): "${headline || ''}"
Ad concept: ${primaryText || ''}
CTA Button text (must appear in the image): "${cta || 'Learn More'}"

Write the prompt following this exact structure:
FORMAT: Square 1:1 Facebook/Instagram ad, 1080x1080px, professional advertising photography quality.
SCENE: [Describe background/environment that emotionally matches the ${angleLabel} angle — be specific about location, time of day, mood]
SUBJECT: [Describe the person or hero element — age, appearance, emotion, what they're doing — be very specific, photorealistic]
LIGHTING: [Exact lighting specification — soft diffused, golden hour, studio softbox, etc.]
COMPOSITION: [Layout — where subject sits, where the text overlay area is, rule of thirds]
TEXT OVERLAY: Large bold headline text "${headline}" in [specify font style] positioned at [top/bottom], high contrast against background. Below it in smaller text: [supporting line related to the ad concept]. CTA button at bottom reading "${cta}" in [specify button color and shape]. All text crisp and mobile-readable.
STYLE: Premium advertising aesthetic, photorealistic, not stock photo generic, scroll-stopping.
NEGATIVE: No placeholder text, no lorem ipsum, no watermarks, no distorted faces or hands, no extra people, no generic "your text here".

Make it long, detailed (300+ words), and specific enough that gpt-image-1 generates a complete ready-to-use Facebook ad with the exact headline text visible in the image.`;

  try {
    const result = await callClaude(systemPrompt);
    if (!result) throw new Error('Empty response from Claude');
    return new Response(JSON.stringify({ prompt: result }), { status: 200, headers: CORS });
  } catch(e) {
    console.error('[generate-prompt] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/generate-prompt' };
