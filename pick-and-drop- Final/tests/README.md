# Tests

All suites need a local PostgreSQL 16. None touch a real Supabase project. The test JWT secret and fixture users are for local use only.

## SQL (db/tests)
Load db/tests/supabase_stub.sql, then migrations 01 to 06, then run each of test_flows.sql, test_admin.sql, test_payments.sql, test_privileges.sql on a fresh database with `psql -v ON_ERROR_STOP=1`. They print PASS/FAIL rows and are not meant to be run twice on one database.

## HTTP API (tests/api)
Needs the PostgREST 12.2.x binary. Load tests/api/fixtures.sql after the migrations, start PostgREST with tests/api/postgrest.conf, then `node tests/api/api_security.test.mjs`. Section F covers payments, cash on delivery, the merchant dashboard, settlements and staff linking.

## Pages in jsdom (tests/pages)
`cd tests/pages && npm install && node pages.test.mjs`. Runs the real page scripts in jsdom. The staff dashboards and checkout flows were moved to the browser suite when the screens were rebuilt; see the note at the top of pages.test.mjs.

## Real browser (tests/browser)
`cd tests/browser && npm install && node browser.test.mjs`. Needs PostgREST running, the migrations, db/dev/demo_seed.sql, tests/api/fixtures.sql and tests/browser/fixtures.sql loaded. Runs the unmodified pages in Chromium and walks customer, merchant, admin and rider through one cash order, then records settlement. Screenshots go to tests/browser/shots (set SHOTS to change).

## Faked in the browser suite
Supabase Auth (sign-in answered locally with signed test tokens), Realtime (websocket closed, so pages poll), Google Fonts and the supabase-js CDN file (served locally). Everything else is real: Chromium, the page code, PostgREST, PostgreSQL, RLS, triggers and functions.

## Not covered
Real Supabase, Safari, Firefox, real phones, real payment providers, SMS or WhatsApp.
