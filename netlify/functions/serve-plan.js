// netlify/functions/serve-plan.js
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        console.log('Redirect to:', res.headers.location.slice(0, 100));
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Fetch status:', res.statusCode, 'length:', data.length);
        resolve({ status: res.statusCode, body: data });
      });
    }).on('error', reject);
  });
}

function fetchBlob(slug) {
  return new Promise((resolve, reject) => {
    const siteId = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_TOKEN;

    console.log('Fetching blob, slug:', slug, 'siteId:', siteId ? siteId.slice(0,8)+'...' : 'MISSING');

    const options = {
      hostname: 'api.netlify.com',
      path:     `/api/v1/sites/${siteId}/blobs/marketing-plans%3A${encodeURIComponent(slug)}?visibility=public`,
      method:   'GET',
      headers:  {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/html,application/octet-stream,*/*',
      },
    };

    const req = https.request(options, (res) => {
      // Netlify Blobs may redirect directly to S3
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        console.log('Blob API redirecting to S3...');
        return httpsGet(res.headers.location)
          .then(r => resolve(r.status === 200 ? r.body : null))
          .catch(reject);
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', async () => {
        console.log('Blob API status:', res.statusCode, 'content-type:', res.headers['content-type'], 'length:', data.length);

        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error(`Blob API ${res.statusCode}: ${data.slice(0,200)}`));

        // If response is JSON with a url field, fetch that URL
        const trimmed = data.trim();
        if (trimmed.startsWith('{')) {
          try {
            const json = JSON.parse(trimmed);
            if (json.url) {
              console.log('Got presigned URL, fetching HTML from S3 directly...');
              // Fetch with no-cache to avoid expired signature issues
              const result = await httpsGet(json.url);
              if (result.status === 200) return resolve(result.body);
              // If S3 URL expired (403/404), try fetching blob content directly
              console.log('S3 URL expired or failed, status:', result.status);
              return resolve(null);
            }
          } catch(e) { /* not JSON */ }
        }

        // Raw HTML returned directly
        if (trimmed.startsWith('<!') || trimmed.startsWith('<html')) {
          return resolve(data);
        }

        resolve(null);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  let slug = event.queryStringParameters?.slug || event.queryStringParameters?.splat || '';

  if (!slug && event.path) {
    slug = event.path.replace(/^\/+/, '').trim();
  }

  slug = slug.replace(/^\/+/, '').trim();
  console.log('serve-plan — path:', event.path, 'slug:', slug);

  if (!slug) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html><html><head><title>Astro A.I. Marketing</title>
      <style>body{background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;}h1{color:#f97316;}</style>
      </head><body><h1>Astro A.I. Marketing</h1><p>Marketing Command Center</p></body></html>`,
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
