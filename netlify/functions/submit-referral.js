// netlify/functions/submit-referral.js
import https from 'https';
import crypto from 'crypto';
import { createTransport } from 'nodemailer';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function getFirebaseToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
    const b64   = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now   = Math.floor(Date.now()/1000);
    const hdr   = b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const pay   = b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const sig   = b64(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(key));
    const body  = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`;
    const req   = https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No token'));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function fsHttp(method, path, body, token) {
  return new Promise((resolve,reject)=>{
    const s = body?JSON.stringify(body):null;
    const r = https.request({hostname:'firestore.googleapis.com',path,method,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(s?{'Content-Length':Buffer.byteLength(s)}:{})}},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); if(s)r.write(s); r.end();
  });
}

function sv(v) { return { stringValue: String(v||'') }; }
function iv(v) { return { integerValue: String(parseInt(v)||0) }; }

async function fsSet(token, path, fields) {
  return fsHttp('PATCH', `${BASE()}/${path}`, {fields}, token);
}

async function fsGet(token, path) {
  return fsHttp('GET', `${BASE()}/${path}`, null, token);
}

export default async (req) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});
  if (req.method!=='POST')    return new Response(JSON.stringify({error:'POST only'}),{status:405,headers:CORS});

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }

  const {
    referrerSlug, referrerName, referrerBusiness,
    refereeName, refereeEmail, refereePhone, refereeBusinessName, refereeNote,
    agencyId,
  } = body;

  if (!referrerSlug || !refereeEmail) {
    return new Response(JSON.stringify({error:'referrerSlug and refereeEmail required'}),{status:400,headers:CORS});
  }

  const referralId = referrerSlug + '-ref-' + Date.now().toString(36);
  const now = new Date().toISOString();

  try {
    const token = await getFirebaseToken();

    // ── Save to root referrals collection (queryable by agencyId) ──
    await fsSet(token, `referrals/${referralId}`, {
      referralId:          sv(referralId),
      referrerSlug:        sv(referrerSlug),
      referrerName:        sv(referrerName),
      referrerBusiness:    sv(referrerBusiness),
      referrerClientName:  sv(referrerName),        // dashboard display alias
      referrerBusinessName:sv(referrerBusiness),    // dashboard display alias
      refereeName:         sv(refereeName),
      refereeEmail:        sv(refereeEmail),
      refereePhone:        sv(refereePhone),
      refereeBusinessName: sv(refereeBusinessName),
      refereeNote:         sv(refereeNote),
      status:              sv('pending'),
      agencyId:            sv(agencyId),
      source:              sv('client-portal'),
      createdAt:           sv(now),
    });

    // ── Update referral count on client record ──
    let countUpdated = false;
    if (agencyId) {
      try {
        const doc = await fsGet(token, `agencies/${agencyId}/clients/${referrerSlug}`);
        if (doc.fields) {
          const count = parseInt(doc.fields.referralCount?.integerValue||'0') + 1;
          await fsSet(token, `agencies/${agencyId}/clients/${referrerSlug}`, {
            ...doc.fields, referralCount: iv(count),
          });
          countUpdated = true;
        }
      } catch(e) { console.log('[submit-referral] agency count error:', e.message); }
    }
    if (!countUpdated) {
      try {
        const doc = await fsGet(token, `clients/${referrerSlug}`);
        if (doc.fields) {
          const count = parseInt(doc.fields.referralCount?.integerValue||'0') + 1;
          await fsSet(token, `clients/${referrerSlug}`, {
            ...doc.fields, referralCount: iv(count),
          });
        }
      } catch(e) {}
    }

    // ── Email notifications ──
    try {
      const transporter = createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_PASS}});

      // Get agency branding for custom referral bonus text
      let agencyName = 'Astro AI Marketing';
      let referralBonus = 'Both get 30% off when they sign up!';
      if (agencyId) {
        try {
          const agDoc = await fsGet(token, `agencies/${agencyId}`);
          if (agDoc.fields) {
            agencyName = agDoc.fields.brandName?.stringValue || agDoc.fields.name?.stringValue || agencyName;
            referralBonus = agDoc.fields.referralBonus?.stringValue || referralBonus;
          }
        } catch(e) {}
      }

      // Email agency owner
      await transporter.sendMail({
        from: `"${agencyName} Referrals" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `🤝 New Referral: ${referrerBusiness||referrerName} referred ${refereeBusinessName||refereeName||refereeEmail}`,
        html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f8fafc">
          <h2 style="color:#00d9a3;margin-bottom:4px">🤝 New Referral Submitted</h2>
          <p style="color:#666;margin-bottom:20px">A client just referred someone through their portal.</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#888;font-size:.8rem;width:120px">Referred By</td><td style="padding:8px 0;font-weight:600">${referrerName} — ${referrerBusiness||'—'}</td></tr>
            <tr><td style="padding:8px 0;color:#888;font-size:.8rem">Referee Name</td><td style="padding:8px 0">${refereeName||'—'}</td></tr>
            <tr><td style="padding:8px 0;color:#888;font-size:.8rem">Business</td><td style="padding:8px 0">${refereeBusinessName||'—'}</td></tr>
            <tr><td style="padding:8px 0;color:#888;font-size:.8rem">Email</td><td style="padding:8px 0">${refereeEmail}</td></tr>
            <tr><td style="padding:8px 0;color:#888;font-size:.8rem">Phone</td><td style="padding:8px 0">${refereePhone||'—'}</td></tr>
            ${refereeNote?`<tr><td style="padding:8px 0;color:#888;font-size:.8rem">Note</td><td style="padding:8px 0">${refereeNote}</td></tr>`:''}
          </table>
          <p style="margin-top:20px;font-size:.78rem;color:#aaa">Referral ID: ${referralId} — Check your agency dashboard Referrals tab.</p>
        </div>`,
      });

      // Email referee
      if (refereeEmail) {
        await transporter.sendMail({
          from: `"${agencyName}" <${process.env.GMAIL_USER}>`,
          to: refereeEmail,
          subject: `${referrerName} thinks you'd love this!`,
          html: `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f8fafc">
            <h2 style="color:#00d9a3">You've been referred!</h2>
            <p style="color:#444;line-height:1.7"><strong>${referrerName}</strong>${referrerBusiness?` from <strong>${referrerBusiness}</strong>`:''} referred you to <strong>${agencyName}</strong>.</p>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:20px;margin:20px 0;text-align:center">
              <p style="color:#9a3412;font-weight:700;font-size:1rem;margin:0 0 6px">🎁 Special Offer</p>
              <p style="color:#c2410c;font-size:.9rem;margin:0">${referralBonus}</p>
            </div>
            <p style="color:#444;line-height:1.7">We help businesses like yours generate more leads with AI-powered marketing campaigns.</p>
            <a href="https://marketingplan.astroaibots.com/onboard/${agencyId||''}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#00d9a3;color:#07090f;border-radius:8px;text-decoration:none;font-weight:700">Get Your Free Marketing Plan</a>
          </div>`,
        }).catch(e => console.log('[submit-referral] referee email failed:', e.message));
      }
    } catch(emailErr) {
      console.error('[submit-referral] email error:', emailErr.message);
    }

    return new Response(JSON.stringify({success:true, referralId}),{status:200,headers:CORS});

  } catch(e) {
    console.error('[submit-referral] error:', e.message);
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};

export const config = { path: '/api/submit-referral' };
