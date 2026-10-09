// Payment methods. Verification is simulated in the database for the MVP
// (place_order marks the payment PAID). Real provider calls must run on a
// server or Supabase Edge Function, never in this file.
export const SIMULATED = true;
export const METHODS = {
  ORANGE_MONEY: { label: 'Orange Money' },
  AFRIMONEY: { label: 'Afrimoney' },
};
export const validRef = v => /^[A-Za-z0-9]{6,24}$/.test(v);
