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
- Phone alerts when a driver accepts, arrives, starts and finishes, even with the app closed
- Street hail: scan the QR badge on a vehicle (or type its code) to verify the driver and record the trip
- Bonny ⇄ Port Harcourt: browse departures, book 1–6 seats, next of kin captured for the manifest, cancel, SOS while on the road

**Keke / okada / taxi drivers**
- Sign up, then wait for in-person verification by the association
- Go online in an area, see requests (nearby ones first), accept (first to accept wins)
- Arrived → start → end trip flow; release a job before pickup
- Today's fares, trips and rating; printable QR badge
- Phone alerts for new requests and depot runs, so the app does not have to stay open

**Bus / Sienna drivers**
- Publish departures (route, time, seats); blocked outside the road hours set by admin
- Printable passenger manifest with next of kin; mark passengers boarded
- Boarding → departed → arrived; unboarded bookings become no-shows on departure

**Association / admin desk**
- Overview: drivers online, live rides, fares today, SOS and complaints, placeholder fares count
- Reports: four Excel downloads (rides, driver earnings, depot packages, Port Harcourt manifests) for any period
- Approve, reject, suspend, reinstate drivers; strikes (3 strikes = automatic suspension)
- Fares per vehicle type and area pair (placeholders until set); add or hide neighbourhoods
- Intercity seat prices per route (bus and Sienna), stops, all departures and manifests
- SOS alerts with call and track buttons; complaints → strike or dismiss
- Settings: night hours and surcharge, road opening hours, safety desk phone
- Phone alerts for every SOS, on every admin's phone

## Before you launch: replace the placeholders

1. **Neighbourhoods**: set `HALE_API_URL`, `HALE_NEIGHBOURHOODS_PATH=/api/v1/neighbourhoods` and `HALE_CITY=Bonny`. Areas sync from Hale at every deploy, automatically every 30 minutes, and on demand (Desk → Fares & areas → **Sync from Hale now**). New Hale neighbourhoods appear; ones removed or renamed in Hale are hidden (their past trips and fares are kept). Areas you add by hand in the Desk are never hidden by a sync. After a rename, use **Copy fares from…** to carry the old area's prices over. A sync that returns fewer than 3 neighbourhoods is refused, so a Hale glitch can't wipe your areas.
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

- Default view is **Streets**. Switch to **Satellite** with the 🗺️ button; the choice is remembered.
- Defaults with a MapTiler key: **Streets** (`streets-v2`) and **Satellite Hybrid** (`hybrid`), which keeps road and place names over the imagery. Desk → Settings → **Maps** has a **Test map tiles** button that loads a real tile of Bonny from each map and says whether it works, so you never have to guess at a name.
- With `MAPTILER_KEY` set, tiles come from **MapTiler**. Without it, the free OpenStreetMap and Esri layers are used. If MapTiler tiles fail to load (wrong map name for your plan, key restricted to another domain, quota reached), the app quietly falls back to the free layers, so the map is never blank.
- The MapTiler key is visible in the browser, as all web map keys are. **Restrict it to your own domain** in the MapTiler dashboard. If the default map names are not on your plan, paste the exact tile URLs from your MapTiler maps page into `MAPTILER_STREETS_URL` and `MAPTILER_SATELLITE_URL`.
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

## Driver fees: launch campaign, then weekly subscriptions

- **Launch campaign (default)**: Desk → Settings → Driver fees → Mode = *Launch campaign: free for all drivers*. Drivers and vehicle owners sign up, go online and take jobs without paying anything. Drivers see a "Free during our launch campaign" card (with an end date if you set one).
- **Switching on weekly subscriptions later**: set the weekly amount and free-trial days, then change Mode to *Weekly subscription*. Every driver gets the free-trial days counted from the day you switch, so nobody is locked out suddenly. After that, Paystack charges drivers automatically each week (or they pay one week at a time); expired drivers can't go online. Cash paid at the desk: Drivers → **+1 week (cash)**.
- You can switch back to the campaign at any time.

## Online fares: split payments

When a customer pays a fare online, Paystack divides the money **as the payment happens**: your commission goes to Cylan Metro and the rest settles straight to the driver's own bank account. There is no manual payout, and none of the driver's money sits in your account.

- Every driver with a **verified bank account** automatically gets a Paystack subaccount. Adding or changing their bank account updates it.
- Desk → Settings → **Online payments**: set your commission (0–50%) and choose whether **Paystack's own fee** comes out of the driver's share or Cylan Metro's. Changing the commission updates every driver's subaccount at once.
- During the launch campaign the commission is **0%**, so drivers keep the full fare, and the fee comes out of the driver's share (the platform takes nothing, so it pays nothing).
- Drivers who have **not** added a bank account are paid the old way: the fare comes to you and appears under Desk → Payments as owed, to pay by transfer and mark off. The Payments tab shows how many drivers are still in that position.
- Weekly subscriptions are never split: they belong entirely to the platform.
- Deleting a driver switches their subaccount off, so nothing can settle to them afterwards.

## Messaging drivers and customers

Desk → **Messages** sends one SMS to a whole group: all drivers, approved drivers, drivers waiting for verification, drivers with no bank account, drivers whose subscription has expired, depot agents, customers, or everyone. Banned and deleted accounts are skipped.

Before sending, the Desk shows the recipient count and how many SMS it will cost (160 plain characters per SMS; accents and emoji cut that to 70). Sending needs a confirmation, runs in the background, and the history shows how many were delivered.

Use it to warn drivers before the launch campaign ends, to announce new areas or fares, or to tell agents about a change at the depot.

## Driver bank accounts (pay by transfer)

- Drivers add their bank and 10-digit account number on the Work screen (also while waiting for verification). Paystack checks it with the bank and saves the **real account name**; wrong numbers are refused. Without Paystack keys the driver types the name and it shows as *not verified*.
- When a customer chooses **Transfer** after a trip, they see that driver's bank, account number and verified account name with a **Copy** button. Bus/Sienna passengers see the same under their booking. Details are only shown to that driver's own customers.
- The same account appears in Desk → Drivers and Desk → Payments. It is also the account Paystack settles online fares to (see **split payments** above).
- Sign-up records who owns the vehicle: the driver, or a named owner with their phone.

## Driver documents

Drivers photograph four things in the app: **photo ID**, **vehicle papers**, **association or union permit**, and a **photo of the vehicle with its plate visible**. The phone shrinks each picture before sending it (long side 1400px, JPEG), so a 4MB photo arrives as roughly 70–200KB — important on a Bonny connection.

- Drivers can add documents while still waiting for verification, and replace any that are rejected.
- You review them in Desk → **Drivers → Open**: each image is shown full size with **Approve** or **Reject**. A rejection needs a reason, and the driver sees it on their Work screen.
- Desk → Settings → **Driver documents** decides whether every document must be approved before a driver can be approved at all. It is **optional by default**, so the launch campaign isn't held up; switch it on when you're ready.
- Images are kept in the database and are never public: the app shows them through a signed link that expires after 20 minutes. Deleting a driver erases their documents with the rest of their personal data.

## Terms, privacy and refunds

The three documents live in `legal/content.js`, which is the only place to edit them. `node legal/build-docx.js <folder>` regenerates both the Word files and `legal/legal.json`, which the app serves at `/api/public/legal`.

- They appear as pages in the app (Account → Legal, and from the sign-up screen) and at `/?legal=terms`, `/?legal=privacy`, `/?legal=refunds`.
- Creating an account requires ticking **I have read and accept the Terms of Use and the Privacy Policy**. The server refuses a sign-up without it and records the date of acceptance against the account.
- Opening a document from the sign-up screen keeps whatever has already been typed.

**These are drafts, not legal advice.** Have a Nigerian lawyer review them before you launch, especially the liability and refund sections.

## Keeping data only as long as promised

A clean-up runs every 24 hours so the Privacy Policy is true in practice, not just on paper:

- Location trails and the coordinates of pickups and drop-offs: deleted after 12 months (`RETENTION_MONTHS` changes this).
- Sign-in codes: deleted after 7 days.
- SOS alerts and complaints: deleted after 3 years.
- Sent SMS history: deleted after 2 years.

Trip, payment and account records are not touched by this: they stay, minus the location data. Payment records are kept 6 years for tax, as the policy says.

## Managing users (platform owner)

Desk → **Users**: every customer and driver, searchable by name or phone and filterable by type and status. Open a user to see their details, recent trips, complaints, payments and moderation history.
- **Ban**: requires a reason. The user is signed out at once, sees the reason when they try to use the app, and can't sign in. Pending trips are cancelled; a trip already under way is left to finish safely. **Unban** reverses it.
- **Delete**: requires a reason and typing DELETE. Name, phone, PIN, emergency contact, landmarks and GPS history are erased; trip and payment records stay, anonymised, for your accounts. Pending trips, unpaid bookings and the driver's upcoming departures are cancelled, and an automatic Paystack subscription is stopped. Tick **block this phone number** to stop them signing up again (the number is stored only as a one-way hash).
- Admin accounts can't be banned or deleted from the app. Every action is logged with the admin's name and the reason.

## Depot deliveries (goods arriving for people on the island)

For depots and logistics companies where goods arrive addressed to a person (name and phone on the package).

**Setup (owner):** Desk → **Depots** → add the depot (name, area, address, phone; stand at the depot and tap *Use my location*). The depot staff member signs up in the app as a customer, then you add them as an **agent** by phone. Next time they open the app they see the Depot screen.

**Agent, Register tab:** register each package (recipient name, phone, item, logistics charge), or paste a whole list, one per line: `Name, Phone, Item, Charge` (straight from Excel or WhatsApp). Each recipient immediately gets an SMS with their **4-digit code** and a link to their package page. Bad lines are reported, the rest are added.

**Recipient (SMS link, no account needed):** sees the package, the charge and their code, and chooses:
- **Collect at the depot**: show the code and pay the charge there, or
- **Deliver to me**: pick their area and landmark (and optionally share their location). They see the delivery fee (the zone fare from the depot's area + the parcel fee) and the total to pay the rider.

**Agent, Hand over tab:** search by name, phone or package ref; enter the recipient's code; record cash / transfer / already paid. If the SMS was lost, check a photo ID and write what was checked: it's recorded against the package. *Deliver* books delivery for someone who phoned in.

**Agent, Deliveries tab:** tick the packages going the same way, choose okada / keke / taxi and **Create run**. Nearby drivers see "📦 Depot run: N packages, you earn ₦X", sorted by distance.

**Driver:** accepts the run → goes to the depot → *I have all N packages* (recipients get an SMS that it's on the way, with a live tracking link) → at each stop, enters the recipient's code and records cash or transfer, or marks *Not delivered* with a reason → *Finish run*. The summary shows what they earned (the delivery fees) and the logistics charges to hand to the depot.

**Agent, Runs tab:** confirms undelivered packages are back at the depot, and confirms the cash received from the driver.

## Choosing an area

Area fields are type-to-search, not dropdowns: users type a few letters ("aki", "shell", "tolofari") and tap one of the matching areas shown under the box. Arrow keys and Enter work on a keyboard; typing a full area name exactly and moving on also selects it. Text that matches no area is outlined in red.

## Nearest driver first

Ride, parcel and errand requests and depot runs are sorted by real distance from the driver's live GPS to the pickup point (or depot), shown as "📍 800 m away". If GPS isn't available, requests from the driver's chosen area come first. Drivers no longer need to keep updating the area dropdown.

## Excel reports

Desk → **Reports**. Pick a period (or tap Today, Last 7 days, This month, Last month), then download.

| Report | Sheets | What it answers |
|---|---|---|
| **Rides and deliveries** | Trips · Day by day · Busiest routes · About | Every trip, parcel and errand; how each day went; which routes actually earn |
| **Driver earnings** | Earnings · About | What each driver earned, commission taken, what is still owed to them, their bank details, subscription state |
| **Depot packages** | Packages · Delivery runs · By depot · About | What arrived, what was collected or delivered, what came back, and the cash each driver owes a depot |
| **Port Harcourt departures** | Departures · Passenger manifest · About | How full each vehicle was, seat revenue, and a printable manifest with next of kin |

Depot packages can be narrowed to one depot, and Port Harcourt to one route.

**Every workbook ends with an About sheet** naming the period, when it was generated, and what each tricky column counts — so a figure can still be explained a month later. Totals are live `SUM` formulas, not pasted numbers, so the sheet still adds up after rows are filtered or deleted.

**Details worth knowing:**
- Dates are Lagos time throughout. Rides are counted by the day they were **requested**; driver earnings by the day a trip was **completed**; packages by the day they were **registered**; departures by the day the vehicle **departs**.
- Fare totals cover completed trips only. A cancelled trip still shows its quoted fare in the Trips sheet but is excluded from every total.
- "Owed to driver now" and "Depot cash not handed in" are running figures, not limited to the period — they are what is outstanding today.
- Every driver appears in the earnings report, including those who took no work, so you can see who has gone quiet.
- Files are built in memory and streamed straight to the browser; nothing is written to disk on the server.

The writer is `src/lib/xlsx.js`, about 200 lines using only Node's `zlib`. It was written rather than pulled from npm so the project keeps a clean `npm audit` — the usual Excel libraries drag in a dependency tree of their own.

## Phone alerts (push notifications)

Without these, a driver only sees a request while the app is open on screen. With them the phone buzzes like any other app.

**Switching them on (once, in Railway):**

1. In this project folder run `npm run push:keys`. It prints three lines. (The script uses only Node's own crypto, so it works in a freshly unzipped copy with nothing installed.)
2. Paste all three into Railway → waka-bonny → **Variables** → Raw Editor:
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (an email address people can reach you on; Google and Apple use it if something goes wrong).
3. Redeploy. Until these are set, nothing about alerts is shown anywhere in the app.

Keep the private key. Changing it later signs **every** phone out of alerts and each person has to switch them on again.

**What people do:** Account → **Turn on alerts**, allow the phone's prompt, then **Send a test alert** to be sure. Drivers and depot agents also see the same card at the top of their work screen. It can be turned off again on the same card, and signing out turns it off on that phone.

**On iPhone this only works from the Home Screen.** Safari itself cannot receive alerts: the person must use Share → **Add to Home Screen** and open Waka Bonny from that icon. The app says so instead of showing a button that cannot work. Android Chrome works either way, in the browser or installed.

**What gets sent:**

| Event | Who hears it |
|---|---|
| Ride, parcel or errand requested | Every approved driver of that vehicle type who is online, seen in the last 10 minutes and not already on a job |
| Driver accepted | The passenger |
| Driver arrived / trip started / trip finished | The passenger |
| Depot run created | The same free drivers of that vehicle type |
| Driver took a run | That depot's agents |
| Run finished | That depot's agents, with what was delivered, returned and owed in cash |
| SOS during a trip | Every admin, on every phone they have alerts on |
| Weekly subscription about to run out, or run out | That driver (once per week, and never if they pay automatically) |

Tapping an alert opens the app on the right screen, reusing the window if it is already open.

**Housekeeping, nothing to do:** an alert never blocks or slows the thing that triggered it. A phone that uninstalled the app or revoked permission is dropped the first time a push comes back as gone; one that keeps failing for another reason is dropped after ten tries. If someone reinstalls the app or you rotate the key, their phone re-registers itself the next time they open it.

## Not in this MVP (phase 2)

- USSD booking for feature phones
- Native Android app (the web app works on Android now; it can be wrapped later)
- Corporate accounts for NLNG contractors
