# Waka Bonny — Android app

A thin Android shell around the live site. It exists for one reason the browser cannot do:
**keep sharing a driver's location while their screen is off and they are using WhatsApp.**

The app does **not** contain a copy of the web app. It loads `https://wakabonny.ng`, so every
deploy to Railway reaches app users immediately — you only rebuild the APK when something in
this folder changes.

This folder is separate from the server on purpose: the Capacitor build tools stay out of the
server's dependencies, so `npm audit` in the project root stays clean.

---

## What you need once

1. **Android Studio** (includes the Android SDK and a JDK) — https://developer.android.com/studio
2. **Node.js** — already installed if you have been deploying Waka Bonny.

## Build it

```bash
cd android-app
npm install
npx cap sync android      # copies config and plugins into the Android project
npx cap open android      # opens the project in Android Studio
```

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
The file lands in `android-app/android/app/build/outputs/apk/debug/`.

A debug APK can be copied straight to a phone and installed (the phone will ask you to allow
installing from unknown sources). That is the quickest way to test with two or three drivers
before thinking about the Play Store.

## Release build for the Play Store

1. In Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**.
2. Create a keystore the first time and **back it up somewhere safe**. Lose it and you can never
   update the app under the same listing again — you would have to publish a brand new app.
3. Upload the `.aab` to the Play Console.

Bump `versionCode` (a whole number, up by 1 each release) and `versionName` in
`android/app/build.gradle` before every upload, or the Play Console rejects it.

---

## How location works in the app

While a driver is online or on a job, the app runs an Android **foreground service**. Android
requires a visible notification for this, which the driver sees as:

> **Waka Bonny is sharing your location**
> Your passenger can see where you are. This stops when the job ends.

That notification is not optional — Android will kill the service without it — and it is honest,
which matters: a driver should be able to see at a glance that they are being tracked, and it
disappears the moment they go offline.

The same web code runs in both places. `GPS.start()` in `public/app.js` checks whether it is
inside the app and picks the background watcher; in a browser it uses the ordinary one. Nothing
else in the app changed, and the server endpoint (`POST /api/driver/location`) is the same.

**`ACCESS_BACKGROUND_LOCATION` is deliberately not requested.** A foreground service with a
notification does not need it, and asking for it would put the app into Google Play's
background-location review, which means a written justification and a demo video. Avoiding that
is worth more than the small amount of tracking it would add.

## Hardening applied

- The app loads only over HTTPS; plain HTTP is blocked (`usesCleartextTraffic="false"`).
- Navigation is restricted to `wakabonny.ng` and Paystack's checkout. A link to anywhere else
  opens in the phone's real browser instead of inside the app.
- Android auto-backup is off, so a driver's sign-in token is not copied to their Google account.
- The plugin ships its location service as exported; the manifest here narrows it to
  `exported="false"` so no other app on the phone can start it.
- Capacitor is pinned to 8.5.3. Versions 6.0.0–6.2.1 carry a critical advisory
  ([GHSA-rvm3-566m-v7fv](https://github.com/advisories/GHSA-rvm3-566m-v7fv)) about remote content
  loading at the app origin — which is exactly how this app works, so the version matters here.
- `npm audit --omit=dev` in this folder reports **0 vulnerabilities**. The findings that remain
  under `npm audit` are inside `@capacitor/cli`, a build-time tool that never ships in the APK.

## Known limitation: alerts

**Push notifications do not work inside the app.** The Android system WebView does not implement
the Web Push API, so the alerts set up on the website cannot reach a driver inside this shell.

Until that is fixed, a driver in the app gets background GPS but no alerts, and the Account
screen says so instead of telling them to use Chrome. Fixing it properly means adding Firebase
Cloud Messaging:

- a Firebase project, and its `google-services.json` dropped into `android/app/`
- `@capacitor/push-notifications` in this folder
- the server sending through FCM for app users, alongside Web Push for browser users

Until that is done, the honest position is that the **website is the better experience for most
drivers**, and the app is for drivers doing long trips where background tracking matters more
than alerts.

## Changing the address the app opens

Edit `server.url` in `capacitor.config.json`, then `npx cap sync android` and rebuild. Use this
to point a test build at a staging URL.
