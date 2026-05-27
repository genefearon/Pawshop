avascriptconst stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const SUPPLIERS = {
  avasam: {
    name: 'Avasam (UK)',
    email: 'orders@avasam.com',
    instructions: 'Please process this dropship order and ship directly to the customer. Mark the parcel as PawShop but do NOT include any supplier invoices or pricing in the package.',
  },
  jjpets: {
    name: 'JJ Pet Supplies',
    email: 'trade@jjpetsupplies.co.uk',
    instructions: 'Please process this dropship order and ship directly to the customer. Mark the parcel as PawShop. Do not include your own invoice or branding.',
  },
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'payment_intent.succeeded') {
    return { statusCode: 200, body: 'Event ignored' };
  }

  const paymentIntent = stripeEvent.data.object;
  const meta = paymentIntent.metadata;

  let items, shippingAddress;
  try {
    items = JSON.parse(meta.order_items || '[]');
    shippingAddress = JSON.parse(meta.shipping_address || '{}');
  } catch (e) {
    return { statusCode: 500, body: 'Failed to parse order data' };
  }

  const orderRef = meta.order_ref || paymentIntent.id;
  const amountGBP = (paymentIntent.amount / 100).toFixed(2);
  const customerName = meta.customer_name;
  const customerEmail = meta.customer_email;
  const orderDate = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

  const bySupplier = {};
  for (const item of items) {
    if (!bySupplier[item.supplier]) bySupplier[item.supplier] = [];
    bySupplier[item.supplier].push(item);
  }

  const emailPromises = [];

  for (const [supplierKey, supplierItems] of Object.entries(bySupplier)) {
    const supplier = SUPPLIERS[supplierKey];
    if (!supplier) continue;

    const itemsTable = supplierItems.map(i =>
      `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${i.name}</td><td style="padding:8px;text-align:center;">${i.qty}</td><td style="padding:8px;text-align:right;">£${(i.price*i.qty).toFixed(2)}</td></tr>`
    ).join('');

    emailPromises.push(transporter.sendMail({
      from: `"PawShop" <${process.env.GMAIL_USER}>`,
      to: supplier.email,
      replyTo: process.env.GMAIL_USER,
      subject: `NEW DROPSHIP ORDER ${orderRef} - Please Dispatch to Customer`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="background:#FF6B35;color:white;padding:20px;margin:0;">PawShop - New Dropship Order</h2>
        <div style="padding:20px;">
          <p><strong>Order Ref:</strong> ${orderRef}</p>
          <p><strong>Date:</strong> ${orderDate}</p>
          <p><strong>Payment:</strong> Confirmed via Stripe (£${amountGBP})</p>
          <h3>Items to Dispatch:</h3>
          <table style="width:100%;border-collapse:collapse;">${itemsTable}</table>
          <h3>Ship Directly To:</h3>
          <p>${customerName}<br/>${shippingAddress.line1}<br/>${shippingAddress.city}<br/>${shippingAddress.postcode}<br/>United Kingdom</p>
          <p><strong>Instructions:</strong> ${supplier.instructions}</p>
        </div>
      </div>`,
    }));
  }

  emailPromises.push(transporter.sendMail({
    from: `"PawShop" <${process.env.GMAIL_USER}>`,
    to: customerEmail,
    subject: `Your PawShop Order is Confirmed! - ${orderRef}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="background:#2A9D8F;color:white;padding:20px;margin:0;">Order Confirmed!</h2>
      <div style="padding:20px;">
        <p>Hi <strong>${customerName}</strong>,</p>
        <p>Thank you! Your payment of <strong>£${amountGBP}</strong> is confirmed.</p>
        <p><strong>Order Ref:</strong> ${orderRef}</p>
        <p><strong>Delivering to:</strong> ${shippingAddress.line1}, ${shippingAddress.city}, ${shippingAddress.postcode}</p>
        <h3>What you ordered:</h3>
        ${items.map(i => `<p>${i.qty}x ${i.name} - £${(i.price*i.qty).toFixed(2)}</p>`).join('')}
        <p style="color:#2A9D8F;font-weight:bold;">Estimated delivery: 2-4 working days</p>
      </div>
    </div>`,
  }));

  try {
    await Promise.all(emailPromises);
  } catch (emailErr) {
    console.error('Email error:', emailErr.message);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true, order: orderRef }) };
};
