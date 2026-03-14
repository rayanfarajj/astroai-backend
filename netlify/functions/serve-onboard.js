export default async (req) => {
  const url     = new URL(req.url);
  const parts   = url.pathname.split('/').filter(Boolean);
  const segment = parts[1] || '';

  if (segment === 'portal') {
    return new Response(null, {
      status: 302,
      headers: { 'Location': '/client-portal.html' + url.search },
    });
  }

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
