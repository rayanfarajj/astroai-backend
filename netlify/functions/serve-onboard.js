// netlify/functions/serve-onboard.js
// Serves the onboarding HTML at /onboard/:agencyId
// The HTML loads agency config via JS — this just serves the shell

export default async (req) => {
  const html = await fetch(new URL(req.url).origin + '/onboard.html').then(r => r.text()).catch(() => null);
  // Just redirect to the static HTML — the JS will pick up agencyId from URL
  return new Response(null, {
    status: 302,
    headers: { 'Location': '/onboard.html' + new URL(req.url).search },
  });
};

export const config = {
  path: '/onboard/*',
  excludedPath: '/onboard/portal*',
  preferStatic: false,
};
