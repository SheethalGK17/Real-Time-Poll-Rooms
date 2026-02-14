# Real-Time Poll Rooms

A full-stack web app for creating polls, sharing links, collecting votes, and broadcasting live results.

## Features

- Create a poll with a question and 2-8 options.
- Get a shareable poll URL immediately after creation.
- Join by link and vote once (single-choice).
- Live updates for everyone viewing the same poll via Socket.IO.
- Persistent storage on disk (`data/polls.json`) so refresh/restart keeps polls and votes.
- Interactive UX improvements:
  - live poll preview while creating
  - quick-start poll templates
  - option reorder controls
  - live viewer count in poll rooms
  - live vote activity feed with animated result changes

## Tech Stack

- Backend: Node.js, Express, Socket.IO
- Frontend: HTML/CSS/Vanilla JS
- Persistence: JSON file datastore with atomic writes (`*.tmp` + rename)

## Fairness / Anti-Abuse Controls

1. `One vote per persistent voter token (cookie)`
   - Control: the server sets an `HttpOnly` voter token cookie and stores a hashed token with each vote.
   - Prevents: repeat voting from the same browser session/device cookie.
   - Limitation: if a user switches browser/device, this control alone can be bypassed.

2. `One vote per IP + User-Agent fingerprint (hashed) per poll`
   - Control: each vote also stores a hash of `client IP + user-agent`; repeat fingerprint votes are rejected.
   - Prevents: cookie clearing/replacement from the same network/device profile.
   - Limitation: shared networks or similar user agents can cause false positives; VPN/proxy changes can bypass.

3. `Vote attempt rate limiting (extra hardening)`
   - Control: max 10 vote attempts per minute per `poll + fingerprint`.
   - Prevents: burst/scripted abuse and brute-force request flooding.
   - Limitation: distributed attacks across many IPs are still possible.

## Edge Cases Handled

- Trims whitespace from questions/options.
- Rejects empty questions/options.
- Requires at least 2 unique options.
- Deduplicates options case-insensitively (`"Yes"` and `"yes"` count as one).
- Caps question/option lengths.
- Rejects votes for missing/invalid poll options.
- Returns clear status codes for not found (`404`), conflict/already voted (`409`), and throttled (`429`).
- Poll page shows graceful errors for invalid or missing poll IDs.

## Known Limitations / Next Improvements

- File datastore is simple and single-instance friendly; multi-instance deployments should use a database (PostgreSQL/Redis).
- Fingerprint fairness can block legitimate users behind shared IPs.
- No user accounts/authentication; voting trust is heuristic-based.
- No poll close/end time yet.
- No analytics dashboard or moderation tools.

## Local Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Test

```bash
npm test
```

## Deployment

The app is deployment-ready for platforms like Render, Railway, Fly.io, or any Node host.

Required environment variables:

- `PORT` (provided by host)
- `HASH_SECRET` (set a long random value in production)

Recommended deployment settings:

- Node version: `>=20`
- Start command: `npm start`
- Persistent disk mounted at app root (or set `DATA_DIR` to persistent path)

Optional:

- `DATA_DIR` to change where `polls.json` is stored.

### Render (recommended)

1. Push this project to a public GitHub repository.
2. In Render, choose **New +** -> **Blueprint** and select the repo.
3. Render reads `render.yaml`, creates the web service, and mounts a persistent disk.
4. After deploy finishes, copy the generated `https://<service>.onrender.com` URL.

### Railway/Fly.io

- Use `npm start` as the start command.
- Set `HASH_SECRET`.
- Attach a persistent volume and map `DATA_DIR` to that path.

## Submission Fields Template

- Public URL: `<add deployed URL here>`
- Repository URL: `https://github.com/SheethalGK17/Real-Time-Poll-Rooms.git`
- Notes: this README already includes fairness controls, edge cases, and known limitations.
