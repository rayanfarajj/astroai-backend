// netlify/functions/agency-settings.js
const { fsGet, fsSet } = require('./_firebase');
const { verifyToken, unauth, err, ok, CORS } = require('./_auth');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const auth = await verifyToken(event);
  if (auth.error) return unauth(auth.error);

  // Read agencyId from query string, body, or session token
  let agencyId = (event.queryStringParameters || {}).agencyId || auth.agencyId;
  if (!agencyId && event.httpMethod === 'POST') {
    try {
      const bodyParsed = JSON.parse(event.body || '{}');
      agencyId = bodyParsed.agencyId || auth.agencyId;
    } catch(e) {}
  }
  if (!auth.isAdmin && agencyId !== auth.agencyId) return unauth('Forbidden');

  if (event.httpMethod === 'GET') {
    try {
      const agency = await fsGet('agencies', agencyId);
      if (!agency) return err('Agency not found', 404);
      return ok({ agency });
    } catch(e) { return err(e.message); }
  }

  if (event.httpMethod === 'POST') {
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON', 400); }
    try {
      const agency = await fsGet('agencies', agencyId);
      if (!agency) return err('Agency not found', 404);
      const updated = {
        ...agency,
        brandName:       body.brandName       || agency.brandName,
        brandColor:      body.brandColor       || agency.brandColor,
        brandLogo:       body.brandLogo        || agency.brandLogo,
        onboardingTitle: body.onboardingTitle  || agency.onboardingTitle,
        welcomeMsg:      body.welcomeMsg       !== undefined ? body.welcomeMsg : agency.welcomeMsg,
        termsText:       body.termsText        !== undefined ? body.termsText  : agency.termsText,
        termsUrl:        body.termsUrl         !== undefined ? body.termsUrl   : (agency.termsUrl||''),
        privacyUrl:        body.privacyUrl           !== undefined ? body.privacyUrl           : (agency.privacyUrl||''),
        referralBonus:     body.referralBonus         !== undefined ? body.referralBonus         : (agency.referralBonus||''),
        referralResources: body.referralResources     !== undefined ? body.referralResources     : (agency.referralResources||''),
        metaBusinessId:     body.metaBusinessId     !== undefined ? body.metaBusinessId     : (agency.metaBusinessId||''),
        bookingUrl:        body.bookingUrl             !== undefined ? body.bookingUrl            : (agency.bookingUrl||''),
        supportPhone:      body.supportPhone           !== undefined ? body.supportPhone          : (agency.supportPhone||''),
        supportEmail:      body.supportEmail           !== undefined ? body.supportEmail          : (agency.supportEmail||''),
        agencyWebsite:     body.agencyWebsite          !== undefined ? body.agencyWebsite         : (agency.agencyWebsite||''),
        customLinks:       body.customLinks            !== undefined ? body.customLinks           : (agency.customLinks||''),
        updatedAt:       new Date().toISOString(),
      };
      await fsSet('agencies', agencyId, updated);
      return ok({ success: true, agency: updated });
    } catch(e) { return err(e.message); }
  }

  return err('Method not allowed', 405);
};
