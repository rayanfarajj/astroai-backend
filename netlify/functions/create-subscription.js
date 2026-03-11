const ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';

const SQUARE_ACCESS_TOKEN = ENVIRONMENT === 'production'
  ? process.env.SQUARE_ACCESS_TOKEN_PRODUCTION
  : process.env.SQUARE_ACCESS_TOKEN_SANDBOX;

const SQUARE_LOCATION_ID = ENVIRONMENT === 'production'
  ? process.env.SQUARE_LOCATION_ID_PRODUCTION
  : process.env.SQUARE_LOCATION_ID_SANDBOX;

const SQUARE_API_BASE = ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com/v2'
  : 'https://connect.squareupsandbox.com/v2';

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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Invalid request body' }) }; }

  const { firstName, lastName, email, phone, businessName, planId, cardNonce } = body;
  if (!firstName || !lastName || !email || !planId || !cardNonce) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: 'Missing required fields.' }) };
  }

  try {
    console.log(`[${ENVIRONMENT}] API: ${SQUARE_API_BASE}`);

    // ─────────────────────────────────────────
    // STEP 1: $1 authorization hold to verify card is real
    // This charge is immediately voided — customer never sees it
    // ─────────────────────────────────────────
    console.log('Running $1 card verification...');
    const authPayment = await squareRequest('POST', '/payments', {
      idempotency_key:  idempotencyKey('auth'),
      source_id:        cardNonce,
      amount_money: {
        amount:   100, // $1.00 in cents
        currency: 'USD',
      },
      location_id:  SQUARE_LOCATION_ID,
      autocomplete:  false, // puts it in AUTHORIZED state, not captured
      note:         'Card verification hold — will be voided automatically',
      buyer_email_address: email,
    });

    const paymentId = authPayment.payment.id;
    const paymentStatus = authPayment.payment.status;
    console.log(`Auth hold created: ${paymentId} — status: ${paymentStatus}`);

    // If authorization failed the card is invalid — stop here
    if (paymentStatus !== 'APPROVED') {
      throw new Error('Card authorization failed. Please check your card details and try again.');
    }

    // ─────────────────────────────────────────
    // STEP 2: Immediately void the $1 hold
    // ─────────────────────────────────────────
    console.log(`Voiding auth hold: ${paymentId}`);
    await squareRequest('POST', `/payments/${paymentId}/cancel`, {});
    console.log('Auth hold voided successfully — card is valid');

    // ─────────────────────────────────────────
    // STEP 3: Create Customer
    // ─────────────────────────────────────────
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

    // ─────────────────────────────────────────
    // STEP 4: Create Card on File
    // ─────────────────────────────────────────
    const cardData = await squareRequest('POST', '/cards', {
      idempotency_key: idempotencyKey('card'),
      source_id:       cardNonce,
      card: { customer_id: customerId },
    });
    const cardId = cardData.card.id;
    console.log(`Card saved: ${cardId}`);

    // ─────────────────────────────────────────
    // STEP 5: Create Subscription — billing starts after 7-day trial
    // ─────────────────────────────────────────
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
        message: 'Card verified and subscription created! Trial starts now.',
      }),
    };

  } catch (err) {
    console.error('Error:', err.message);
    return {
      statusCode: 422,
      headers: CORS,
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};
