// Payment methods offered at checkout.
// Orange Money and Afrimoney are DEMO ONLY today: the database records a SIMULATED payment, no money moves and the
// reference is not verified. A real integration must verify payments on a server (Supabase Edge Function) and then call
// provider_confirm_payment with the service role key, which never goes in this browser code. See README.
// Cash on delivery is real: the customer pays the rider in cash and the rider records it in the rider dashboard.
export const SIMULATED = true;
export const METHODS = {
  ORANGE_MONEY: { label: 'Orange Money', demo: true, help: 'Demo only. No money is taken.' },
  AFRIMONEY: { label: 'Afrimoney', demo: true, help: 'Demo only. No money is taken.' },
  CASH_ON_DELIVERY: { label: 'Cash on delivery', demo: false, help: 'Pay the rider in cash when your order arrives.' },
};
export const validRef = v => v === '' || /^[A-Za-z0-9]{6,24}$/.test(v);
