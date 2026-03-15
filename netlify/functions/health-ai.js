// netlify/functions/health-ai.js v2
// Receives health check results, asks Claude to analyze, returns diagnosis
// Fixed: removed CORS issue by running server-side only
import https from 'https';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS }); }

  const { checks, summary } = body;
  if (!checks) return new Response(JSON.stringify({ error: 'No checks provided' }), { status: 400, headers: CORS });

  const fails = checks.filter(c => c.status === 'fail');
  const warns = checks.filter(c => c.status === 'warn');
  const passes = checks.filter(c => c.status === 'pass');

  const prompt = `You are a senior full-stack developer reviewing a health check report for the AstroAI Bots SaaS platform built on Netlify + Firebase + Claude API.

RESULTS SUMMARY: ${passes.length} passing, ${fails.length} failing, ${warns.length} warnings

FAILING CHECKS:
${fails.length ? fails.map(c => `• ${c.name}: "${c.detail}"`).join('\n') : 'None — all passing!'}

WARNING CHECKS:
${warns.length ? warns.map(c => `• ${c.name}: "${c.detail}"`).join('\n') : 'None'}

PLATFORM CONTEXT:
- Netlify serverless functions (ESM .js format, 10s timeout unless specified in netlify.toml)
- Firebase Firestore via REST API with JWT auth
- Claude API (claude-sonnet-4-6) for plan generation
- Key files: agency-process-plan.js, agency-generate-background.js, agency-get-clients.js, get-portal.js, agency-billing.js, submit-referral.js, agency-referrals.js, agency-settings.js, health-check.js

KNOWN PATTERNS:
- "Returns HTML instead of JSON" = function crashed or timed out (check netlify.toml timeout, check for syntax errors)
- "HTTP 401" on agency endpoints = missing/expired x-agency-token header or session
- "HTTP 401" on admin endpoints = missing x-admin-key header
- "TIMEOUT" = function exceeds 10s limit (increase in netlify.toml or use background function)
- Background function not running = cannot be triggered via external HTTP from another function
- "dashboardJSON empty" = background generation failed (check agency-generate-background.js logs)
- Firebase auth failing = FIREBASE_PRIVATE_KEY env var may have wrong newline format

${fails.length === 0 ? 'Everything is passing! Confirm the platform is healthy.' : 'Please diagnose each failure with a specific cause and exact fix.'}

Format your response as:
**Overall Status**: [one sentence]

${fails.length > 0 ? `**Failures to Fix** (in priority order):
For each: name the file, what's wrong, and the exact fix` : ''}

${warns.length > 0 ? `**Warnings**:
Brief explanation of each warning and whether action is needed` : ''}

${fails.length === 0 ? '**All Clear**: Brief confirmation everything looks good' : ''}

Be specific. Reference exact file names. Keep it concise and actionable.`;

  try {
    const analysis = await callClaude(prompt);
    return new Response(JSON.stringify({ success: true, analysis }), { status: 200, headers: CORS });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/health-ai' };
