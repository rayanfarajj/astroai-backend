// _firebase.js — shared Firestore helpers for all SaaS functions
const https  = require('https');
const crypto = require('crypto');

function getToken() {
  return new Promise((resolve, reject) => {
    const email = process.env.FIREBASE_CLIENT_EMAIL;
    const key   = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const b64   = s => Buffer.from(s).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const now   = Math.floor(Date.now() / 1000);
    const hdr   = b64(JSON.stringify({ alg:'RS256', typ:'JWT' }));
    const pay   = b64(JSON.stringify({ iss:email, sub:email, aud:'https://oauth2.googleapis.com/token', iat:now, exp:now+3600, scope:'https://www.googleapis.com/auth/datastore' }));
    const sig   = b64(crypto.createSign('RSA-SHA256').update(hdr+'.'+pay).sign(key));
    const body  = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${hdr}.${pay}.${sig}`;
    const req   = https.request({ hostname:'oauth2.googleapis.com', path:'/token', method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)} }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end', () => { const t=JSON.parse(d).access_token; t ? resolve(t) : reject(new Error('No token: '+d)); });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function fsRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'firestore.googleapis.com', path, method,
      headers: { 'Authorization':'Bearer '+token, 'Content-Type':'application/json', ...(bodyStr ? {'Content-Length':Buffer.byteLength(bodyStr)} : {}) }
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const PROJECT = () => process.env.FIREBASE_PROJECT_ID;
const BASE    = () => `/v1/projects/${PROJECT()}/databases/(default)/documents`;

// Convert JS value → Firestore field value
function toFS(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean')        return { booleanValue: v };
  if (typeof v === 'number')         return { integerValue: String(v) };
  if (typeof v === 'object')         return { stringValue: JSON.stringify(v) };
  return { stringValue: String(v) };
}

// Convert Firestore field value → JS value
function fromFS(fv) {
  if (!fv) return null;
  if ('stringValue'  in fv) return fv.stringValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('nullValue'    in fv) return null;
  return null;
}

// Build fields map from plain object
function buildFields(obj) {
  const fields = {};
  Object.entries(obj).forEach(([k,v]) => { fields[k] = toFS(v); });
  return fields;
}

// Extract plain object from Firestore document fields
function extractDoc(doc) {
  if (!doc || !doc.fields) return null;
  const obj = { _id: doc.name.split('/').pop() };
  Object.entries(doc.fields).forEach(([k,v]) => { obj[k] = fromFS(v); });
  return obj;
}

// Parse stringified JSON fields
function parseJSON(obj, ...keys) {
  keys.forEach(k => {
    if (obj[k] && typeof obj[k] === 'string') {
      try { obj[k] = JSON.parse(obj[k]); } catch(e) { obj[k] = {}; }
    }
  });
  return obj;
}

async function fsGet(collection, docId) {
  const token = await getToken();
  const doc   = await fsRequest('GET', `${BASE()}/${collection}/${docId}`, null, token);
  if (doc.error) return null;
  return extractDoc(doc);
}

async function fsSet(collection, docId, data) {
  const token  = await getToken();
  const fields = buildFields(data);
  return fsRequest('PATCH', `${BASE()}/${collection}/${docId}`, { fields }, token);
}

async function fsList(collection, pageSize = 200) {
  const token = await getToken();
  const data  = await fsRequest('GET', `${BASE()}/${collection}?pageSize=${pageSize}`, null, token);
  return (data.documents || []).map(extractDoc).filter(Boolean);
}

async function fsListSub(agencyId, subCollection, pageSize = 200) {
  const token = await getToken();
  const data  = await fsRequest('GET', `${BASE()}/agencies/${agencyId}/${subCollection}?pageSize=${pageSize}`, null, token);
  return (data.documents || []).map(extractDoc).filter(Boolean);
}

async function fsSetSub(agencyId, subCollection, docId, data) {
  const token  = await getToken();
  const fields = buildFields(data);
  return fsRequest('PATCH', `${BASE()}/agencies/${agencyId}/${subCollection}/${docId}`, { fields }, token);
}

async function fsGetSub(agencyId, subCollection, docId) {
  const token = await getToken();
  const doc   = await fsRequest('GET', `${BASE()}/agencies/${agencyId}/${subCollection}/${docId}`, null, token);
  if (doc.error) return null;
  return extractDoc(doc);
}

async function fsDeleteSub(agencyId, subCollection, docId) {
  const token = await getToken();
  return fsRequest('DELETE', `${BASE()}/agencies/${agencyId}/${subCollection}/${docId}`, null, token);
}

module.exports = { fsGet, fsSet, fsList, fsListSub, fsSetSub, fsGetSub, fsDeleteSub, parseJSON, buildFields, toFS, fromFS };
