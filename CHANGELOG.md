# Orbit changelog

Everything since you last worked on Orbit yourself (Nov 7, 2026, evening), newest first.

## Meta Quest and Xbox (Nov 8)
- **Quest app:** GitHub builds `Orbit-Quest.apk` (`.github/workflows/quest.yml`, Meta's Bubblewrap) and attaches it to the `quest` release. It's Orbit's website in a window, so site updates show up without rebuilding.
  - The signing key lives only in the GitHub secrets `QUEST_KEYSTORE` and `QUEST_KEY_PASSWORD`. Keep your copy safe; every update must use the same key.
  - `orbital.sbs/download/quest` hands out the newest APK. `/.well-known/assetlinks.json` lets it open without a browser bar.
  - The build retries if a download times out.
- **Download page:** new Meta Quest and Xbox sections, picked automatically on those devices. The Quest section covers installing straight from the headset or from a computer. Xbox works through Edge with controller mode.
- **Download page icons:** replaced with one clean, matching set.
- **Not kept:** a Unity "purple void" VR app was written and then removed (it's still in git history).

## 1.28.0 — Layouts and phone fixes (Nov 8)
- **Settings → Appearance → Layout** has 9 layouts. Classic stays the default.
  - Nebula: glass panels and stars.
  - Console: flat and dense.
  - Daylight: light lavender.
  - Bubble: servers as tabs on top, messages in chat bubbles.
  - Dock: servers in a bottom dock.
  - Inbox: wide chat list.
  - Stage: big call tiles.
  - Columns: everything as cards.
  - Each layout also has a phone version (Dock = bottom bar; Bubble and Inbox = servers on top).
- **Phones:**
  - The DM profile panel no longer covers the chat.
  - The message hint stays on one line.
  - Busy top bars fit the name.
  - Settings' close button moved to the corner.
- **Light themes:** the accent text color goes darker so it stays readable.

## 1.27.x — Overlay and talking highlight (Nov 8)
- **In-game overlay** in the Windows app. Shift+` toggles it, and it shows who's in your call.
- **Green ring** around whoever is talking, for everyone in the call, not just yourself.
- Overlay settings explain when the app needs updating.
- Settings tabs no longer error when switched quickly.

## 1.26.0 — Friends, voice chat and devices (Nov 7)
- Accepting a friend request opens a DM with them automatically.
- Voice channels have their own text chat.
- Device icons show where someone's online: PC, phone, VR headset or console.
- Group chat member lists update live when people are added or kicked.

## 1.25.x — Two-step sign-in and game art (Nov 7)
- **Two-step sign-in** by email code or text message (Twilio Verify).
  - Email goes through Resend, because Render's free plan blocks normal email sending.
  - Clearer Twilio error messages; stray spaces in pasted keys are ignored.
  - A notice on phone verification says it's being fixed (Twilio account issue).
- **Pop-up boxes:** typing in them works again, and passwords have a show/hide button.
- The typing indicator no longer overlaps the message box.
- **Game art:**
  - Pictures fall back to Wikipedia for games that aren't on Steam.
  - A picture is only kept once it actually loads.
  - Staff can upload a game's picture (Settings → About → Game picture check).
- **Game timers** survive restarts, so they show how long someone has really been playing.

## 1.24.x — Invites (Nov 7)
- **Invite links** show as cards in chat and join you in the app, instead of opening the browser.
- Badges show only on profiles (the name area is kept for server tags).
- No extra link preview under invite cards.

## 1.23.0 — Controller mode and domain (Nov 7)
- **Controller mode** for Xbox and gamepads:
  - D-pad or stick to move, A to select, B to go back.
  - LB/RB switch servers.
- **orbital.sbs** domain support.

## 1.22.0 — Profiles look better (Nov 7)
- Reworked profile effects.
- Status shows as a thought bubble on your avatar.
- Several games can show as playing at once.

## 1.21.x — Full profiles (Nov 7)
- **Full profile page** with:
  - Board widgets.
  - An Activity tab (recently played).
  - A Wishlist.
- Real game logos instead of letter tiles.

## 1.20.x — Desktop title bar and Developer badge (Nov 7)
- **Windows app:**
  - Its own title bar, with back/forward and minimize/maximize/close.
  - Calls you can resize.
- **Developer badge.** Staff can give and remove it; `__` and `orbit` have it.

## 1.19.x — Activities (Nov 7)
- **Activities:** Playing, Watching, Listening and Competing.
  - Spotify, with show/hide switches.
  - Big games like Fortnite and Roblox.
  - Timers count up live.
- Windows app builds on GitHub, so the Download for Windows button works.
- Turning the member list off and on no longer wipes the messages.
- Group chat owners can kick people.

## 1.18.x — Phone and audio fixes (Nov 7)
- iPhone: the top of the app isn't cut off anymore, and its buttons can be tapped.
- Audio and voice messages only play or pause from the play button.

## Other things set up along the way
- **orbital.sbs:** DNS pointed at Render.
- **Twilio and Resend:** keys added on Render.
- **Design canvas:** "Orbit — pick a style", with 8 style previews. Several of them became the layouts.
