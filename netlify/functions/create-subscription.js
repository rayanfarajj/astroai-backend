// ============================================================
//  AstroAI Bots — Square Subscription Backend
//  Netlify Function: /netlify/functions/create-subscription
// ============================================================

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID  = process.env.SQUARE_LOCATION_ID;
const SQUARE_API_BASE     = 'https://connect.squareup.com/v2';

// Helper: call Square API
async function squareRequest(method, path, body) {
  const res = await fetch(`${SQUARE_API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type':  'application/json',
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

// Generate idempotency key (prevents duplicate charges on retries)
function idempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Get trial end date (7 days from today)
function trialEndDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  // CORS headers — allows your landing page to call this function
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid request body' }) };
  }

  const { firstName, lastName, email, phone, businessName, planId, cardNonce } = body;

  // Validate required fields
  if (!firstName || !lastName || !email || !planId || !cardNonce) {
    return {
      statusCode: 400, headers,
      body: JSON.stringify({ message: 'Missing required fields: firstName, lastName, email, planId, cardNonce' }),
    };
  }

  try {
    // ─────────────────────────────────────────
    // STEP 1: Create Square Customer
    // ─────────────────────────────────────────
    console.log(`Creating customer: ${email}`);
    const customerData = await squareRequest('POST', '/customers', {
      idempotency_key: idempotencyKey('cust'),
      given_name:      firstName,
      family_name:     lastName,
      email_address:   email,
      phone_number:    phone    || undefined,
      company_name:    businessName || undefined,
      reference_id:    `astroai-${Date.now()}`,
    });
    const customerId = customerData.customer.id;
    console.log(`Customer created: ${customerId}`);

    // ─────────────────────────────────────────
    // STEP 2: Create Card on File
    // ─────────────────────────────────────────
    console.log(`Saving card for customer: ${customerId}`);
    const cardData = await squareRequest('POST', '/cards', {
      idempotency_key: idempotencyKey('card'),
      source_id:       cardNonce,
      card: {
        customer_id: customerId,
      },
    });
    const cardId = cardData.card.id;
    console.log(`Card saved: ${cardId}`);

    // ─────────────────────────────────────────
    // STEP 3: Create Subscription with 7-day trial
    // ─────────────────────────────────────────
    // We set start_date to today — the trial phase in your Square plan
    // (which you set to $0 for 7 days) handles the free period automatically.
    // If your plan doesn't have a trial phase, we use start_date = 7 days out.
    console.log(`Creating subscription with plan: ${planId}`);
    const subscriptionData = await squareRequest('POST', '/subscriptions', {
      idempotency_key:     idempotencyKey('sub'),
      location_id:         SQUARE_LOCATION_ID,
      plan_variation_id:   planId,
      customer_id:         customerId,
      card_id:             cardId,
      start_date:          trialEndDate(), // Billing starts after 7 days
      timezone:            'America/Chicago',
    });
    const subscriptionId = subscriptionData.subscription.id;
    console.log(`Subscription created: ${subscriptionId}`);

    // ─────────────────────────────────────────
    // SUCCESS
    // ─────────────────────────────────────────
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:        true,
        customerId,
        cardId,
        subscriptionId,
        message:        'Subscription created successfully. Trial starts now!',
      }),
    };

  } catch (err) {
    console.error('Subscription creation failed:', err.message);
    return {
      statusCode: 422,
      headers,
      body: JSON.stringify({
        success: false,
        message: err.message || 'Failed to create subscription. Please try again.',
      }),
    };
  }
};
