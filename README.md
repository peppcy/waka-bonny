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

## How it works

- **Dispatch**: requests are visible to all online, approved drivers of that vehicle type; nearby-zone requests are listed first. Accepting is an atomic update, so only one driver can win. Unaccepted requests time out after 5 minutes.
- **Live updates**: the app polls every 4–10 seconds. This is simple and works on weak networks; move to WebSockets later if needed.
- **Fares**: stored per zone pair (both directions) per vehicle type. `NULL` means placeholder.
- **Security**: phone + PIN (bcrypt), JWT sessions (30 days), rate-limited sign-in and sign-up, role checks on every route, parameterised SQL throughout.

## Not in this MVP (phase 2)

- SMS OTP phone verification (Termii hook goes in `src/routes/auth.js` register/login)
- Paystack payments for rides and intercity seats, and automated weekly driver subscriptions
- Live GPS map tracking (currently zone and landmark based)
- USSD booking for feature phones
- Native Android app (the web app works on Android now; it can be wrapped later)
- Corporate accounts for NLNG contractors
