# Update GitHub and deploy (do this only when you approve)

Nothing has been pushed or deployed. The files are in the ZIP. Your repository keeps the project inside a folder named `pick-and-drop- Final`; copy the ZIP contents into that folder, not the repository root.

## A. Database (Supabase SQL editor), in this order
1. Run `db/dev/diagnose_access.sql` first and keep the output (read only).
2. `db/migrations/06_payments_settlements.sql`. Migrations 01 to 05 must already be applied. Safe to run twice.
3. `db/dev/demo_seed.sql`. Safe to run twice. Adds six fictional shops, 33 items and a second demo rider.
4. In Authentication, Users, make sure three logins exist with Auto Confirm ticked (admin, merchant, rider).
5. Edit the three emails at the top of `db/dev/dev_link_staff.sql` if needed and run it. It stops with a clear message if anything is missing. The last result set shows who is linked to what.
6. Sign out and sign in again with every staff login.

## B. Supabase settings to check by hand
- Authentication, Providers: Anonymous sign-ins on, Email on.
- Authentication, URL configuration: Site URL set to your Vercel address.
- Database, Replication: tables `orders` and `payments` enabled for Realtime (optional; pages poll every 15 seconds without it).
- Never put the service_role key in any file. `js/config.js` holds only the project URL and the publishable key.

## C. GitHub
1. Unzip. Copy everything except `js/config.js` over the project folder, then check `git diff js/config.js` shows nothing unexpected. (The ZIP's config.js already holds your URL and publishable key.)
2. Before pushing to a PUBLIC repository, replace the three real emails in `db/dev/dev_link_staff.sql` with example addresses.
3. `git add -A && git commit -m "Merchant payments, order workflow, demo data" && git push`.

## D. Vercel
Vercel redeploys on push (no build step). Open the live site, hard refresh, and follow DEMO_SCRIPT.md. If something is wrong, Vercel, Deployments, previous deployment, Promote to Production rolls back. The database changes in step A are additive and do not need rolling back.
