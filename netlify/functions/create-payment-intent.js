
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { amount, currency, metadata } = JSON.parse(event.body);

    if (!amount || amount < 50) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
    }
    if (currency !== 'gbp') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Only GBP accepted' }) };
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      metadata,
      automatic_payment_methods: { enabled: true },
      description: `PawShop order ${metadata.order_ref || ''}`,
      receipt_email: metadata.customer_email,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSecret: paymentIntent.client_secret }),
    };

  } catch (err) {
    console.error('create-payment-intent error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
