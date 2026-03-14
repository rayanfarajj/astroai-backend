// netlify/functions/serve-onboard.js
export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  // parts[0] = 'onboard', parts[1] = agencyId (or 'portal')
  const segment = parts[1] || '';

  // If it's the portal, redirect to onboard.html with portal mode
  if (segment === 'portal') {
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/onboard.html' + url.search },
    });
  }

  // Otherwise it's an agency onboarding form — pass agencyId as ?a=
  if (segment && segment !== 'onboard.html') {
    const params = new URLSearchParams(url.search);
    params.set('a', segment);
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/onboard.html?' + params.toString() },
    });
  }

  return new Response(null, {
    status: 302,
    headers: { 'Location': '/onboard.html' + url.search },
  });
};

export const config = {
  path: '/onboard/*',
  preferStatic: false,
};
