// Plain-language labels for order, delivery and payment states. No imports, so any page can use it.
export const ORDER_LABEL = {
  PENDING_PAYMENT: 'Awaiting payment', PLACED: 'New order', ACCEPTED: 'Accepted', PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup', DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
};
export const DELIVERY_LABEL = {
  UNASSIGNED: 'No rider yet', ASSIGNED: 'Rider assigned', ACCEPTED: 'Rider accepted', AT_MERCHANT: 'Rider at store',
  PICKED_UP: 'Picked up', ON_THE_WAY: 'On the way', AT_CUSTOMER: 'At customer', DELIVERED: 'Delivered',
};

// Describes a payment record for display. tone: ok (money confirmed), wait (still to come), demo (no real money), bad.
export function payInfo(p) {
  if (!p) return { text: 'No payment recorded', detail: '', tone: 'wait' };
  const cash = p.method === 'CASH_ON_DELIVERY';
  switch (p.status) {
    case 'SIMULATED': return { text: 'Demo payment', detail: 'No real money was taken and the reference was not verified.', tone: 'demo' };
    case 'PAID': return cash ? { text: 'Cash collected', detail: 'The rider recorded the cash at delivery.', tone: 'ok' }
                             : { text: 'Payment confirmed', detail: 'Verified by the payment provider.', tone: 'ok' };
    case 'PENDING': return cash ? { text: 'Cash on delivery', detail: 'The customer pays cash to the rider at the door. Not paid yet.', tone: 'wait' }
                                : { text: 'Payment pending', detail: 'Waiting for the payment provider to confirm.', tone: 'wait' };
    case 'FAILED': return { text: 'Payment failed', detail: p.note || '', tone: 'bad' };
    case 'REFUNDED': return { text: p.is_simulated ? 'Refunded (demo)' : 'Refunded', detail: p.is_simulated ? 'The demo payment was reversed. No real money moved.' : '', tone: 'demo' };
    case 'CANCELLED': return { text: 'Payment cancelled', detail: 'The order was cancelled before any payment was collected.', tone: 'bad' };
    default: return { text: p.status, detail: '', tone: 'wait' };
  }
}

export const METHOD_LABEL = { ORANGE_MONEY: 'Orange Money', AFRIMONEY: 'Afrimoney', CASH_ON_DELIVERY: 'Cash on delivery' };
export const SETTLEMENT_LABEL = {
  NOT_DUE: 'Not due yet', PENDING_TERMS: 'Waiting for commission terms', OWED: 'Owed to the shop', SETTLED: 'Settled (recorded)', VOID: 'Void (order not completed)',
};
export const RIDER_PAY_LABEL = {
  NOT_DUE: 'Not due yet', PENDING_TERMS: 'Waiting for rider pay terms', OWED: 'Owed to the rider', PAID: 'Paid (recorded)', VOID: 'Void',
};
