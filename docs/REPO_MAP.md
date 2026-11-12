# Repository map

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | CASE FILE home/registration, existing client actions, room shell, notices and modal state |
| `src/CaseArtwork.tsx` | Original decorative SVG dossier, fingerprint and arrow artwork; independent of player/role data |
| `src/RoundScreens.tsx` | Presentational lobby, confidential assignment, sealed answer, public evidence and server-authorized verdict |
| `src/PlayerRoster.tsx` | Stable suspect profiles, connection/host status and existing offline-removal controls |
| `src/formatTime.ts` | Shared display-only formatting of server deadlines; no timer authority |
| `src/invites.ts` | Validated public invite links and existing-session explanations |
| `src/InviteModal.tsx` | Locally generated QR, visible room code, invite link and clipboard handling |
| `src/Modal.tsx` | Stable native dialog lifecycle, focus loop/restoration and retained closing transitions |
| `src/RoomNotice.tsx` | Temporary server-timestamped host/removal notices |
| `src/useRoom.ts` | Per-tab credential persistence, API calls, reconnect backoff, socket takeover, heartbeat and action status |
| `src/style.css` | CASE FILE tokens, paper/charcoal surfaces, responsive compositions, interaction states and reduced motion |
| `public/fonts/` | Self-hosted Barlow fonts, SIL OFL license and provenance |
| `public/favicon.svg` | Original redacted-zero app icon |
| `scripts/check-design.mjs` | Dependency-free palette contrast and CSS safeguard checks |
| `shared/protocol.ts` | Explicit player-visible state and permitted wire actions; no backend secrets |
| `worker/index.ts` | Same-origin API router, request validation, Durable Object persistence, hibernating sockets and alarms |
| `worker/game.ts` | Authoritative rules, lazy room upgrades, offline removal/revocation, host succession, time transitions and filtered views |
| `worker/questions.ts` | Backend-only stable pair IDs and frozen Stage 1 index mapping |
| `worker/rateLimit.ts` | Built-in public endpoint limit enforcement and trusted client key selection |
| `tests/game.test.ts` | Deterministic game-rule/privacy tests |
| `tests/room.test.ts` | Real Workers runtime, SQLite storage, sockets, hibernation and alarm integration tests |
| `tests/stability.test.ts` | Offline removal/races, legacy state and question-bank upgrades, notice expiry |
| `tests/rateLimit.test.ts` | Real local limiter bindings, error handling, shared networks and reconnect exemptions |
| `tests/ui.test.tsx` | Invite form/session protection, QR payload, confirmations, focus, notices and removal UI |
| `tests/ui.setup.tsx` | jsdom dialog shim and isolated UI cleanup |
| `vite.config.ts` | Official Cloudflare Vite integration and React |
| `wrangler.jsonc` | Combined assets/Worker deployment and SQLite class migration |
| `vitest.config.ts` | Separate disposable Workers and jsdom test projects, independent of local game state |

Flow: browser POST → Worker route → room Durable Object → validated rule transition → durable record + next alarm → per-player WebSocket views. Alarms use the same deadline transitions. Only `view()` may construct a player snapshot; never broadcast the stored room record.
