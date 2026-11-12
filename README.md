# NineX

NineX is a real-time room app built with React, Express, Socket.IO, and WebRTC. It includes private/public room creation, invite links, participant roles, moderation controls, room chat, and peer-to-peer screen/camera media.

## Requirements

- Node.js 20 or newer
- npm
- A modern browser with WebRTC support
- HTTPS for use outside `localhost` (required by browser media-capture APIs)

## Install and run

From the project root:

```sh
npm install
npm run dev
```

The client runs at `http://localhost:5173`; the API and Socket.IO server run at `http://localhost:3001`.

### Production hosting

Deploy the repository root as a Node.js 20+ service. The application source and npm manifest are all at the root; use these commands in Railway:

```sh
npm ci
npm run build
npm start
```

The production server serves the built client, API, and Socket.IO from the same origin. Configure the provider's `PORT` environment variable if it does not supply one automatically. In the provider's environment settings, set:

- `NODE_ENV=production`
- `CLIENT_ORIGIN=https://your-public-domain.example` — the public site origin. Multiple comma-separated origins are supported when needed; paths are ignored.
- `ADMIN_PASSWORD` — a new, strong production-only password. Do not copy credentials from a local `.env`.
- `FRIENDS_PUBLIC_URL=https://your-public-domain.example` — public HTTPS URL used by Discord invite links. Railway's `RAILWAY_PUBLIC_DOMAIN` is used automatically if this is omitted or set to a local URL.

The Node service must accept HTTPS traffic through the platform's TLS proxy and support long-lived WebSocket connections for Socket.IO. Open `/admin` on the same public domain as the site. Same-origin browser requests are accepted automatically; set `CLIENT_ORIGIN` to the site's public origin for Socket.IO and any separate frontend origins. If a separate frontend is hosted on another domain, set the frontend build variable `VITE_API_URL` to the backend's public base URL and include the frontend origin in the backend's comma-separated `CLIENT_ORIGIN`; admin cookies require HTTPS. If a separate reverse proxy is used, forward WebSocket upgrade requests and route `/api`, `/socket.io`, `/watch/*`, and `/` to the same service. Direct navigation to `/watch/...` requires the SPA fallback, which is enabled by the bundled Express server. Set `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` as build-time environment variables if users need TURN for media connectivity; these values are embedded in the client bundle, so use scoped/temporary TURN credentials.

The production server exits with a clear error if `ADMIN_PASSWORD`, `CLIENT_ORIGIN`, or the built client is missing. For a separate frontend host, set `CLIENT_ORIGIN` to the frontend's exact public origin and configure the frontend build's `VITE_API_URL` and `VITE_SOCKET_URL` to the backend's public URL.

Use a persistent, single Node service rather than serverless functions or multiple replicas: room state, participants, Discord-to-room mappings, admin sessions, and chat are currently in memory and are lost on restart. Multi-instance hosting needs shared room/session storage and a Socket.IO adapter before scaling horizontally.

## Configuration

The server accepts `PORT`, `CLIENT_ORIGIN`, and `ADMIN_PASSWORD` environment variables. For local development, create a root `.env` file and set `ADMIN_PASSWORD` there before opening `/admin`; `.env` is ignored by Git and must not be committed. The admin API stays disabled if no password is configured. You can also set it in PowerShell for the current terminal session:

```powershell
$env:ADMIN_PASSWORD = "your-strong-unique-password"
npm.cmd run dev
```

The admin dashboard lists live rooms and participants, reports room/participant/screen-share counts, and lets an administrator lock new entries or end a room. Admin login is rate-limited and uses an eight-hour, in-memory, `HttpOnly`, `SameSite=Strict` session cookie. Restarting the server invalidates active admin sessions.

From the dashboard, **Entrar como admin** lets an authenticated administrator choose a display name and join a live room with privileges above its leader. Their name appears with an administrative shield badge. The browser receives a room-specific, single-use ticket that expires after one minute; the admin password is never sent through Socket.IO. Admins can manage participants and room settings, but cannot remove another admin or become the room leader. If the leader leaves while only an administrator remains, leadership stays unassigned until a regular participant joins.

For local development, the admin API accepts loopback origins (`localhost`, `127.0.0.1`, or `::1`) on any port, so using a different Vite port or hostname does not block admin login. Production still requires the exact public origin in `CLIENT_ORIGIN`. If the backend uses a non-default port, set `FRIENDS_API_PROXY` to its origin before starting Vite, for example `$env:FRIENDS_API_PROXY = "http://localhost:3312"`.

The client can set `VITE_SOCKET_URL` when the Socket.IO server is not available at the same origin. `VITE_API_URL` sets the HTTP API origin separately; if omitted, the API uses `VITE_SOCKET_URL` or the current page origin. STUN uses Google's public STUN endpoint by default. For networks that need TURN, set the following client build variables:

- `VITE_TURN_URL` — one or more comma-separated TURN URLs
- `VITE_TURN_USERNAME` — TURN username
- `VITE_TURN_CREDENTIAL` — TURN credential

TURN credentials are delivered to the browser as part of the client build; use short-lived credentials from your TURN provider for deployed environments.

### Discord voice-channel integration

Copy `.env.example` to `.env` for local development and configure `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, and `DISCORD_LOG_CHANNEL_ID`. The log channel defaults to the ID provided for this setup. For production, set `FRIENDS_PUBLIC_URL` to the public HTTPS URL users should open; on Railway the `RAILWAY_PUBLIC_DOMAIN` value is used automatically if the explicit URL is absent or points to localhost. The bot refuses to start with a local or non-HTTPS production invite URL. Never commit `.env` or share the bot token.

Install the Discord application with the `bot` and `applications.commands` scopes. Grant it access to voice channels, permission to view and send messages in the log channel, and **Manage Channels** permission to update voice-channel status. The bot requests the `Guilds` and `Guild Voice States` gateway intents.

Register the slash commands after configuring the three IDs and token:

```powershell
npm.cmd run deploy:commands
```

The bot provides `/ninex link` to create or retrieve the room link for your current voice channel, `/ninex sala` to show an existing link, and `/ninex encerrar` to end the linked room. The last command requires the Discord **Manage Channels** permission. When a human joins a voice channel, the bot also creates or reuses one NineX room, puts its invite link in the voice-channel status, and logs joins, departures, and room creation. The status is cleared when the channel becomes empty. The room remains available for that channel until the NineX server restarts or a moderator ends it. The bot does not join the voice call or bridge its audio. The link is a room invite: anyone who obtains it can try to join; Discord identity is not yet verified by NineX.

## Project layout

The source files and configuration are kept directly in the repository root so they can be uploaded without the former `client` and `server` source folders. `npm install` installs all dependencies from the root `package.json`; Vite generates `dist/` during the build, and the Node server serves that generated folder. Do not upload or commit `.env`, `node_modules/`, or generated `dist/`.

## Runtime notes

- Room, participant, and chat state currently live in server memory. Restarting the server clears active rooms; multiple backend instances require a shared Socket.IO adapter and shared room store.
- A room's ten-character invite code is still accepted for manual entry. New invite links use `/watch/priv-xxxxxx` for private rooms and `/watch/pub-xxxxxx` for public rooms. Join attempts are rate limited, and the leader can lock a room to reject new joins.
- WebRTC media is sent directly between participants and uses DTLS encryption. Chat and signaling are relayed through the backend; deploy behind HTTPS/WSS and add authentication/persistent storage before using the app for sensitive or production workloads.
- Browser permissions are required for microphone, camera, and screen capture. Screen audio is transmitted when the browser provides an audio track for the selected capture surface.
- Voice chat uses WebRTC microphone tracks. Remote audio plays independently from video, so people can talk even when no camera or screen is being shared. Browsers may require a page interaction before playback; the room's audio control can mute or restore received voice audio.
- The room plays a short sound for participant joins/leaves and camera or screen-share start/stop events. Sound is enabled after the first page interaction, can be toggled in the room controls, and is remembered in the browser.
- Leadership actions, room edits, signaling destinations, message lengths, participant limits, and chat rate limits are checked by the backend.
