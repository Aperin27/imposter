# Repository map

| Path | Responsibility |
| --- | --- |
| `src/App.tsx` | Home, create/join, lobby, answering/waiting, discussion, final reveal, confirmations and roster |
| `src/useRoom.ts` | Per-tab credential persistence, API calls, reconnect backoff, socket takeover, heartbeat and action status |
| `src/style.css` | Dark responsive UI, touch-sized controls, focus and reduced-motion styles |
| `shared/protocol.ts` | Explicit player-visible state and permitted wire actions; no backend secrets |
| `worker/index.ts` | Same-origin API router, request validation, Durable Object persistence, hibernating sockets and alarms |
| `worker/game.ts` | Authoritative rules, membership, host succession, time transitions and filtered player views |
| `worker/questions.ts` | Backend-only question pairs |
| `tests/game.test.ts` | Deterministic game-rule/privacy tests |
| `tests/room.test.ts` | Real Workers runtime, SQLite storage, sockets, hibernation and alarm integration tests |
| `vite.config.ts` | Official Cloudflare Vite integration and React |
| `wrangler.jsonc` | Combined assets/Worker deployment and SQLite class migration |
| `vitest.config.ts` | Disposable Workers runtime test configuration, independent of local game state |

Flow: browser POST → Worker route → room Durable Object → validated rule transition → durable record + next alarm → per-player WebSocket views. Alarms use the same deadline transitions. Only `view()` may construct a player snapshot; never broadcast the stored room record.
