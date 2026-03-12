// netlify/functions/serve-plan.js
const https = require('https');

// Fetch a URL and follow redirects
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        console.log('Redirecting to:', res.headers.location);
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

// Call Netlify Blobs API — returns signed S3 URL, then fetch that URL for HTML
function fetchBlob(slug) {
  return new Promise((resolve, reject) => {
    const siteId = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_TOKEN;
    const key    = `marketing-plans%3A${slug}`;

    console.log('Fetching blob key:', key);

    const options = {
      hostname: 'api.netlify.com',
      path:     `/api/v1/sites/${siteId}/blobs/${key}?visibility=public`,
      method:   'GET',
      headers:  { 'Authorization': `Bearer ${token}` },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        console.log('Blob API status:', res.statusCode, 'response length:', data.length);

        if (res.statusCode === 404) return resolve(null);

        if (res.statusCode !== 200) {
          return reject(new Error(`Blob API error: ${res.statusCode} — ${data.slice(0, 300)}`));
        }

        // Netlify returns a signed S3 URL as JSON — follow it to get the HTML
        try {
          const json = JSON.parse(data);
          if (json.url) {
            console.log('Got signed S3 URL, fetching actual HTML...');
            const result = await fetchUrl(json.url);
            console.log('S3 fetch status:', result.status, 'HTML length:', result.body.length);
            return resolve(result.status === 200 ? result.body : null);
          }
        } catch (e) {
          // Not JSON — raw HTML returned directly
          console.log('Raw HTML returned directly, length:', data.length);
        }

        resolve(data);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  console.log('serve-plan — path:', event.path, 'params:', JSON.stringify(event.queryStringParameters));

  // Resolve slug from query param or raw path
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
        <h1 style="color:#f97316">No slug received</h1>
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
        <style>
          body{background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;}
          h1{color:#f97316;} p{color:#888;} code{color:#f97316;}
        </style></head>
        <body>
          <h1>Page Not Found</h1>
          <p>Slug: <code>${slug}</code></p>
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
        <h1 style="color:#f97316">Error loading page</h1>
        <p>${err.message}</p>
      </body></html>`,
    };
  }
};
