# Diagnosis: empty admin dashboard and rider "not given access"

This is based on reading the code and the SQL. I could not see your live Supabase project, so the causes below are the ones the code can produce, not a confirmed finding about your database. Step 1 of the fix tells you which one you have.

## How access works (the rules that must hold)

- **Admin**: the database treats a login as admin only if its token carries `app_metadata.role = 'admin'`. Every `admin_*` function and every admin read policy checks this on the server. The claim is copied into the token at sign-in, so a login made admin after signing in must sign out and in again.
- **Merchant**: a login sees a shop only through a row in `merchant_staff` (login id + shop id).
- **Rider**: a login sees deliveries only if `riders.user_id` equals its login id.
- **Customer**: an anonymous session. It cannot reach any staff screen.

These rules were not weakened. Nothing here makes everyone an admin.

## Causes found

| Symptom | Cause | Where |
|---|---|---|
| Admin screens look empty | The login was not an admin (no claim, or claim added after sign-in). The admin functions refuse, and the old screens showed a blank area instead of saying why. | admin.html / js/admin.js (old behaviour), SQL `is_admin()` |
| Admin screens look empty even as admin | The database really had little to show: no orders, no riders with logins, and counts that were never seeded. Cards were fine, the data was zero. | Database contents |
| Rider login "not given access" | `riders.user_id` was never set for that login. The old link script updated a row by email and silently changed nothing when the email did not match exactly. | db/dev/dev_link_staff.sql (old version) |
| Merchant login "not linked" | Only one shop (Goodies) was linked, and only by the same silent script. | same |
| Rider page empty after assignment | The rider list was read through table queries that depend on the same link. No link, no rows. | js/rider.js (old) |

## What changed

1. **The link script now fails loudly.** `db/dev/dev_link_staff.sql` stops with a plain message if an email, merchant or rider is missing, refuses duplicates, and ends with a table showing exactly who is linked to what.
2. **Admins can link logins in the app.** Admin, Merchants, Logins (shop) and Admin, Riders, Link login (rider). These call `admin_link_staff`, which checks the login exists, refuses a rider already linked elsewhere, never grants admin, and writes an audit row.
3. **Setup check on the admin Overview.** It lists, from live counts: shops visible, shops with menus, shops with a login, riders with a login, orders placed, and whether commission terms are set. A red line says what is missing, so an empty screen now explains itself.
4. **Plain messages everywhere.** A merchant or rider login that is not linked gets a message naming the email and what to ask for. A non-admin gets "admins only". Nothing is a blank screen.
5. **Read-only diagnostic.** `db/dev/diagnose_access.sql` shows logins, admin claims, links, row counts and which functions exist.

## What you should do

1. Run `db/dev/diagnose_access.sql` and read the five result sets. They tell you which cause applies.
2. Run migration 06, then `db/dev/demo_seed.sql`, then the edited `db/dev/dev_link_staff.sql` (see DEPLOY.md for the exact order).
3. Sign out and sign in again on every device, so the admin claim reaches the token.
4. Open Admin, Overview. The setup check should show green ticks.

## Not verified

The fix was tested against a local PostgreSQL and a real browser with a stand-in sign-in service. I did not test against your live Supabase Auth. If the diagnostic shows the admin claim present, the links present and counts above zero, and a screen is still empty, send me the output of the five result sets.
