# What still prevents a public launch

1. **No real payments.** Orange Money and Afrimoney are simulated. A confirmed payment needs a provider contract, a server-side webhook (a Supabase Edge Function holding the provider secret) that calls `provider_confirm_payment`, and refunds handling. The database hook exists and is locked to the service role. Nothing calls it yet.
2. **No real partners.** Every shop is DEMO / NOT PARTNERED. Real shops, menus, prices and written agreements are needed.
3. **Commercial terms are undecided.** Commission, rider pay and settlement schedule are blank on purpose. Settlement records are bookkeeping, not transfers.
4. **No notifications.** Merchants see an in-app alert only while the page is open. WhatsApp or SMS needs a provider and a server-side sender.
5. **Real photographs.** Pictures are original illustrations. Real photos need licensed or owned images; the image paths support a straight swap (images/README.md).
6. **Real device and Safari/Firefox testing.** Tests ran in Chromium only. Real phones, slow networks and iOS Safari are untested.
7. **Live Supabase Auth and Realtime** were not tested against a live project, only a stand-in.
8. **Rider tracking and dispatch** are manual (admin assigns). No live GPS, routing or automatic dispatch.
9. **Legal and operations**: terms of service, privacy policy, business registration, delivery liability, support process, cash handling policy for riders.
10. **Monitoring and backups**: error reporting, database backups, rate limiting and abuse controls beyond the PIN lock.
11. **Admin access hygiene**: use real personal admin logins, remove demo logins and the demo access links from the home page footer.
