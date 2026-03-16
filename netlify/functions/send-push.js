// netlify/functions/send-push.js
// Full RFC 8291 aes128gcm encrypted Web Push — required for iOS Safari
import https from 'https';
import crypto from 'crypto';

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function getToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
    const b64   = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now   = Math.floor(Date.now()/1000);
    const h = b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const p = b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const s = b64(crypto.createSign('RSA-SHA256').update(h+'.'+p).sign(key));
    const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${h}.${p}.${s}`;
    const r = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token; t?resolve(t):reject(new Error(d));});
    });
    r.on('error',reject); r.write(body); r.end();
  });
}

function fsHttp(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s=body?JSON.stringify(body):null;
    const r=https.request({hostname:'firestore.googleapis.com',path,method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); if(s)r.write(s); r.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function makeVapidJWT(audience) {
  const subject    = process.env.VAPID_SUBJECT || 'mailto:info@astroaibots.com';
  const pubKeyB64  = process.env.VAPID_PUBLIC_KEY;
  const privKeyB64 = process.env.VAPID_PRIVATE_KEY;
  if (!pubKeyB64 || !privKeyB64) throw new Error('VAPID keys not set');
  const b64u = b => Buffer.from(b).toString('base64url');
  const now  = Math.floor(Date.now()/1000);
  const header  = b64u(JSON.stringify({typ:'JWT',alg:'ES256'}));
  const payload = b64u(JSON.stringify({aud:audience,exp:now+43200,sub:subject}));
  const privRaw = Buffer.from(privKeyB64,'base64url');
  const pkcs8   = Buffer.concat([Buffer.from('308141020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420','hex'),privRaw]);
  const privKey = crypto.createPrivateKey({key:pkcs8,format:'der',type:'pkcs8'});
  const sigDer  = crypto.createSign('SHA256').update(`${header}.${payload}`).sign(privKey);
  const derToRaw = der => {
    let i=2; if(der[1]&0x80) i+=der[1]&0x7f;
    i++; const rLen=der[i++]; const r=der.slice(i+(rLen>32?rLen-32:0),i+rLen); i+=rLen;
    i++; const sLen=der[i++]; const s=der.slice(i+(sLen>32?sLen-32:0),i+sLen);
    return Buffer.concat([Buffer.alloc(32-r.length),r,Buffer.alloc(32-s.length),s]);
  };
  return `${header}.${payload}.${b64u(derToRaw(sigDer))}`;
}

// RFC 8291 aes128gcm encryption — the ONLY format iOS Safari accepts
function encryptPayload(plaintext, subscription) {
  const clientPub  = Buffer.from(subscription.keys.p256dh,'base64url');
  const authSecret = Buffer.from(subscription.keys.auth,'base64url');
  const serverECDH = crypto.createECDH('prime256v1');
  serverECDH.generateKeys();
  const serverPub    = serverECDH.getPublicKey();
  const sharedSecret = serverECDH.computeSecret(clientPub);
  const salt = crypto.randomBytes(16);

  const prkKey = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret,
    Buffer.concat([Buffer.from('WebPush: info\x00'), clientPub, serverPub]), 32));

  const cek   = Buffer.from(crypto.hkdfSync('sha256', prkKey, salt, Buffer.from('Content-Encoding: aes128gcm\x00'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', prkKey, salt, Buffer.from('Content-Encoding: nonce\x00'), 12));

  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.allocUnsafe(4); rs.writeUInt32BE(4096,0);
  return Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub, encrypted]);
}

function sendWebPush(subscription, payload) {
  return new Promise((resolve, reject) => {
    if (!subscription?.endpoint) return reject(new Error('No endpoint'));
    if (!subscription?.keys?.p256dh || !subscription?.keys?.auth)
      return reject(new Error('Missing encryption keys in subscription'));

    const body         = encryptPayload(JSON.stringify(payload), subscription);
    const endpointUrl  = new URL(subscription.endpoint);
    const jwt          = makeVapidJWT(`${endpointUrl.protocol}//${endpointUrl.host}`);

    const r = https.request({
      hostname: endpointUrl.hostname,
      path:     endpointUrl.pathname + endpointUrl.search,
      method:   'POST',
      headers:  {
        'Authorization':    `vapid t=${jwt},k=${process.env.VAPID_PUBLIC_KEY}`,
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length':   body.length,
        'TTL':              '86400',
      },
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{
        console.log('[send-push]',res.statusCode, endpointUrl.hostname);
        if (res.statusCode>=200&&res.statusCode<300) resolve({ok:true,status:res.statusCode});
        else if (res.statusCode===410||res.statusCode===404) resolve({ok:false,gone:true,status:res.statusCode});
        else resolve({ok:false,status:res.statusCode,body:d.slice(0,200)});
      });
    });
    r.setTimeout(15000,()=>{r.destroy();reject(new Error('Push timeout'));});
    r.on('error',reject); r.write(body); r.end();
  });
}

export default async (req) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});
  if (req.method!=='POST') return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});
  let data;
  try { data=await req.json(); } catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  const {agencyId,clientId,title,body:msgBody,url,tag} = data;
  if (!agencyId||!clientId) return new Response(JSON.stringify({error:'agencyId and clientId required'}),{status:400,headers:CORS});

  try {
    const token = await getToken();
    const doc   = await fsHttp('GET',`${BASE()}/agencies/${agencyId}/clients/${clientId}`,null,token);
    if (!doc.fields) return new Response(JSON.stringify({error:'Client not found'}),{status:404,headers:CORS});

    const pushSubRaw = doc.fields.pushSubscription?.stringValue;
    if (!pushSubRaw) return new Response(JSON.stringify({ok:false,reason:'No subscription'}),{status:200,headers:CORS});

    let sub;
    try { sub=JSON.parse(pushSubRaw); } catch { return new Response(JSON.stringify({ok:false,reason:'Bad subscription JSON'}),{status:200,headers:CORS}); }

    const portalUrl = url||`/onboard/portal?a=${agencyId}&s=${clientId}`;
    const result = await sendWebPush(sub, {
      title: title||'Marketing Portal',
      body:  msgBody||'You have a new update.',
      icon:  '/icons/portal-icon-192.png',
      tag:   (tag||'portal')+'-'+Date.now(),
      url:   portalUrl,
      data:  {url:portalUrl},
    });

    if (result.gone) {
      await fsHttp('PATCH',`${BASE()}/agencies/${agencyId}/clients/${clientId}?updateMask.fieldPaths=pushSubscription`,
        {fields:{pushSubscription:{nullValue:null}}},token).catch(()=>{});
    }
    return new Response(JSON.stringify(result),{status:200,headers:CORS});
  } catch(e) {
    console.error('[send-push] error:',e.message);
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/send-push' };
