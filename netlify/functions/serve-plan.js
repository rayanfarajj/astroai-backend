// netlify/functions/serve-plan.js
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirect if needed
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        console.log('Following redirect to:', res.headers.location);
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Final fetch status:', res.statusCode, 'length:', data.length);
        resolve({ status: res.statusCode, body: data });
      });
    }).on('error', reject);
  });
}

function fetchBlob(slug) {
  return new Promise((resolve, reject) => {
    const siteId = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_TOKEN;

    console.log('Fetching blob for slug:', slug);

    const options = {
      hostname: 'api.netlify.com',
      path:     `/api/v1/sites/${siteId}/blobs/${encodeURIComponent(slug)}?visibility=public`,
      method:   'GET',
      headers:  { 'Authorization': `Bearer ${token}` },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        console.log('Blob API status:', res.statusCode, 'length:', data.length);

        if (res.statusCode === 404) return resolve(null);

        if (res.statusCode !== 200) {
          return reject(new Error(`Blob API failed: ${res.statusCode} — ${data.slice(0, 300)}`));
        }

        // Check if response is a JSON redirect (signed S3 URL)
        try {
          const json = JSON.parse(data);
          if (json.url) {
            console.log('Got signed S3 URL, fetching HTML...');
            const result = await httpsGet(json.url);
            return resolve(result.status === 200 ? result.body : null);
          }
        } catch (e) {
          // Not JSON — it's the raw HTML directly
          console.log('Got raw HTML directly');
        }

        resolve(data);
      });
    });
    req.on('error', reject);
    req.write('');
    req.end();
  });
}

exports.handler = async (event) => {
  console.log('Event path:', event.path);
  console.log('Query params:', JSON.stringify(event.queryStringParameters));

  let slug = event.queryStringParameters?.slug || event.queryStringParameters?.splat || '';

  if (!slug && event.path) {
    slug = event.path
      .replace(/^\/\.netlify\/functions\/serve-plan\/?/, '')
      .replace(/^\/+/, '');
  }

  slug = slug.replace(/^\/+/, '').trim();
  console.log('Resolved slug:', slug);

  if (!slug) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html' },
      body: `<html><body style="background:#0a0a0f;color:#eee;font-family:sans-serif;padding:2rem;">
        <h1 style="color:#f97316">No slug</h1>
        <p>Path: ${event.path}</p>
        <p>Params: ${JSON.stringify(event.queryStringParameters)}</p>
      </body></html>`,
    };
  }

  try {
    const html = await fetchBlob(slug);

    if (!html) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html' },
        body: `<!DOCTYPE html><html>
        <head><title>Not Found</title>
        <style>body{background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;}h1{color:#f97316;}p{color:#888;}</style>
        </head>
        <body>
          <h1>Page Not Found</h1>
          <p>Slug: <code style="color:#f97316">${slug}</code></p>
          <p>This marketing plan hasn't been generated yet or the link may be incorrect.</p>
        </body></html>`,
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };

  } catch (err) {
    console.error('serve-plan error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html' },
      body: `<html><body style="background:#0a0a0f;color:#eee;font-family:sans-serif;padding:2rem;">
        <h1 style="color:#f97316">Error</h1><p>${err.message}</p>
      </body></html>`,
    };
  }
};
