// netlify/functions/serve-onboard.js
export default async (req) => {
  const url     = new URL(req.url);
  const parts   = url.pathname.split('/').filter(Boolean);
  const segment = parts[1] || '';

  // /onboard/portal?a=AGENCY_ID&s=CLIENT_ID → client-portal.html?a=...&s=...
  if (segment === 'portal') {
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/client-portal.html' + url.search },
    });
  }

  // /onboard/AGENCY_ID → onboard.html?a=AGENCY_ID
  if (segment && segment !== 'onboard.html') {
    const params = new URLSearchParams(url.search);
    params.set('a', segment);
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/onboard.html?' + params.toString() },
    });
  }

  // /onboard or /onboard/ → onboard.html
  return new Response(null, {
    status: 302,
    headers: { 'Location': '/onboard.html' + url.search },
  });
};

export const config = {
  path: '/onboard/*',
  preferStatic: false,
};
