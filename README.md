# IMP0STER

A mobile-first party game for 3–12 people playing together in person. Everyone gets a private question, one person gets a related alternative, and nobody is told their role. Compare answers, discuss, then let the host reveal the truth.

## Start locally

Requires **Node.js 22.12+ (Node 24 LTS recommended)** and npm. Dependencies are installed and locked in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173** (or the URL Vite prints if that port is occupied). On Windows PowerShell, use `npm.cmd run dev` if execution policy blocks `npm.ps1`. Local development uses Cloudflare's actual Workers runtime through its official Vite plugin, with local SQLite Durable Objects. No Cloudflare login, credentials or paid services are needed for local play.

1. Open three **fresh, independent tabs** at the local URL.
2. Create a room in the first tab and enter a nickname. Copy its six-character code.
3. Join with that code and different nicknames in the other two tabs.
4. The host starts. Each player privately submits one short answer.
5. All answers appear together after everyone submits, or after 90 seconds. Missing answers show “No answer”.
6. Discuss in person. The host can confirm **Reveal Imposter** during either answering or discussion. Everyone sees who revealed it, the imposter and both questions.
7. Start another round in the same room. The server automatically reveals at 20 minutes even if nobody presses a button.

Refresh a tab after submitting to check recovery: the same player and answer return. Sessions use **sessionStorage**, isolated per tab and preserved across refresh. Closing a tab can discard its session. Duplicating a tab can copy its session; the newest socket takes over and the old tab stops reconnecting. Use fresh tabs for different players. A moved session's “Return home” button affects only that tab.

The dev server listens on the LAN. To try phones locally, connect to the same Wi-Fi and open the Network URL printed by Vite; your firewall must permit the connection. Clipboard access may require HTTPS, so the code also remains visible for manual copying. Credentials use `crypto.getRandomValues`, which is available in insecure local contexts. Use HTTPS in production. Physical-phone and LAN behavior have not been verified in this environment. No tunnel or deployment is created automatically.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite frontend + local Worker, SQLite rooms and WebSockets |
| `npm run typecheck` | Strict TypeScript check for client, backend and tests |
| `npm run test` | Game rules and real Workers-runtime Durable Object/WebSocket tests |
| `npm run build` | Production Worker in `dist/imposter` and static assets in `dist/client` |
| `npm run deploy` | Build then deploy to Cloudflare; run only when you choose to publish |

Local runtime data is ignored under `.wrangler/`. Tests use separate disposable runtime storage and never touch development rooms. If a restricted runner denies the default Wrangler config/log directory, set `XDG_CONFIG_HOME` to a writable local directory and `WRANGLER_LOG_PATH` to a writable log directory for that process. A blocked optional `Request.cf` lookup may print a warning; the local runtime falls back to placeholder request metadata, which this application does not use.

## Game and reconnection rules

- Only connected players participate when a round starts. At least three are required, with at most 12 reserved player slots per room.
- New players join only in the lobby or after reveal. Existing members reconnect in any phase. A member who was offline when the round began watches until the next round.
- Questions come from **18 backend-only pairs**, chosen without repeats until the library is exhausted. One imposter is selected using cryptographic randomness for every round.
- Answers are final once accepted. The server checks membership, phase, deadlines and round number. Client clocks display server deadlines; they cannot extend a round.
- Host reveal is a public, irreversible transition. Non-host requests and duplicate reveals are rejected. The imposter identity and question pair are absent from all pre-reveal player payloads. During answering, only each player's own question and answer are sent to that player.
- Intentional **Leave room** immediately transfers host privileges in original join order. If the successor is offline, they receive the normal reconnection grace.
- An unexpectedly disconnected host retains control for 90 seconds. After that, the earliest-joined connected player becomes host. If nobody is connected, the first returning member becomes host. Previous hosts do not reclaim control automatically. The rule repeats for every new host.
- Offline slots and nicknames remain reserved for recovery. The UI distinguishes offline players; they cannot block the 90-second answer deadline. Leaving intentionally frees a slot and invalidates that session.
- Rooms expire after **30 minutes with no connected players** or **24 hours from creation**, whichever comes first. Expiration deletes their stored record, closes sockets and rejects previous credentials. An expired code may eventually be reused for an unrelated room.

## Architecture and privacy

See [the repository map](docs/REPO_MAP.md) and [implementation contract](docs/STAGE1_SPEC.md).

The Worker serves the React app and routes API calls to one Durable Object per code. Essential state is persisted before broadcasts. SQLite-backed Durable Object storage holds the room record; the namespace migration uses `new_sqlite_classes`. A single alarm tracks the earliest answer deadline, round deadline, host grace or expiration, rescheduling after each transition. Time is also advanced before processing actions, so delayed alarms cannot permit late answers or secret reveals.

Sockets use the WebSocket Hibernation API. Attachments contain a player ID and connection validity; state is reconstructed from durable storage and live attachments after hibernation. Ping/pong uses the runtime's automatic response without waking the game logic. Replacing a connection invalidates the old socket before accepting further actions from it.

Each tab generates a 256-bit credential with Web Crypto. The credential is sent only to the same-origin backend via POST and WebSocket subprotocol, never a URL query. Do not add logging of request bodies or `Sec-WebSocket-Protocol`. Room codes are invitations, not authentication credentials; player tokens authorize reconnection. No accounts or external database exist. Private data necessarily remains readable to the room's server operator; the privacy boundary here is between players, enforced by explicit server-side serialization. HTTPS is required for production.

## Eventual Cloudflare deployment

**No deployment has been performed.** When you choose to deploy:

1. Use a Cloudflare account with Workers Free and SQLite Durable Objects support. Stay within [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/) and [Durable Objects allowances](https://developers.cloudflare.com/durable-objects/platform/pricing/); free hosting has finite quotas.
2. Run `npx wrangler login` yourself. Keep credentials outside this repository.
3. Run `npm run typecheck`, `npm run test`, and then `npm run deploy` yourself.
4. Wrangler applies migration `v1` for the `Room` class and publishes the frontend and backend as one Worker. The Vite-generated deployment configuration points at `dist/imposter/index.js` and `dist/client`.
5. Use the printed HTTPS URL on separate devices. Verify reconnection, host transfer and timed reveals on the hosted runtime before sharing widely.

The app needs no external databases, purchased services or project secrets. Local rooms and tokens are not uploaded during deployment. Future persisted-state schema changes must be designed before publishing a replacement Worker.

Official references: [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/get-started/), [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/).

## Validation

Automated tests exercise permissions, question/answer privacy, answer and round deadlines, repeated alarms, early and duplicate reveals, non-repeating questions, capacity, duplicate names, host succession, expired rooms, invalid requests and credentials, real WebSocket synchronization, persisted answers, and actual Durable Object eviction with hibernating sockets.

A local three-tab browser smoke test covered creation/joining, a complete round, private questions, refresh after answering, discussion, confirmed reveal, a second round, reveal during answering and host departure. This does not verify physical phones, hosted Cloudflare behavior, long-session reliability or a full accessibility audit. Deadlines are exercised by advancing server time in automated tests, not by waiting twenty real minutes in the browser.
