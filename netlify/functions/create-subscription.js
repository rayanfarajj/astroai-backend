const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID  = process.env.SQUARE_LOCATION_ID;
const SQUARE_API_BASE     = 'https://connect.squareup.com/v2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age':       '86400',
  'Content-Type':                 'application/json',
};

async function squareRequest(method, path, body) {
  const res = await fetch(`${SQUARE_API_BASE}${path}`, {
    method,
    headers: {
      'Authorization':  `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type':   'application/json',
      'Square-Version': '2024-01-18',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.errors?.[0]?.detail || data.errors?.[0]?.code || `Square error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function idempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function trialEndDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
}

exports.handler = async (event) => {
  // ALWAYS return CORS headers on every response including OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Invalid request body' }) };
  }

  const { firstName, lastName, email, phone, businessName, planId, cardNonce } = body;

  if (!firstName || !lastName || !email || !planId || !cardNonce) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ message: 'Missing required fields.' }),
    };
  }

  try {
    // STEP 1: Create Customer
    console.log(`Creating customer: ${email}`);
    const customerData = await squareRequest('POST', '/customers', {
      idempotency_key: idempotencyKey('cust'),
      given_name:      firstName,
      family_name:     lastName,
      email_address:   email,
      phone_number:    phone        || undefined,
      company_name:    businessName || undefined,
    });
    const customerId = customerData.customer.id;
    console.log(`Customer created: ${customerId}`);

    // STEP 2: Create Card on File
    console.log(`Saving card for: ${customerId}`);
    const cardData = await squareRequest('POST', '/cards', {
      idempotency_key: idempotencyKey('card'),
      source_id:       cardNonce,
      card: { customer_id: customerId },
    });
    const cardId = cardData.card.id;
    console.log(`Card saved: ${cardId}`);

    // STEP 3: Create Subscription — billing starts after 7-day trial
    console.log(`Creating subscription with plan: ${planId}`);
    const subData = await squareRequest('POST', '/subscriptions', {
      idempotency_key:   idempotencyKey('sub'),
      location_id:       SQUARE_LOCATION_ID,
      plan_variation_id: planId,
      customer_id:       customerId,
      card_id:           cardId,
      start_date:        trialEndDate(),
      timezone:          'America/Chicago',
    });
    const subscriptionId = subData.subscription.id;
    console.log(`Subscription created: ${subscriptionId}`);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        success: true,
        customerId,
        cardId,
        subscriptionId,
        message: 'Subscription created! Trial starts now.',
      }),
    };

  } catch (err) {
    console.error('Error:', err.message);
    return {
      statusCode: 422,
      headers: CORS,
      body: JSON.stringify({ success: false, message: err.message || 'Failed to create subscription.' }),
    };
  }
};
