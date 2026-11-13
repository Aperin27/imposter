# Global questions and rotation

Stage 4 has exactly **250 active backend-only pairs** (500 questions). The ten approved examples are retained verbatim. Editorial category totals, the review procedure and 20 selected original additions are in [QUESTION_BANK_REVIEW.md](QUESTION_BANK_REVIEW.md). The original 18 pairs are retired from active selection, with their frozen historical mapping retained.

## Bank structure and safe edits

`worker/questions.ts` exports entries with a permanent `id`, a two-string `questions` tuple, a category and an answer type. Category and answer type support editorial checks; they never affect probability, player roles or public payloads. Each available pair has equal probability in a newly shuffled deck. Both sides should support plausible overlapping answers; neither side is permanently the imposter question.

1. Add a new entry with an unused descriptive ID and compatible answer formats. Review wording, international readability, overlap and conceptual similarity with existing entries. Preserve all published IDs.
2. Reorder entries freely. Stored rotation progress follows IDs, not indices.
3. Retire a pair by removing its active entry. Never recycle its ID for a different pair. Do not modify `LEGACY_QUESTION_IDS`, even when none of those original 18 pairs remain active.
4. Prefer a new ID when changing the substance of a published pair. Saved allocations and rounds retain earlier text; an in-place wording correction affects only future reservations.
5. Adjust the exact-count/category test expectations if intentionally changing the bank size. Run all checks below and review the new content before publishing through the owner's usual workflow.

On a fresh allocation, the coordinator removes retired IDs from the remaining deck. It shuffles genuinely new IDs together with the remaining unused IDs, preserving used history. Removing and restoring an already-used ID cannot reissue it in the same cycle. When no active unused IDs remain, the cycle increments, used history clears and all active IDs are shuffled again. With multiple active IDs, the first pair cannot equal the immediately preceding allocation. A one-pair bank necessarily repeats across cycles. An empty bank rejects new allocations without modifying progress; an existing allocation key can still replay its saved snapshot.

## Persistence and selection

All rooms use `QUESTION_ROTATION.idFromName('imposter-global-question-rotation-v1')`. This name, binding and Worker identity must remain stable. Different deployments, preview environments and local development have independent namespaces and rotations; this is global within one deployed Worker, not across unrelated environments.

The SQLite `QuestionRotation` Durable Object holds:

| Table | Persistent contents |
| --- | --- |
| `rotation_state` | One row: cycle, shuffled remaining IDs, used IDs and last allocation ID |
| `question_allocations` | One row per start key: key, pair ID, both question strings and cycle |

A synchronous SQLite transaction checks the allocation ledger first. Existing keys return their original snapshot. A new key draws one pair, updates the deck and records the allocation in the same transaction. An error rolls back both writes. Synchronous execution serializes concurrent allocation calls. The singleton is reached by internal Durable Object RPC; no public HTTP route exposes the coordinator or bank. See Cloudflare's [SQLite storage and transaction API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

The coordinator is independent of room storage, alarms and room expiration. Room deletion, socket loss, hibernation or a normal Worker update does not clear it. Allocation records have no expiration and remain replayable after cycle changes or retirement. Never manually delete or truncate these tables to perform an ordinary bank update.

## Round starts and failures

The room first checks connected membership, current host, a minimum of three connected players, phase and (when supplied) the client's observed round number. Invalid starts do not request an allocation.

Each room has a persistent random room-instance UUID, separate from its reusable public code. Before RPC, the room saves `pendingStart = { key: UUID:nextRoundNumber, roundNumber }`. Newly created rooms initialize this UUID; older stored rooms acquire it once on wake. Reusing a code after expiry creates a different UUID.

The room requests the singleton allocation with an eight-second response timeout. It then checks expiry again, creates a candidate round with a random question orientation and imposter, and saves the candidate and next alarm before sending player states. The stored tuple is ordered as normal then imposter question, so existing private delivery and final reveal use the correct orientation. Neither assignment is exposed early. A completed round retains its pair, answers, participants and deadlines across reconnections and object eviction.

| Failure point | Recovery |
| --- | --- |
| Before the intent is saved | No coordinator call; retry validates again |
| Coordinator unavailable or empty bank | Recoverable error; keep the pending key and retry Start round |
| Coordinator committed but reply lost/timed out | Retry the same key; the saved allocation is returned without drawing again |
| Room save fails after allocation | Keep the pending intent and reservation; retry the same key, including after room eviction |
| Started round committed | Its snapshot is authoritative; a duplicate current-client start is rejected before allocation |
| Room expires while RPC is pending, or is never recovered | The reservation remains consumed; the room cannot start after expiry |

There is **no atomic transaction across the room and coordinator**. A successful assignment to a started round consumes its pair permanently for that cycle, regardless of leaving or early ending. To prevent duplicate assignments, the coordinator conservatively also treats an allocated reservation as consumed if the room never successfully displays it. Reservations are never returned to the deck: reclaiming one could conflict with a delayed commit or retry. A transient failure therefore consumes at most the same one reservation per pending round, not a new pair on every attempt. Question orientation may be chosen again before any failed candidate is committed; once committed it is fixed.

New clients send their observed round number with Start/Next round. Older already-open clients can still send an unversioned start for compatibility. After a reveal, such a request is indistinguishable from an intentional next-round start; refresh older tabs for stale-request protection. Lost network responses never provide exactly-once delivery to the browser; persistent allocation keys prevent duplicate deck advancement for the same round.

## Upgrade and owner publishing checklist

No deployment, Git operation or account setting is performed by this update. No new dashboard setting, secret, paid service or external database is required.

- Keep the existing Worker name, `ROOMS` binding, SQLite `Room` class and migration `v1` unchanged.
- Use the checked-in/generated deployment configuration containing the added `QUESTION_ROTATION` binding and appended `v2-question-rotation` SQLite class migration. Do not delete an existing namespace or rewrite migration history.
- Existing room records upgrade lazily. `usedQuestions` and `usedQuestionIds` remain compatible, with the frozen original 18-index mapping. They are historical room data and no longer select questions. Existing snapshots, submitted answers, deadlines, revoked credentials and host order remain intact.
- The first fresh Stage 4 allocation initializes a global cycle. Historical per-room usage cannot reliably reconstruct past global use; the update does not claim to do so.
- Publish the frontend and Worker together through the owner's normal workflow. Refresh older browser tabs. A rollback to Stage 3 or any old selector bypasses the coordinator and cannot preserve global uniqueness. Existing Room records remain compatible, but keeping global allocation guarantees requires coordinator-aware Worker code.
- After the owner publishes, smoke-test three clients: join/QR, start, submit, refresh, reveal, next round and host reconnection. Hosted behavior has not been verified during this local implementation.

## Free-plan and operational limits

SQLite Durable Objects are available on Workers Free. Cloudflare currently documents 100,000 Durable Object requests/day, 13,000 GB-seconds duration/day, 5 million SQLite rows read/day, 100,000 rows written/day and 5 GB total SQLite storage on Free. These allowances are account-wide, and room activity uses them too. Writes to indexes and alarm work may add usage; these figures are not a promised number of playable rounds. Exceeding a Free allowance can make operations fail until the quota resets. See the current [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) before publishing.

The coordinator stores one permanent allocation row per reserved round, including its text snapshot. Storage grows over time and is finite. This simple design deliberately retains idempotency records; pruning or archiving requires a separate protocol for proving old keys can never replay. Do not add an arbitrary TTL. The singleton also adds one internal RPC and a single coordination point to each start. Existing endpoint limits remain unchanged; no throughput/load benchmark has been run. Coordinator unavailability causes recoverable start errors, while already-running rounds do not need it.

Global uniqueness applies to allocations within one cycle. After exhaustion, a pair can appear again even if a room using it in the previous cycle is still active. It also cannot prevent players remembering questions across later cycles. There is no bank version field sent to clients and no bank download.

## Local verification

Tests use separate disposable Workers-runtime SQLite storage, not development or production room databases. No new dependency is required. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

```sh
npm run typecheck
npm run test
npm run build
node --experimental-strip-types scripts/check-question-bank.mjs
node scripts/check-design.mjs
git diff --check
```

The privacy check imports the actual backend bank and scans production client JavaScript, maps and styles for all 500 question strings (including escaped forms). It complements the server serializer tests; it is not a substitute for validating private runtime payloads. The test suite covers the complete deck, concurrency, retries, failure recovery, bank edits, migration, privacy and all existing multiplayer/UI behaviors. Physical camera scans, hosted migration, physical-device use, manual group play and sustained load remain unverified for Stage 4.

## Verified Stage 4 results

Final local verification on 2026-11-13:

| Check | Result |
| --- | --- |
| `npm.cmd run test` | **109 passed across 7 files** |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run build` | Passed; generated Worker retains `Room`/`v1` and includes `QuestionRotation`/`v2-question-rotation` |
| `node --experimental-strip-types scripts/check-question-bank.mjs` | All 500 private strings absent from production client assets |
| `node scripts/check-design.mjs` | Palette contrast, reduced motion, hover and viewport safeguards passed |
| `git diff --check` | Passed; only Windows line-ending normalization warnings |

The seven test files cover game rules/orientation/privacy; real room sockets, persistence and failures; legacy/offline stability; actual coordinator SQL and deck reconciliation; bank content contracts; endpoint rate limits; and invite/modal/game UI. Specific integration cases include three concurrent room starts, 32 concurrent coordinator keys, 20 concurrent duplicate keys, 250 unique cycle allocations, cycle rollover, lost allocation replies, room-save failure, SQL rollback, room/coordinator eviction, restart with all sockets dropped, room-code reuse and expiry during allocation. Existing answer/reveal, 90-second answering and host grace, 20-minute deadlines, next round, removal races, QR/session behavior, rate limits and hibernation checks remain passing.

Failure-injection tests deliberately throw `Simulated coordinator reply failure` before allocation and after a committed allocation. The Workers test runtime prints two exception diagnostics for these injected RPC rejections; the room catches them, returns its recoverable message, and both recovery assertions pass. They are expected test diagnostics, not failures hidden from the suite.

Changed files: `worker/questions.ts`, `worker/rotationDeck.ts`, `worker/questionRotation.ts`, `worker/game.ts`, `worker/index.ts`, `shared/protocol.ts`, `src/RoundScreens.tsx`, `wrangler.jsonc`, `vitest.config.ts`, `tests/game.test.ts`, `tests/room.test.ts`, `tests/stability.test.ts`, `tests/ui.test.tsx`, `tests/globalRotation.test.ts`, `tests/questionBank.test.ts`, `scripts/check-question-bank.mjs`, `README.md`, `docs/REPO_MAP.md`, `docs/STAGE4_SPEC.md`, `docs/QUESTION_ROTATION.md` and `docs/QUESTION_BANK_REVIEW.md`.

No dependency was installed, no production or development room database was reset, and no commit, push, deployment or Cloudflare account change was made. The frontend changes only add the observed round number to two existing start actions; markup, CSS, assets and gameplay presentation are unchanged.
