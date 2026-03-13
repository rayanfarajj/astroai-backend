// netlify/functions/serve-plan.js
const https = require('https');

function fetchFromGitHub(path) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    const repo  = 'rayanfarajj/astroai-backend';

    console.log('Fetching from GitHub:', path);

    const options = {
      hostname: 'api.github.com',
      path:     `/repos/${repo}/contents/${path}`,
      method:   'GET',
      headers:  {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    'astroai-bots',
        'Accept':        'application/vnd.github+json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('GitHub API status:', res.statusCode);
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode !== 200) return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0,200)}`));
        try {
          const json = JSON.parse(data);
          const html = Buffer.from(json.content.replace(/\n/g, ''), 'base64').toString('utf8');
          resolve(html);
        } catch(e) {
          reject(new Error('Failed to parse GitHub response: ' + e.message));
        }
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
  console.log('serve-plan — slug:', slug);

  // ── Static HTML files — serve directly from public/ ──────────────────────
  const staticFiles = ['client-portal.html', 'agency-dashboard.html', 'index.html'];
  if (staticFiles.includes(slug)) {
    try {
      const html = await fetchFromGitHub(`public/${slug}`);
      if (html) return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
        body: html,
      };
    } catch(e) {
      console.error('Static file error:', e.message);
    }
  }

  // ── Empty slug — homepage ─────────────────────────────────────────────────
  if (!slug) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!DOCTYPE html><html>
      <head><title>Astro A.I. Marketing</title>
      <style>body{background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;}h1{color:#f97316;}</style>
      </head><body><h1>Astro A.I. Marketing</h1><p>Marketing Command Center</p></body></html>`,
    };
  }

  // ── Plan pages — try plans/{slug}.html first, then {slug}.html ───────────
  try {
    // Try plans/ subfolder first
    let html = await fetchFromGitHub(`public/plans/${slug}.html`);

    // Fall back to root public/ folder
    if (!html) html = await fetchFromGitHub(`public/${slug}.html`);

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
