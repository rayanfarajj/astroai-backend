// netlify/functions/serve-plan.js
// Reads a marketing command center HTML from Netlify Blobs and serves it

const https = require('https');

function fetchBlob(slug) {
  return new Promise((resolve, reject) => {
    const siteId = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_TOKEN;

    const options = {
      hostname: 'api.netlify.com',
      path:     `/api/v1/sites/${siteId}/blobs/${slug}?visibility=public`,
      method:   'GET',
      headers:  {
        'Authorization': `Bearer ${token}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error(`Blob fetch failed: ${res.statusCode}`));
        resolve(data);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const slug = event.queryStringParameters?.slug || '';

  // Block function routes from being caught
  if (!slug || slug.startsWith('.netlify') || slug.startsWith('netlify/')) {
    return { statusCode: 400, body: 'Invalid request' };
  }

  try {
    const html = await fetchBlob(slug);

    if (!html) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html' },
        body: `<!DOCTYPE html><html><head><title>Not Found</title>
        <style>body{background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;}
        h1{color:#f97316;}p{color:#888;}</style></head>
        <body><h1>Page Not Found</h1><p>This marketing plan hasn't been generated yet or the link is incorrect.</p></body></html>`,
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
      body: `<html><body><h1>Error loading page</h1><p>${err.message}</p></body></html>`,
    };
  }
};
