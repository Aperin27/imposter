# IMP0STER

A mobile-first party game for 3–12 people playing together in person. Everyone gets a private question, one person gets a related alternative, and nobody is told their role. Compare answers, discuss, then let the host reveal the truth.

## CASE FILE interface — Stage 3

The frontend uses an investigation-dossier design: charcoal desk, warm paper, signal red, muted gold, suspect profiles, confidential assignments, sealed statements, evidence cards and a public case verdict. The illustration is original SVG; the locally served Barlow/Barlow Condensed WOFF2 files include their SIL Open Font License under `public/fonts/`. No font CDN, image service, animation library or additional package is used.

Controls have consistent hover/pressed/focus/disabled feedback, touch-sized targets, safe-area spacing, reduced-motion overrides and native dialog focus management. Modal entrances and supported native discrete exits use CSS; closing never waits for an animation before applying an action. Result animation is cosmetic: identity and both questions render only from an authorized public server result.

The backend, protocol, sessionStorage recovery, invite URL logic, rate limits and Durable Object storage are unchanged by this redesign. See [the design contract](docs/STAGE3_DESIGN.md) and [Stage 3 verification notes](docs/STAGE3_QA.md) for files, checks and limitations.

To review locally, run `npm.cmd run dev` on Windows and open the printed URL in three fresh tabs. Create a room, join two players (or use Show QR Code → Copy Invite Link), start, submit all three statements, discuss, confirm Reveal Imposter, and select Next round. Refresh after submitting to verify recovery. Check Tab/Shift+Tab/Escape in dialogs and try phone-width views. Do not scan a localhost QR from another device; use the LAN origin or your eventual public HTTPS origin.

Run the normal checks plus `node scripts/check-design.mjs` for palette contrast and CSS safeguards. No Git or publishing actions are performed by these local checks.

## Start locally

Requires **Node.js 22.12+ (Node 24 LTS recommended)** and npm. Dependencies are installed and locked in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173** (or the URL Vite prints if that port is occupied). On Windows PowerShell, use `npm.cmd run dev` if execution policy blocks `npm.ps1`. Local development uses Cloudflare's actual Workers runtime through its official Vite plugin, with local SQLite Durable Objects. No Cloudflare login, credentials or paid services are needed for local play.

1. Open three **fresh, independent tabs** at the local URL.
2. Create a room in the first tab and enter a nickname. Copy its six-character code.
3. Join with that code and different nicknames in the other two tabs. Hosts can also select **Show QR Code** in the lobby or after a round. The modal displays a local QR code and a copyable invite link.
4. The host starts. Each player privately submits one short answer.
5. All answers appear together after everyone submits, or after 90 seconds. Missing answers show “No answer”.
6. Discuss in person. The host can confirm **Reveal Imposter** during either answering or discussion. Everyone sees who revealed it, the imposter and both questions.
7. Start another round in the same room. The server automatically reveals at 20 minutes even if nobody presses a button.

Refresh a tab after submitting to check recovery: the same player and answer return. Sessions use **sessionStorage**, isolated per tab and preserved across refresh. Closing a tab can discard its session. Duplicating a tab can copy its session; the newest socket takes over and the old tab stops reconnecting. Use fresh tabs for different players. A moved session's “Return home” button affects only that tab.

Invite links have the form `https://<current-origin>/?join=ABC234`. Opening one prefills the Join form; a nickname and explicit join are still required. An existing session is preserved, including when the invite is for a different room. Leave that room explicitly before joining the invited room. The QR is generated locally with `qrcode.react`; no external QR service receives the code, and the URL contains no session token. Changing domains requires no code change: links use the current page origin. A localhost QR points back to the scanning device's localhost, so use a reachable LAN origin for local phone tests or the public HTTPS origin for real invitations.

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
- Offline slots and nicknames remain reserved for recovery until departure or removal. Only the current host can remove a player who has been offline for at least 90 seconds. Connected players cannot be removed. The host confirms the action, the room is notified, and the nickname/slot becomes available. The removed session credential is revoked for the rest of that room's lifetime, including across hibernation. Current-round participants, answers, imposter and deadlines remain intact. A removed player can explicitly join again with a new session between rounds.
- Disconnect and removal actions serialize in the room Durable Object. Reconnect first: removal is rejected. Removal first: the old credential cannot reconnect. A confirmation also carries the exact disconnect timestamp, preventing a stale dialog from removing someone after a subsequent reconnect/disconnect cycle.
- Host succession/removal notices disappear after eight seconds. Roster broadcasts do not restart their lifetime. Confirmation dialogs preserve focus across clock/roster updates, support Escape, restore focus to their trigger and scroll on short screens.
- Rooms expire after **30 minutes with no connected players** or **24 hours from creation**, whichever comes first. Expiration deletes their stored record, closes sockets and rejects previous credentials. An expired code may eventually be reused for an unrelated room.

## Architecture and privacy

See [the repository map](docs/REPO_MAP.md) and [implementation contract](docs/STAGE1_SPEC.md).
Stage 2's compatibility and acceptance contract is in [STAGE2_SPEC.md](docs/STAGE2_SPEC.md).

The Worker serves the React app and routes API calls to one Durable Object per code. Essential state is persisted before broadcasts. SQLite-backed Durable Object storage holds the room record; the namespace migration uses `new_sqlite_classes`. A single alarm tracks the earliest answer deadline, round deadline, host grace or expiration, rescheduling after each transition. Time is also advanced before processing actions, so delayed alarms cannot permit late answers or secret reveals.

Sockets use the WebSocket Hibernation API. Attachments contain a player ID and connection validity; state is reconstructed from durable storage and live attachments after hibernation. Ping/pong uses the runtime's automatic response without waking the game logic. Replacing a connection invalidates the old socket before accepting further actions from it.

Each tab generates a 256-bit credential with Web Crypto. The credential is sent only to the same-origin backend via POST and WebSocket subprotocol, never a URL query. Do not add logging of request bodies or `Sec-WebSocket-Protocol`. Room codes are invitations, not authentication credentials; player tokens authorize reconnection. No accounts or external database exist. Private data necessarily remains readable to the room's server operator; the privacy boundary here is between players, enforced by explicit server-side serialization. HTTPS is required for production.

## Stage 2 compatibility and question maintenance

Stored Stage 1 rooms upgrade lazily when their Durable Object wakes; no room reset, replacement namespace or new SQLite class migration is required. Existing round question text, answers, participant IDs, imposter, deadlines and host order are retained. Missing disconnect timestamps are initialized to upgrade time, conservatively granting legacy offline players a fresh 90 seconds before removal. Normal hibernation preserves timestamps; reconnection clears them. A restart that actually loses sockets starts the offline interval when the loss is detected.

Question pairs now have stable IDs in `worker/questions.ts`. Keep an ID attached to its pair when reordering; add new unique IDs and retire pairs by removing their entries. Never reuse an ID for different questions. **Do not edit or reorder `LEGACY_QUESTION_IDS`**: it is the frozen mapping of Stage 1 indices to IDs. Migration converts `usedQuestions` to `usedQuestionIds` once and retains the old field. Selection considers currently available unused IDs rather than comparing history length with bank size. New pairs remain eligible; removed IDs cannot break cycle exhaustion. A running round uses its saved question text even if that pair is retired later. All 18 original pairs remain unchanged.

## Public endpoint abuse protection

Built-in [Workers Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) protect public room creation and new-player joining, with no external service or database:

| Binding | Allowance per client IP / Cloudflare location | Namespace ID |
| --- | --- | --- |
| `CREATE_ROOM_LIMITER` | 10 room-creation attempts / 60 seconds | `41001` |
| `JOIN_ROOM_LIMITER` | 60 new-player join attempts / 60 seconds | `41002` |

New-member attempts count even if the room code does not exist. Multiple friends sharing Wi-Fi share an allowance, with enough room for a full 12-player group and retries. Limited requests receive **HTTP 429**, a readable error and **Retry-After: 60**. Valid existing-member joins, `/resume`, `/socket`, leave, gameplay actions and automatic ping/pong bypass these public limits. If a binding is unavailable, new creations/joins fail with 503 instead of silently dropping protection; existing members can still reconnect.

Keys use Cloudflare's edge-supplied `CF-Connecting-IP`, ignoring client-provided forwarded-IP and internal-key headers. Missing IPs (for example, local development) share a fallback key. Keys and IPs are not stored in room records. The joining check runs inside the room object after testing existing membership; its counters apply at that object's location. Limits are **approximate and location-local**, not strict global quotas or DDoS protection. Large shared networks can hit an allowance, and traffic from multiple IPs/locations can exceed it. The existing Workers Free request/runtime/storage quotas still apply.

No Cloudflare dashboard setting, paid WAF rule, account subdomain change or secret is required by this update. Both bindings are declared in `wrangler.jsonc` and included in the generated build configuration. On your normal publish, ensure that configuration is used. If you already use namespace IDs `41001`/`41002` for other Workers in the same account, choose unused positive-integer IDs in this file to avoid sharing their counters. No account or hosted binding has been inspected or changed here.

## Eventual Cloudflare deployment

The application is already live through the owner's GitHub/Cloudflare publishing workflow. **This Stage 2 update has not been committed, pushed or deployed.** For reference, the manual publishing steps are:

1. Use a Cloudflare account with Workers Free and SQLite Durable Objects support. Stay within [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/) and [Durable Objects allowances](https://developers.cloudflare.com/durable-objects/platform/pricing/); free hosting has finite quotas.
2. Run `npx wrangler login` yourself. Keep credentials outside this repository.
3. Run `npm run typecheck`, `npm run test`, and then `npm run deploy` yourself.
4. Wrangler applies migration `v1` for the `Room` class and publishes the frontend and backend as one Worker. The Vite-generated deployment configuration points at `dist/imposter/index.js` and `dist/client`.
5. Use the printed HTTPS URL on separate devices. Verify reconnection, host transfer and timed reveals on the hosted runtime before sharing widely.

The app needs no external databases, purchased services or project secrets. Local rooms and tokens are not uploaded during deployment. Keep the existing `Room` binding, Worker identity and migration `v1`; do not delete room storage or create a replacement namespace to apply Stage 2. Future persisted-state schema changes must be designed before publishing a replacement Worker.

Official references: [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/get-started/), [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/).

## Validation

Automated tests exercise permissions, question/answer privacy, answer and round deadlines, repeated alarms, early and duplicate reveals, non-repeating questions, capacity, duplicate names, host succession, expired rooms, invalid requests and credentials, real WebSocket synchronization, persisted answers, and actual Durable Object eviction with hibernating sockets.

Stage 2 additionally tests invite generation across origins, invalid links, real Join form prefilling and explicit submission, preservation of existing tab sessions, QR SVG payload equivalence and clipboard fallback, modal rerenders/focus restoration, notice expiry, offline permissions/removal thresholds, both reconnect/removal orderings, revoked-token persistence, active-round history, lazy Stage 1 upgrades, question-bank reorder/add/remove scenarios, real local rate-limit thresholds, shared-Wi-Fi joining, unknown-room probes, 429 responses and reconnect/heartbeat exemptions. UI tests use jsdom with a small native-dialog shim; browser checks cover the real modal behavior.

The Stage 1 local three-tab browser smoke test covered creation/joining, a complete round, private questions, refresh after answering, discussion, confirmed reveal, a second round, reveal during answering and host departure. The Stage 2 browser check covered invite-prefilled entry, explicit joining in another tab, session protection when opening another room's invite, the real QR modal, clipboard copy, Escape/focus restoration, focus retained through clock updates, offline removal after the real 90-second grace, public removal notification and its expiry. Physical phone-camera scans, hosted Cloudflare behavior, long-session reliability and a full accessibility audit remain unverified. Twenty-minute deadlines are exercised by advancing server time in automated tests, not by waiting twenty real minutes in the browser.
