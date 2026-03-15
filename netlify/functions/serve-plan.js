// netlify/functions/serve-plan.js
const https = require('https');

function fetchFromGitHub(path) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    const repo  = 'rayanfarajj/astroai-backend';

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

export default async (req) => {
  const url  = new URL(req.url);
  let slug   = url.searchParams.get('slug') || url.searchParams.get('splat') || '';

  if (!slug) {
    slug = url.pathname.replace(/^\/+/, '').trim();
  }

  // Strip .html extension if present for plan lookups
  const isHtmlFile = slug.endsWith('.html');
  console.log('serve-plan — slug:', slug, 'isHtmlFile:', isHtmlFile);

  const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };

  // ── Static HTML files served directly ──────────────────────────────────────
  if (isHtmlFile) {
    try {
      const html = await fetchFromGitHub(`public/${slug}`);
      if (html) return new Response(html, { status: 200, headers: HTML_HEADERS });
    } catch(e) {
      console.error('Static file error:', e.message);
    }
    return new Response('<h1>Not Found</h1>', { status: 404, headers: HTML_HEADERS });
  }

  // ── Known page redirects ──────────────────────────────────────────────────
  const PAGE_REDIRECTS = { 'join': '/join.html', 'signup': '/join.html', 'login': '/saas.html', 'admin': '/admin-dashboard.html' };
  if (PAGE_REDIRECTS[slug]) {
    return new Response(null, { status: 301, headers: { 'Location': PAGE_REDIRECTS[slug] } });
  }

  // ── Empty slug — homepage ───────────────────────────────────────────────────
  if (!slug) {
    return new Response(`<!DOCTYPE html><html>
    <head><title>Astro A.I. Marketing</title>
    <style>body{background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;}h1{color:#f97316;}</style>
    </head><body><h1>Astro A.I. Marketing</h1><p>Marketing Command Center</p></body></html>`,
    { status: 200, headers: HTML_HEADERS });
  }

  // ── Plan pages ──────────────────────────────────────────────────────────────
  try {
    // Try plans/ subfolder first, then root public/
    let html = await fetchFromGitHub(`public/plans/${slug}.html`);
    if (!html) html = await fetchFromGitHub(`public/${slug}.html`);

    if (!html) {
      return new Response(`<!DOCTYPE html><html>
      <head><title>Not Found</title>
      <style>body{background:#0a0a0f;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:1rem;}h1{color:#f97316;}p{color:#888;}</style>
      </head><body>
        <h1>Page Not Found</h1>
        <p>Slug: <code style="color:#f97316">${slug}</code></p>
        <p>This marketing plan hasn't been generated yet.</p>
      </body></html>`, { status: 404, headers: HTML_HEADERS });
    }

    return new Response(html, { status: 200, headers: HTML_HEADERS });

  } catch (err) {
    console.error('serve-plan error:', err.message);
    return new Response(`<html><body style="background:#0a0a0f;color:#eee;font-family:sans-serif;padding:2rem;">
      <h1 style="color:#f97316">Error</h1><p>${err.message}</p>
    </body></html>`, { status: 500, headers: HTML_HEADERS });
  }
}

export const config = {
  path: '/*',
  excludedPath: [
    // API routes
    '/api/*', '/api/agency/*', '/api/admin/*', '/.netlify/*',
    // All static HTML pages
    '/onboarding.html', '/onboard.html', '/saas.html', '/saas-dashboard.html',
    '/agency-dashboard.html', '/client-portal.html', '/platform-directory.html',
    '/admin-dashboard.html', '/health.html', '/join.html', '/index.html',
    // Friendly URL redirects (handled by netlify.toml)
    '/health', '/join', '/signup', '/login', '/admin', '/onboard/*',
    // Static assets — never intercept JS, CSS, images, fonts
    '/*.js', '/*.css', '/*.png', '/*.jpg', '/*.jpeg', '/*.svg',
    '/*.ico', '/*.webp', '/*.gif', '/*.woff', '/*.woff2', '/*.ttf',
    '/*.json', '/*.txt', '/*.xml', '/*.map',
  ],
  preferStatic: true,
};
