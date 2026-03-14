// netlify/functions/fb-cpl-sync.js
// Scheduled daily — fetches 7-day rolling CPL from Facebook Marketing API
// and stores it in Firestore so hl-webhook can use it for auto-pricing
import https from 'https';
import crypto from 'crypto';

// ── FIREBASE ──────────────────────────────────────────────────
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
      res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No FB token: '+d));});
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

const BASE = () => `/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function toFS(v) {
  if (v===null||v===undefined) return {nullValue:null};
  if (typeof v==='boolean') return {booleanValue:v};
  if (typeof v==='number') return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if (typeof v==='string') return {stringValue:v};
  return {stringValue:String(v)};
}

async function fsSet(collection, docId, data) {
  const t      = await getFirebaseToken();
  const fields = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,toFS(v)]));
  return new Promise((resolve,reject)=>{
    const s = JSON.stringify({fields});
    const r = https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/${collection}/${docId}`,method:'PATCH',headers:{'Authorization':'Bearer '+t,'Content-Type':'application/json','Content-Length':Buffer.byteLength(s)}},res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve());
    });
    r.on('error',reject); r.write(s); r.end();
  });
}

// ── FACEBOOK API ──────────────────────────────────────────────
function fbGet(path) {
  return new Promise((resolve, reject) => {
    const r = https.request({hostname:'graph.facebook.com',path,method:'GET'},res=>{
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
    });
    r.on('error',reject); r.end();
  });
}

export default async (req) => {
  const token     = process.env.FB_ACCESS_TOKEN;
  const accountId = process.env.FB_AD_ACCOUNT_ID || 'act_1621705345436985';
  const markup    = parseFloat(process.env.FB_MARKUP||'2.5');

  if (!token || token === 'PASTE_YOUR_FACEBOOK_TOKEN_HERE') {
    console.log('[fb-cpl-sync] No Facebook token set — skipping');
    return;
  }

  try {
    // Get 7-day rolling spend and leads from all campaigns in the account
    const today  = new Date();
    const since  = new Date(today); since.setDate(since.getDate()-7);
    const fmt    = d => d.toISOString().slice(0,10);
    const timeRange = encodeURIComponent(JSON.stringify({since:fmt(since),until:fmt(today)}));

    const path = `/v20.0/${accountId}/insights?fields=spend,actions,cost_per_action_type&time_range=${timeRange}&action_type=lead&level=account&access_token=${token}`;
    const data = await fbGet(path);

    if (data.error) throw new Error(data.error.message);

    const insights = data.data?.[0];
    if (!insights) {
      console.log('[fb-cpl-sync] No insights data returned — possibly no leads in last 7 days');
      await fsSet('platform_config', 'fb_cpl', {
        cpl: 15, // fallback default
        spend: 0, leads: 0,
        markup, suggestedPrice: Math.round(15 * markup),
        updatedAt: new Date().toISOString(),
        source: 'fallback_no_data',
      });
      return;
    }

    const spend  = parseFloat(insights.spend||'0');
    // Count lead actions
    const actions= insights.actions||[];
    const leadAction = actions.find(a=>a.action_type==='lead'||a.action_type==='onsite_conversion.lead_grouped');
    const leads  = leadAction ? parseInt(leadAction.value||'0') : 0;

    // Also check cost_per_action_type
    const cpat   = insights.cost_per_action_type||[];
    const cplObj = cpat.find(a=>a.action_type==='lead'||a.action_type==='onsite_conversion.lead_grouped');
    let cpl      = cplObj ? parseFloat(cplObj.value||'0') : (leads>0 ? spend/leads : 15);

    // Sanity check — if CPL is 0 or unreasonably low, use fallback
    if (cpl < 1) cpl = 15;

    const suggestedPrice = Math.ceil(cpl * markup); // round up to protect margin

    console.log(`[fb-cpl-sync] spend=$${spend} leads=${leads} cpl=$${cpl.toFixed(2)} markup=${markup}x suggestedPrice=$${suggestedPrice}`);

    await fsSet('platform_config', 'fb_cpl', {
      cpl: Math.round(cpl * 100) / 100,
      spend, leads,
      markup, suggestedPrice,
      updatedAt: new Date().toISOString(),
      source: 'facebook_api',
      period: `${fmt(since)} to ${fmt(today)}`,
    });

    console.log('[fb-cpl-sync] Saved to Firestore successfully');
  } catch(e) {
    console.error('[fb-cpl-sync] Error:', e.message);
    // Save fallback so webhook still works
    await fsSet('platform_config', 'fb_cpl', {
      cpl: 15, spend: 0, leads: 0,
      markup, suggestedPrice: Math.round(15 * markup),
      updatedAt: new Date().toISOString(),
      source: 'fallback_error',
      error: e.message,
    }).catch(()=>{});
  }
};

export const config = {
  schedule: '0 6 * * *', // runs every day at 6am UTC
};
