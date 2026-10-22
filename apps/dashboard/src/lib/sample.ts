/** Stripe-flavoured sample payloads for the "Send test event" button. */
const TYPES = [
  'payment_intent.succeeded',
  'checkout.session.completed',
  'invoice.paid',
  'customer.subscription.updated',
  'charge.refunded',
] as const;

const PRODUCTS = ['Oak desk organiser', 'Linen apron', 'Ceramic pour-over set', 'Wool throw'];

export function sampleEvent() {
  const type = TYPES[Math.floor(Math.random() * TYPES.length)] ?? TYPES[0];
  const amount = (Math.floor(Math.random() * 180) + 12) * 100 - 10;
  return {
    id: `evt_${Math.random().toString(36).slice(2, 14)}`,
    type,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        amount,
        currency: 'huf',
        description: PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)],
      },
    },
  };
}
