# Client demo script (about 12 minutes)

Everything shown is demo data. Say this at the start: "These shops are fictional, the pictures are illustrations, and no real money or messages move. This shows how the order flow works."

## Before the meeting
- Run migration 06, `db/dev/demo_seed.sql`, and `db/dev/dev_link_staff.sql`. Create three logins first (admin, merchant, rider).
- Open four windows: a private window for the customer, and normal windows for merchant, rider and admin on separate browsers or profiles. Sign in to each. Admin must sign in after the admin link script ran.
- In Admin, Payments, leave commission empty unless you want to show terms being set.

## 1. Customer (private window, phone width)
1. Home: restaurants and groceries, every card says "Demo listing" and "Illustration".
2. Open Demo Jollof Kitchen. Add 2 Jollof rice and 1 soft drink.
3. Cart: subtotal NLe 215, delivery NLe 25, total NLe 240.
4. Checkout: fill name, phone, address. Choose **Cash on delivery**. Place the order.
5. Tracking shows the order number, "have NLe 240 ready", and the 4-digit delivery PIN. Keep this window visible.

## 2. Merchant
1. Select Demo Jollof Kitchen. The "Needs action" card shows 1 and a New order alert appears within 15 seconds (instantly if Realtime is on).
2. Open the order card: items, prices, totals, customer name, phone and address. Note the line "Payout not set yet. Commission terms are not agreed."
3. Press Accept, Start preparing, Mark ready for pickup. Switch to the customer window: tracking has moved.

## 3. Admin
1. Overview: counts come from the database. Point out the setup check.
2. Orders tab, open the order, choose Demo Rider 001, Assign. Offline riders cannot be chosen. A rider with two active orders is refused.

## 4. Rider
1. Open the delivery: pickup shop, delivery address, "Collect NLe 240 in cash". The PIN is not shown.
2. Press Accept delivery, Arrived at store, Picked up order, Start delivery, Arrived at customer.
3. Try to confirm: the PIN box is locked until the cash is recorded. Press "Cash collected".
4. Enter a wrong PIN (refused, tries left shown), then the PIN from the customer window. Delivered.

## 5. Money records (admin)
1. Payments tab: set commission (for example 10 percent) and rider pay. The order shows shop payout NLe 193.5 (215 less 21.5).
2. Press Record payout, type a reference such as DEMO-BANK-0001. Say clearly: "This records that you paid the shop outside the app. The app does not move money."
3. Merchant window: reload, the payout appears in "Payouts to this shop".

## Show if asked
- Demo mobile money order: the label says "Demo payment", never "Paid". Rejecting it marks it "Refunded (demo)".
- A merchant opening the admin page: "admins only".

## Do not say
- Do not call any shop a partner. Do not say payments or notifications are live. WhatsApp and SMS are not set up.
