// netlify/functions/add-client.js
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_EMAIL   = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_KEY     = process.env.FIREBASE_PRIVATE_KEY;

// ── Firebase JWT ───────────────────────────────────────────────────────────────
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

  const pemKey = FIREBASE_KEY.replace(/\\n/g,'\n');
  const keyData = pemKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g,'');
  const binaryKey = Buffer.from(keyData,'base64');
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, Buffer.from(signing));
  const jwt = `${signing}.${base64url(new Uint8Array(sig))}`;

  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const td = await tr.json();
  if (!td.access_token) throw new Error('Firebase auth failed: ' + JSON.stringify(td));
  return td.access_token;
}

async function firestoreSet(token, slug, fields) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/clients/${slug}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('Firestore write failed: ' + await res.text());
  return res.json();
}

function sv(val) { return { stringValue: String(val || '') }; }
function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60); }

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
    const body = await req.json();
    const { firstName, lastName, email, businessName, phone, industry, primaryService,
            adBudget, adPlatforms, goal90Days, authPdfUrl } = body;

    if (!firstName || !businessName || !email) {
      return new Response(JSON.stringify({ error: 'firstName, businessName, and email are required' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const slug = slugify(businessName) + '-' + Date.now().toString(36);
    const now  = new Date().toISOString();
    const dashboardUrl = `https://marketingplan.astroaibots.com/plans/${slug}.html`;

    const token = await getFirebaseToken();
    await firestoreSet(token, slug, {
      clientName:     sv(`${firstName} ${lastName}`.trim()),
      firstName:      sv(firstName),
      lastName:       sv(lastName || ''),
      clientEmail:    sv(email),
      businessName:   sv(businessName),
      phone:          sv(phone || ''),
      industry:       sv(industry || ''),
      primaryService: sv(primaryService || ''),
      adBudget:       sv(adBudget || ''),
      adPlatforms:    sv(adPlatforms || ''),
      goal90:         sv(goal90Days || ''),
      authPdfUrl:     sv(authPdfUrl || ''),
      status:         sv('new'),
      statusLabel:    sv('🆕 New'),
      dashboardUrl:   sv(dashboardUrl),
      createdAt:      sv(now),
      generatedAt:    sv(now),
      source:         sv('manual'),
    });

    console.log(`[add-client] Created: ${slug}`);
    return new Response(JSON.stringify({ success: true, slug, dashboardUrl }), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch(e) {
    console.error('[add-client] Error:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
};

export const config = { path: '/api/add-client' };
