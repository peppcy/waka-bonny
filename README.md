# Waka Bonny — MVP

Verified keke, okada and taxi rides on Bonny Island at fixed zone fares, plus bus and Sienna seat booking between Bonny and Port Harcourt over the Bodo-Bonny road.

Stack: Node.js / Express / PostgreSQL. The frontend is plain HTML/JS in `public/`, served by the same Express app, so one Railway service runs everything.

## What's in the MVP

**Passengers**
- Book a keke, okada or taxi by neighbourhood (zone), with a landmark note for pickup
- See the fixed fare before booking; routes without a fare set can't be booked
- See the driver's name, plate, permit and rating once accepted; call the driver
- Share the trip by WhatsApp or SMS (public tracking link, no sign-in needed)
- SOS button during the trip (goes to the admin Safety tab)
- Confirm payment (cash or transfer) and rate the driver; report a problem
- Street hail: scan the QR badge on a vehicle (or type its code) to verify the driver and record the trip
- Bonny ⇄ Port Harcourt: browse departures, book 1–6 seats, next of kin captured for the manifest, cancel, SOS while on the road

**Keke / okada / taxi drivers**
- Sign up, then wait for in-person verification by the association
- Go online in an area, see requests (nearby ones first), accept (first to accept wins)
- Arrived → start → end trip flow; release a job before pickup
- Today's fares, trips and rating; printable QR badge

**Bus / Sienna drivers**
- Publish departures (route, time, seats); blocked outside the road hours set by admin
- Printable passenger manifest with next of kin; mark passengers boarded
- Boarding → departed → arrived; unboarded bookings become no-shows on departure

**Association / admin desk**
- Overview: drivers online, live rides, fares today, SOS and complaints, placeholder fares count
- Approve, reject, suspend, reinstate drivers; strikes (3 strikes = automatic suspension)
- Fares per vehicle type and area pair (placeholders until set); add or hide neighbourhoods
- Intercity seat prices per route (bus and Sienna), stops, all departures and manifests
- SOS alerts with call and track buttons; complaints → strike or dismiss
- Settings: night hours and surcharge, road opening hours, safety desk phone

## Before you launch: replace the placeholders

1. **Neighbourhoods**: set `HALE_API_URL` (your Hale API base URL) and `HALE_CITY=Bonny`, then run `npm run seed`. Zones are imported from Hale's `/api/neighbourhoods`. Re-run the seed whenever you add neighbourhoods in Hale; existing zones and fares are kept. Without `HALE_API_URL`, `config/neighbourhoods.js` is used.
2. **Fares**: all island fares start empty. Set them in Desk → Fares & areas.
3. **Intercity prices**: set bus and Sienna seat prices in Desk → Bonny ⇄ PH. Drivers can't publish departures until their price is set.
4. **Road hours**: defaults to 7:00–19:00. Change or clear in Desk → Settings.
5. **Safety desk phone**: set it in Settings so it shows on every SOS screen.

## Deploy on Railway (same as Hale)

1. Push this folder to a new private GitHub repo.
2. In Railway: New Project → Deploy from GitHub repo → pick the repo.
3. Add a PostgreSQL service to the project.
4. In the app service → Variables, add:
   - `DATABASE_URL` = reference the Postgres service's `DATABASE_URL`
   - `NODE_ENV` = `production` (turns on SSL for the database, same as Hale)
   - `JWT_SECRET` = a long random string (e.g. `openssl rand -hex 32`)
   - `ADMIN_NAME`, `ADMIN_PHONE`, `ADMIN_PIN` = your first admin login
5. Deploy. The schema is applied automatically on startup.
6. Run the seed once: Railway service → Settings → run `npm run seed` (or locally with the production `DATABASE_URL`).
7. Open the Railway URL, sign in with the admin phone and PIN, and set fares.
8. Add a custom domain in Railway → Settings → Networking.

**Frontend on Vercel instead?** Deploy `public/` to Vercel, set `window.WAKA_API` in `public/index.html` to the Railway URL, and set `CORS_ORIGINS` on Railway to the Vercel domain.

## Run locally

```bash
cp .env.example .env      # fill in DATABASE_URL, JWT_SECRET, admin details; set NODE_ENV=development for a local database
npm install
npm run seed
npm run dev               # http://localhost:3000
```

## Live GPS tracking

- **Before pickup**: the vehicle's position comes from the driver's phone (every 4 seconds on a job, every 15 seconds while online).
- **During the trip**: the passenger's own phone is the main tracker, since the passenger is inside the vehicle and watching. Their map moves instantly from their own GPS and their phone reports every 5 seconds (and at least every 10 seconds when stationary). Their screen is kept awake.
- **Fallback**: if the passenger's phone stops reporting for 30 seconds (app closed, GPS blocked), the map, share link and admin view switch to the driver's GPS automatically. The map label always says which phone the position comes from.
- The route driven is recorded from whichever source is live, and kept after the trip. The live position is hidden once the trip ends.
- The pickup point comes from the passenger's GPS at request time; the driver gets "Navigate to pickup" (Google Maps).
- Bus/Sienna passengers get "Track vehicle" (driver's GPS) plus their own blue dot.
- Phone browsers pause GPS when the app is closed or the screen locks. A wrapped Android app with a background-location plugin removes that limit.
- Maps use OpenStreetMap tiles (free, no key). For heavy traffic, switch the tile URL in `public/app.js` to a paid provider (MapTiler, Stadia) per OSM's usage policy.

## Mobile app (PWA)

- On Android Chrome: open the site → menu (⋮) → **Add to Home screen / Install app**. On iPhone Safari: Share → **Add to Home Screen**. It opens full-screen with its own icon, like a native app.
- Bottom tab bar on phones, 48px tap targets, 16px inputs (no iPhone zoom-on-tap), safe-area support for notched phones.
- The service worker caches the app shell for fast loading on weak networks. API calls and map tiles are never cached.

## Maps

- Default view is **Streets** (OpenStreetMap). Switch to **Satellite** with the 🗺️ button; the choice is remembered.
- The map centres itself once, then never changes the user's zoom. It follows the vehicle by panning only, pauses while the user is touching the map, and stops following if the user drags away (tap **Recenter** to resume).
- World map: users see their real position wherever they are (blue dot plus a pale circle showing GPS accuracy).
- **Full screen** button for passengers watching a trip.

## How it works

- **Dispatch**: requests are visible to all online, approved drivers of that vehicle type; nearby-zone requests are listed first. Accepting is an atomic update, so only one driver can win. Unaccepted requests time out after 5 minutes.
- **Live updates**: the app polls every 4–10 seconds. This is simple and works on weak networks; move to WebSockets later if needed.
- **Fares**: stored per zone pair (both directions) per vehicle type. `NULL` means placeholder.
- **Security**: phone + PIN (bcrypt), JWT sessions (30 days), rate-limited sign-in and sign-up, role checks on every route, parameterised SQL throughout.

## Sign-up with SMS code + PIN

New accounts: phone number → 6-digit SMS code (10 minutes, 5 attempts, 1 per minute) → name + PIN (entered twice; obvious PINs like 1234 or 1111 are refused). "Forgot your PIN?" on the sign-in screen resets it with a new SMS code. Signed-in users can change their PIN under Account.

Set `SMS_PROVIDER` to `termii` or `africastalking` with its keys. For Termii, use the **dnd** channel with an approved sender ID: the generic channel doesn't deliver to numbers on DND, which is most Nigerian lines. With `SMS_PROVIDER=console` and `NODE_ENV` not `production`, the code is shown on screen for testing.

## Parcels and errands

The Book tab has three services: Ride, Parcel and Errand. They use the same riders, zone fares (plus the parcel or errand fee set in Settings), dispatch and live tracking.
- **Parcel**: sender enters the item and the recipient's name and phone. The recipient gets an SMS with a 4-digit delivery code and a tracking link. The rider can only complete the delivery by entering that code.
- **Errand**: customer describes what to buy or do and the estimated item cost. The rider pays for the items and the customer refunds them in cash on delivery; the customer gives the rider the delivery code shown in their app.
- Deliveries are tracked with the rider's GPS (the customer isn't in the vehicle).

## Paystack payments

- Rides, parcels and errands: after the trip, "Pay online" (card, bank, USSD, transfer) or cash/transfer to the driver.
- Bonny ⇄ PH seats: "Pay now online" holds the seats for 15 minutes while paying; unpaid holds are released automatically. "Pay at the park" still works.
- Fares paid online go to the platform's Paystack account. Desk → **Payments** shows what each driver is owed; pay them and click **Mark paid out**.
- Set `PAYSTACK_SECRET_KEY`, and in the Paystack dashboard (Settings → API Keys & Webhooks) set the **Webhook URL** to `https://YOUR-DOMAIN/api/pay/webhook`. The webhook confirms payments even if the customer closes the page, and processes weekly subscription charges. All webhooks are signature-checked.

## Weekly driver subscriptions

- Turned on by setting **Weekly subscription (₦)** in Desk → Settings (empty or 0 = off). New drivers get a free trial (default 7 days).
- Drivers pay on their Work screen: **Pay weekly automatically** (Paystack charges their card every week) or **Pay 1 week** (any channel). They can stop automatic payment at any time.
- Expired drivers can't go online, accept jobs or publish departures.
- Cash paid at the association desk: Desk → Drivers → **+1 week (cash)**.

## Managing users (platform owner)

Desk → **Users**: every customer and driver, searchable by name or phone and filterable by type and status. Open a user to see their details, recent trips, complaints, payments and moderation history.
- **Ban**: requires a reason. The user is signed out at once, sees the reason when they try to use the app, and can't sign in. Pending trips are cancelled; a trip already under way is left to finish safely. **Unban** reverses it.
- **Delete**: requires a reason and typing DELETE. Name, phone, PIN, emergency contact, landmarks and GPS history are erased; trip and payment records stay, anonymised, for your accounts. Pending trips, unpaid bookings and the driver's upcoming departures are cancelled, and an automatic Paystack subscription is stopped. Tick **block this phone number** to stop them signing up again (the number is stored only as a one-way hash).
- Admin accounts can't be banned or deleted from the app. Every action is logged with the admin's name and the reason.

## Not in this MVP (phase 2)

- USSD booking for feature phones
- Native Android app (the web app works on Android now; it can be wrapped later)
- Corporate accounts for NLNG contractors
