// netlify/functions/generate-prompt.js
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
    const { businessName, industry, angle, headline, primaryText, description, cta, goal, adPlatforms } = await req.json();

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are an expert AI image prompt engineer for Facebook and Instagram ads. Write a detailed, high-converting DALL-E 3 image generation prompt for the following ad.

Business: ${businessName}
Industry: ${industry}
Ad Platform: ${adPlatforms}
Marketing Angle: ${angle}
Headline: ${headline}
Primary Text: ${primaryText}
Description: ${description}
CTA: ${cta}
90-Day Goal: ${goal}

Requirements:
- Square (1:1) format optimized for Facebook/Instagram feed
- Photorealistic, premium advertising photography quality
- Scene, subjects, lighting, composition, and mood must all match the specific ad angle and headline
- Include a clean negative space area for text overlay placement
- Mobile-first composition, scroll-stopping
- Specify exact visual elements: setting, people (if any), props, colors, lighting style
- Brand-safe, professional, conversion-oriented
- No awkward hands, distorted text, or exaggerated expressions
- Include text overlay directions: headline text, supporting text, CTA button style
- Specify typography style: elegant modern sans-serif, clean hierarchy, mobile-readable, strong contrast
- Visual tone should match the marketing angle emotionally

Write ONLY the DALL-E prompt. No explanation, no preamble, no markdown.`
        }]
      })
    });

    const data = await res.json();
    const prompt = data?.content?.[0]?.text?.trim();
    if (!prompt) throw new Error('No prompt returned from Claude');

    return new Response(JSON.stringify({ prompt }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch(e) {
    console.error('[generate-prompt] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/generate-prompt' };
