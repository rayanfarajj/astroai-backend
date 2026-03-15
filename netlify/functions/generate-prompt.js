// netlify/functions/generate-prompt.js
// Generates professional Facebook/Instagram ad image prompts
// Uses gpt-image-1.5 prompt structure: Scene → Subject → Lighting → Text → Constraints
export default async (req) => {
  const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: CORS });
  if (req.method !== 'POST')    return new Response(JSON.stringify({error:'Method not allowed'}), { status: 405, headers: CORS });

  if (req.headers.get('x-internal-key') !== process.env.INTERNAL_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS });
  }

  try {
    const { businessName, industry, angleLabel, headline, primaryText, description, cta } = await req.json();

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: `You are a professional Facebook/Instagram ad creative director and AI image prompt engineer. Your job is to write a single, production-ready image generation prompt that creates a complete, print-ready ad — no placeholder text, no generic copy, no "your headline here". The image must look exactly like a real ad someone would scroll past and stop at.

AD DETAILS:
Business: ${businessName}
Industry: ${industry}
Marketing Angle: ${angleLabel}
Headline (MUST appear verbatim in the image): "${headline}"
Primary Text concept: ${primaryText}
CTA Button text (MUST appear in image): "${cta}"

PROMPT STRUCTURE TO FOLLOW (based on gpt-image-1.5 best practices):
1. FORMAT: Square 1:1 Facebook/Instagram ad, 1080x1080px, professional advertising photography quality
2. SCENE: Describe the background/environment that emotionally matches the "${angleLabel}" angle
3. SUBJECT: Describe the person or focal element (if applicable) — be specific about age, appearance, emotion, action
4. LIGHTING: Specify exact lighting (soft diffused, golden hour, studio softbox, etc.)
5. COMPOSITION: Describe layout — where the subject sits, where text overlay area is (usually top or bottom 30%)
6. TEXT OVERLAY (CRITICAL — use exact copy):
   - Main headline in LARGE BOLD text: "${headline}" — specify font style, color, exact position
   - Supporting line in smaller text below headline
   - CTA button at bottom: "${cta}" — specify button color, shape, text color
   - All text must be crisp, high-contrast, mobile-readable
7. DESIGN STYLE: Premium advertising aesthetic, clean hierarchy, NOT stock photo generic
8. NEGATIVE PROMPT: No placeholder text, no generic lorem ipsum, no "headline here", no watermarks, no extra people, no distorted faces or hands

Write ONLY the image prompt. No explanation, no preamble, no markdown. Make it long, detailed, and specific enough that gpt-image-1 or Midjourney would generate a complete ready-to-use Facebook ad.`
        }]
      })
    });

    const data = await res.json();
    const prompt = data?.content?.[0]?.text?.trim();
    if (!prompt) throw new Error('No prompt returned');

    return new Response(JSON.stringify({ prompt }), { status: 200, headers: CORS });

  } catch(e) {
    console.error('[generate-prompt] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/generate-prompt' };
