'use strict';
const https = require('https');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  'Content-Type':                 'application/json',
};

// Fire HTTP request and wait until it's fully sent (but don't wait for response)
function fireAndForget(options, body) {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      // Drain the response so the socket closes cleanly
      res.resume();
      resolve();
    });
    req.on('error', (e) => {
      console.error('process-plan trigger error:', e.message);
      resolve(); // still resolve — don't block the 202
    });
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let data;
  try { data = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const clientEmail  = data.email;
  const businessName = data.businessName || data.authSignerBusiness || 'Your Business';

  if (!clientEmail) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No client email provided' }) };
  }

  console.log('Received request for:', businessName, '— handing off to process-plan');

  const body = JSON.stringify(data);

  // AWAIT the fire — waits until request is sent + response starts, then moves on
  // This prevents Netlify from killing the execution before the TCP call goes out
  await fireAndForget({
    hostname: 'celebrated-baklava-e035d6.netlify.app',
    path:     '/.netlify/functions/process-plan',
    method:   'POST',
    headers:  {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'x-internal-key': process.env.INTERNAL_KEY || 'astroai-internal',
    },
  }, body);

  console.log('process-plan triggered for:', businessName);

  return {
    statusCode: 202,
    headers: CORS,
    body: JSON.stringify({
      success: true,
      message: `Got it! Your Marketing Command Center for ${businessName} is being generated. Check your email in 2-3 minutes.`,
    }),
  };
};
