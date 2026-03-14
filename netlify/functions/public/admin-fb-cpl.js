// netlify/functions/admin-fb-cpl.js
// Returns current FB CPL data stored by fb-cpl-sync
import https from 'https';
import crypto from 'crypto';

const ADMIN_KEY = 'AstroAdmin2024!';
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type,x-admin-key','Content-Type':'application/json'};

function getToken() {
  return new Promise((resolve,reject)=>{
    const email=process.env.FIREBASE_CLIENT_EMAIL;const key=(process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n');
    const b64=s=>Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now=Math.floor(Date.now()/1000);const hdr=b64(JSON.stringify({alg:'RS256',typ:'JWT'}));
    const pay=b64(JSON.stringify({iss:email,sub:email,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,scope:'https://www.googleapis.com/auth/datastore'}));
    const sig=b64(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(key));
    const body=`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`;
    const r=https.request({hostname:'oauth2.googleapis.com',path:'/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},res=>{
      let d='';res.on('data',c=>d+=c);res.on('end',()=>{const t=JSON.parse(d).access_token;t?resolve(t):reject(new Error('No token'));});
    });r.on('error',reject);r.write(body);r.end();
  });
}
const BASE=()=>`/v1/projects/${process.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
function fromFS(v){if(!v)return null;if('stringValue'in v)return v.stringValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return v.doubleValue;if('booleanValue'in v)return v.booleanValue;return null;}

export default async (req) => {
  if (req.method==='OPTIONS') return new Response('',{status:200,headers:CORS});
  if (req.headers.get('x-admin-key')!==ADMIN_KEY) return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:CORS});
  try {
    const t=await getToken();
    const r=await new Promise((resolve,reject)=>{
      const req2=https.request({hostname:'firestore.googleapis.com',path:`${BASE()}/platform_config/fb_cpl`,method:'GET',headers:{'Authorization':'Bearer '+t}},res=>{
        let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});
      });req2.on('error',reject);req2.end();
    });
    if (!r.fields) return new Response(JSON.stringify({error:'No CPL data yet — sync runs daily at 6am UTC'}),{status:404,headers:CORS});
    const o={};for(const[k,v]of Object.entries(r.fields))o[k]=fromFS(v);
    return new Response(JSON.stringify({success:true,...o}),{status:200,headers:CORS});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
  }
};
export const config={path:'/api/admin/fb-cpl'};
