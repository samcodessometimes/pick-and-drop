# PICK & DROP (prototype, stage 7: merchant payments and order workflow)

Food and grocery delivery for Central Freetown and the Western Area. Static HTML/CSS/JS, Supabase backend, Vercel hosting, no build step.
Every shop is DEMO / NOT PARTNERED until an admin records a written agreement. **Payments, notifications and settlements are simulated or record-keeping only. No real money moves.**

## Setup (in order)

1. Create a Supabase project. Authentication > Providers: enable **Anonymous sign-ins** (customers) and keep Email enabled (staff).
2. SQL editor, run in this order:
   1. db/migrations/01_merchants.sql
   2. db/migrations/02_orders.sql
   3. db/migrations/03_dashboards.sql
   4. db/migrations/04_admin.sql
   5. db/migrations/05_qa_fixes.sql
   6. db/migrations/06_payments_settlements.sql
   7. db/dev/demo_seed.sql (fictional shops and menus for demos; remove before launch, removal SQL is in the file header)
   8. db/dev/dev_seed_grocers.sql (optional older test grocers)
3. Authentication > Users: create the admin, merchant and rider logins with "Auto confirm".
4. Put the three emails at the top of db/dev/dev_link_staff.sql and run it. It stops with a clear message if anything is missing. Sign out and in again afterwards.
5. js/config.js holds the project URL and the publishable key (public by design). Never put the service_role key in any file.
6. `npx serve .` or push to GitHub and import into Vercel.

Having trouble with an empty admin screen or a rider that is "not given access"? Read docs/DIAGNOSIS.md and run db/dev/diagnose_access.sql.

## Documents
- docs/DIAGNOSIS.md, docs/DEPLOY.md, docs/DEMO_SCRIPT.md, docs/LAUNCH_BLOCKERS.md, images/README.md, tests/README.md

## Pages
Customer (no login): index, merchant, cart, checkout, tracking.
Staff: login, merchant-dashboard, rider, admin (Overview, Orders, Merchants, Riders, Payments).

## Payment and money model
- Mobile money in this prototype is a **demo**: the order gets status SIMULATED and is never shown as paid. A confirmed payment can only come from `provider_confirm_payment`, callable by the service role (a future server-side webhook), never from a browser.
- Cash on delivery stays PENDING until the assigned rider records the cash at the door. An order cannot be delivered while cash is pending.
- Each order has a financial record computed by the database: items subtotal, delivery fee, commission, shop payout, rider pay, platform revenue. Commission and rider pay are **not set** until the admin enters them; until then the status is "waiting for terms". No rates are assumed.
- "Record payout" stores a reference to a payment you made outside the app. It does not transfer money.

## Tests (details and limits in tests/README.md)
Latest results on local PostgreSQL 16 and PostgREST 12.2.3:
- SQL: test_flows 25/25, test_admin 35/35, test_payments 82/82, test_privileges 116/116 (database logic, RLS and function grants).
- HTTP API: 102/102 (anonymous, customer, merchant, rider, admin, attacker, forged tokens, payments, settlements, staff linking).
- Page logic in jsdom: 21/21.
- Real Chromium end to end: 35/35 (full order journey on phone and desktop sizes, screenshots, broken image check, overflow check, access control).

## Not verified
- Real Supabase Auth, Realtime and your live project (stand-ins were used). Safari, Firefox and real phones. Real payment providers, SMS and WhatsApp (not built).
