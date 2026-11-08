# Orbit for Meta Quest

The Quest app is Orbit's website (https://orbital.sbs) wrapped as an Android app, made with
Meta's Bubblewrap. It always shows the live site, so website updates reach the headset right away;
the app only needs rebuilding when its name, icon or this folder changes.

- `twa-manifest.json` — app settings (package `sbs.orbital.app`, 2D window app).
- The signing key is **not** in the repo. GitHub gets it from two repository secrets:
  `QUEST_KEYSTORE` (the key file as base64) and `QUEST_KEY_PASSWORD`. Keep your own copy of both:
  every future update of the app must be signed with this same key.
- The server answers `/.well-known/assetlinks.json` with this key's fingerprint, which lets the app
  open Orbit full screen without a browser bar.

GitHub builds `Orbit-Quest.apk` (Actions → "Build Meta Quest app") and attaches it to the `quest`
release; https://orbital.sbs/download/quest always points at the newest one.
