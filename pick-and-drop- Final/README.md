# PICK & DROP (MVP, stage 6: QA audit and fixes)

Food and grocery delivery for Central Freetown and the Western Area. Static HTML/CSS/JS, Supabase backend, Vercel hosting.
Every merchant is DEMO / NOT PARTNERED until an admin records a written agreement. Payments, riders and GPS are simulated.

## Setup (in order)

1. Create a Supabase project. Authentication > Providers: enable **Anonymous sign-ins** (customers) and keep Email enabled (staff).
2. SQL editor, run in this order:
   1. db/migrations/01_merchants.sql
   2. db/migrations/02_orders.sql
   3. db/migrations/03_dashboards.sql
   4. db/migrations/04_admin.sql
   5. db/migrations/05_qa_fixes.sql
   6. db/dev/dev_seed_grocers.sql  (optional test grocers plus 3 TEST items on Goodies; must run AFTER 05; remove before a public demo)
3. Authentication > Users: create users with "Auto confirm" (for example admin@example.test, merchant@example.test, rider@example.test) and set passwords.
4. Edit the emails in db/dev/dev_link_staff.sql and run it. It makes one user an admin (stored in app_metadata, which users cannot edit), links one user to Goodies (still DEMO) and one to Demo Rider 001. **Sign out and in again** after being made admin so the claim reaches your token.
5. Put the Project URL and the **anon** key in js/config.js. Never put the service_role key in any project file.
6. Run `npx serve .` or push to GitHub and import into Vercel (no build step).

Already on the Step 5 database? Run only 05_qa_fixes.sql. It is safe to run twice and migrates existing data.

## Pages

Customer (no login): index, merchant, cart, checkout, tracking.
Staff (email login, linked from the home page footer): login, merchant-dashboard, rider, admin.
Signing in as staff replaces the anonymous customer session in that browser, so test customers in a private window.

## What migration 05 changed

- Fixed: order placement failed on Supabase because the PIN used pgcrypto, which is not on the function search path there. The PIN now comes from gen_random_uuid.
- Fixed: internal merchant fields (internal notes, data source, source URL, owner id, partnership date) were readable by anyone through the public API. They now live in merchant_internal (admin only) and the public view lists safe columns explicitly.
- Fixed: a rider could stay marked busy after a merchant rejection or a PIN delivery. Both now free the rider correctly.
- New: admin_unlock_delivery_pin (audited) for a PIN locked after 5 wrong attempts, with an Unlock button in the admin order view.
- Fixed: a latitude without a longitude (or the reverse) is refused with a clear error. Cart quantity is capped at 20. Error styling in the checkout message area resets between calls.
- Trigger functions can no longer be called directly through the API.

## Manual test checklist

1. Customer (private window): home, open Goodies, add items, cart, checkout with a Freetown address, pay with simulated Orange Money. The tracking page shows the 4-digit PIN.
2. Merchant user: merchant-dashboard shows the order. Accept, Preparing, Ready. Reject another order and check the customer sees Cancelled.
3. Admin: Orders tab, assign Demo Rider 001.
4. Rider user: rider.html shows the delivery. Pick up, then enter a wrong PIN (refused), then the right PIN (Delivered).
5. After 5 wrong PINs the order locks. As admin open the order and use Unlock PIN.
6. As a customer or merchant user open admin.html: "admins only". The rider page never shows the PIN.
7. Admin Merchants: ACTIVE needs the confirmation box and an existing owner email. SUSPENDED hides the merchant from the home page.
8. Supabase table editor: admin_audit_log has one row per admin action.

## Verified (automated, details in tests/README.md)

- Database logic: test_flows.sql 25/25, test_admin.sql 35/35, test_privileges.sql 70/70, on real PostgreSQL 16 with a Supabase-like stub (roles, extensions schema, default grants).
- HTTP/API security: 92/92 checks through real PostgREST 12.2.3 with signed test tokens (anonymous, customer, merchant, rider, admin, attacker, forged and expired tokens). Direct writes to orders, payments, PINs, prices, statuses and staff tables are refused. The upgrade from the Step 5 database was tested and is repeatable.
- Page logic: 48/48 checks that run the real page scripts in jsdom against that PostgREST.

## NOT verified

- No real browser was available. Layout, CSS, phone view, and the CDN import of supabase-js were not tested.
- No live Supabase project was available. Real Supabase Auth (anonymous sign-in, email login, token refresh), Realtime updates and the dashboard settings were not tested. jsdom uses a fake auth and realtime layer.
- Row Level Security was tested against a stand-in database, not Supabase itself.

## Launch blockers

- Run the manual checklist above on a real Supabase project and a real phone before anyone else uses it.
- Real Orange Money and Afrimoney verification in an Edge Function. Refunds on cancel only mark SIMULATED payments.
- Anonymous customer accounts lose orders if browser data is cleared. Add phone or email login.
- Admin MFA and a reviewed process for granting the admin role.
- Rate limiting on place_order and sign-in, monitoring and backups. Enable Supabase CAPTCHA for anonymous sign-ins.
- Pin supabase-js locally or add subresource integrity; add security headers on Vercel.
- Real merchants, partnership agreements, delivery fees and coordinates. Remove the dev seed.
- Admin cannot yet edit products, link rider logins or manage service areas from the UI (use SQL).
- Independent security review before public launch.
