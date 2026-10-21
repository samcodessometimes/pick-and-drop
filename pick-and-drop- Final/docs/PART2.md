# Part 2: admin dashboard, merchant access and rider login

## What was checked
The current code, all six migrations, the link script and the diagnostic script were re-read against the Part 2 list, and every automated suite was re-run on the current code.

## Causes (from the earlier diagnosis, re-confirmed by the code and the tests)
| Symptom | Cause | Status |
|---|---|---|
| Admin dashboard empty | The login had no `app_metadata.role = 'admin'` claim (or got it after signing in), so every admin function refused. The data also did not exist yet (no orders, no riders with logins). | Server rules unchanged and correct. Screens now say why. |
| Rider "not given access" | `riders.user_id` was never set for that login. | Link script fails loudly, and admins can link a rider login inside the app. |
| Merchant sees no shop | No row in `merchant_staff` for that login. | Same link script and in-app linking. |

Which of these still applies to your live project can only be seen in your Supabase data. Run `db/dev/diagnose_access.sql` (read only) to find out.

## Changed in Part 2
- `js/admin.js`: a failed request is no longer reported as "not an admin". Three cases are now separate: not an admin, session expired, and database unreachable (with a Try again button).
- `db/dev/dev_link_staff.sql`: real email addresses removed. Placeholders must be replaced inside the Supabase SQL editor only.
- `tests/browser/browser.test.mjs`: new test for the database error state; admin refusal wording updated.
- `tests/pages/pages.test.mjs`: footer link count updated (Picture credits link added in Part 1).
- `docs/PART2.md`: this file.
No migration was changed. No policy was weakened. RLS is untouched.

## SQL
1. `db/dev/diagnose_access.sql`: read only. Run first.
2. `db/dev/dev_link_staff.sql`: only if the diagnostic shows a login with no admin claim or no shop or rider link. It changes only the three logins named at the top, never touches passwords, never turns RLS off, and is safe to run twice.

## Checking a login by hand
- Admin: sign in at the Admin link, then open Overview. The Setup check shows ticks. A grey "not an admin" message means the claim is missing or you need to sign out and in again.
- Merchant: sign in at the Merchant link. You should see only your own shop's name and orders.
- Rider: sign in at the Rider link. You should see "No deliveries assigned" or your own deliveries. "Not linked to a rider profile" means the link is missing.
