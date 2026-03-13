// netlify/functions/delete-client.js
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_EMAIL   = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_KEY     = process.env.FIREBASE_PRIVATE_KEY;

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
async function getFirebaseToken() {
  const now = Math.floor(Date.now()/1000);
  const header  = base64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: FIREBASE_EMAIL, sub: FIREBASE_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  }));
  const signing = `${header}.${payload}`;
  const pemKey  = FIREBASE_KEY.replace(/\\n/g,'\n');
  const keyData = pemKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,'');
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', Buffer.from(keyData,'base64'),
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, Buffer.from(signing));
  const jwt = `${signing}.${base64url(new Uint8Array(sig))}`;
  const tr  = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const td = await tr.json();
  if (!td.access_token) throw new Error('Firebase auth failed');
  return td.access_token;
}

export default async (req) => {
  const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-internal-key',
  };

  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: CORS });

  if (req.headers.get('x-internal-key') !== process.env.INTERNAL_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const { slug } = await req.json();
    if (!slug) return new Response(JSON.stringify({ error: 'slug required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

    const token = await getFirebaseToken();
    const url   = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/clients/${slug}`;
    const res   = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });

    if (!res.ok && res.status !== 404) throw new Error('Firestore delete failed: ' + await res.text());

    console.log(`[delete-client] Deleted: ${slug}`);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch(e) {
    console.error('[delete-client] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/delete-client' };
