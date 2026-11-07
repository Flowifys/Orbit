# Orbit

A real-time chat platform with servers, text and voice channels, direct messages, voice/video calls, screen sharing, file sharing, roles and moderation.

## How Orbit works

The Orbit server runs online all the time. Everyone, including you, opens the Orbit app or the website and logs in. Nobody hosts anything on their own PC.

Until the server is online, the desktop app runs a private test copy inside itself. Only you can see that copy.

## Put the server online (one time, about 10 minutes)

1. **Put the code on GitHub.** Go to github.com → **New repository** → name it `orbit` → **Create repository**. On the next page, click **uploading an existing file**. Unzip `Orbit-Source.zip`, drag everything inside it into the page (including the `server`, `public` and `electron` folders), then click **Commit changes**.
2. **Create the server on Render.** Go to render.com and sign up with GitHub. Click **New → Blueprint** and pick your `orbit` repo. Render reads `render.yaml` and sets everything up, including a disk so accounts and messages are kept. It uses the Starter plan, about $7 a month, because free servers lose their data.
3. When it says **Live**, copy your address, something like `https://orbit-xxxx.onrender.com`. Open it in a browser to check that it works.
4. Send that address to whoever builds your desktop app. The address goes in `electron/config.json` as `"serverUrl"`, and then the app is rebuilt. After that, everyone who opens Orbit.exe connects to your online server.

Anyone can also use Orbit in a browser at that address, on a phone too. Voice and video work there because Render gives you https.

### Running it elsewhere

Any host with Node 22.13+ or Docker and a persistent disk works: Railway, Fly.io or a VPS. Use `npm install --omit=dev && npm start`, or the included `Dockerfile`.

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `ORBIT_DATA` | Folder for the database and uploads (default `./data`) |
| `MAX_UPLOAD_MB` | Upload limit (default 50) |
| `SPOTIFY_CLIENT_ID` | Turns on "Connect Spotify" (see below) |
| `PUBLIC_URL` | Your public address, if the host is behind a proxy that hides it |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Turns on email verification and password-reset emails |
| `JWT_SECRET` | Login secret (Render generates one) |

## Spotify "Listening to"

1. Go to developer.spotify.com → **Dashboard** → **Create app**.
2. Set the **Redirect URI** to `https://YOUR-ORBIT-ADDRESS/api/connections/spotify/callback`, tick **Web API**, and save.
3. Copy the **Client ID** into the `SPOTIFY_CLIENT_ID` setting on Render, then redeploy.
4. Everyone can now go to **User settings → Connections → Spotify → Connect**.

While a Spotify app is in development mode, only the people you add under **User Management** (up to 25) can connect. You can ask Spotify for an extension to open it to everyone.

## Email verification

Without SMTP settings, sign-up works immediately with no code, and password-reset codes are printed to the server log. To send real emails, set the `SMTP_*` variables above, or fill the `smtp` section of `config.json` in the data folder and restart. Any SMTP provider works, such as Gmail (with an app password), Resend, Brevo or Mailgun.

## Features

- Email and password accounts, optional email verification, password reset
- Servers with icons and animated banners, invite links, server nicknames, ownership transfer
- Text and voice channels, private channels limited to chosen roles
- Roles with colors and 12 permissions, kick, ban, deleting messages, ban list, invite management
- Messages with markdown, replies, threads, reactions, @mentions, @everyone, editing, deleting, search, and history loaded as you scroll
- File sharing: drag and drop, paste, up to 10 files per message, inline image, video and audio players
- Direct messages and 1-to-1 voice and video calls with ringing
- Voice channels with camera, screen share, mute, deafen and speaking indicators
- Profiles: animated GIF avatars and banners with crop and zoom, gradient profile themes, gradient name colors, pronouns, profile effects, links, connected accounts, Spotify now-playing, custom status
- Appearance: Dusk, Midnight and Daylight themes, accent color, compact mode, text size
- Online, Idle, Do Not Disturb and Invisible presence, typing indicators, unread and mention badges, desktop notifications
- Works on phones through the browser (responsive layout)

## Changing the logo

Replace `public/logo.png` (the app logo) and `electron/icon.png` (the window icon), then rebuild the desktop app with `npm install && npx electron-builder --win portable`.

## Notes

- Voice and video connect people directly (peer to peer). That works on most networks. Some strict corporate or mobile networks need a TURN relay server, which you can add to `ICE` in `public/js/voice.js`.
- Group calls are mesh, so each person sends to each other person. That's good for roughly 8 people per voice channel.
- To grow past one server process, use the Socket.IO Redis adapter and move storage from SQLite to Postgres.
