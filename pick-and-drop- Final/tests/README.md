# Tests

All three suites need a local PostgreSQL 16. None touch a real Supabase project.

## SQL (db/tests)
Load db/tests/supabase_stub.sql, then migrations 01 to 05, then db/dev/dev_seed_grocers.sql, then run test_flows.sql, test_admin.sql and test_privileges.sql with `psql -v ON_ERROR_STOP=1`. Each prints PASS/FAIL rows.

## HTTP API (tests/api)
Needs the PostgREST 12.2.x binary. Load tests/api/fixtures.sql after the migrations, start PostgREST with tests/api/postgrest.conf (connects as the authenticator role, test-only JWT secret), then `node tests/api/api_security.test.mjs`. Covers anonymous, customer, merchant, rider, admin and attacker access, price and status tampering, PIN rules and forged tokens.

## Pages (tests/pages)
`cd tests/pages && npm install && node pages.test.mjs` with PostgREST running as above. Bundles the real page scripts with esbuild and runs them in jsdom with real supabase-js for data calls. Set VERBOSE=1 for progress.

## Limits
jsdom is not a browser. These tests do not check layout, CSS, real Supabase Auth, Realtime or the CDN import. The test JWT secret and the fixture users are for local use only.
