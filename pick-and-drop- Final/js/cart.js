// Cart lives in localStorage and is display-only.
// At checkout the server must re-read prices from the products table.
const KEY = 'pd_cart_v1';
const empty = () => ({ merchant: null, items: [] });

export function getCart() {
  try { return JSON.parse(localStorage.getItem(KEY)) || empty(); } catch { return empty(); }
}
function save(c) {
  localStorage.setItem(KEY, JSON.stringify(c));
  window.dispatchEvent(new Event('cart'));
}
// Returns false when the cart already holds another merchant's items.
export function addItem(merchant, p) {
  const c = getCart();
  if (c.merchant && c.merchant.id !== merchant.id) return false;
  c.merchant = { id: merchant.id, slug: merchant.slug, name: merchant.name,
                 delivery_fee: Number(merchant.delivery_fee), min_order_amount: Number(merchant.min_order_amount) };
  const line = c.items.find(i => i.id === p.id);
  if (line) line.qty = Math.min(20, line.qty + 1); else c.items.push({ id: p.id, name: p.name, price: Number(p.price), qty: 1 });
  save(c);
  return true;
}
export function setQty(id, qty) {
  const c = getCart();
  c.items = c.items.map(i => i.id === id ? { ...i, qty: Math.min(20, qty) } : i).filter(i => i.qty > 0);
  if (!c.items.length) c.merchant = null;
  save(c);
}
export const clearCart = () => save(empty());
export const cartCount = () => getCart().items.reduce((n, i) => n + i.qty, 0);
export const cartSubtotal = () => getCart().items.reduce((n, i) => n + i.qty * i.price, 0);
