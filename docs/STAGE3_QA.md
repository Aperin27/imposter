# Stage 3 — CASE FILE verification

## Changed files and scope

| Files | Change |
| --- | --- |
| `src/App.tsx` | Home/registration redesign, room composition, accessible progress announcements, retained modal state, copy-timer cleanup, and no idle home clock interval |
| `src/CaseArtwork.tsx` | Original dossier/suspect SVG illustration and small reusable decorative marks |
| `src/RoundScreens.tsx` | All four room phases, statement cards, sealed answer, server-only verdict and separated host authority controls |
| `src/PlayerRoster.tsx` | Suspect profile cards with stable IDs/order and original offline-removal permissions |
| `src/formatTime.ts` | Shared display-only deadline formatting, kept separate from React components for stable hot refresh |
| `src/Modal.tsx`, `src/InviteModal.tsx` | Classified-paper presentation, stable open/close lifecycle, explicit Tab loop, focus restoration and retained CSS exit transitions |
| `src/style.css` | Complete responsive token-based visual/interaction system |
| `index.html`, `public/favicon.svg`, `public/fonts/*` | Theme/viewport metadata, local font preloads, original icon, three WOFF2 fonts (~67 KB total), license and provenance |
| `tests/ui.test.tsx`, `scripts/check-design.mjs` | Full UI flow/privacy and modal regressions, palette and CSS safeguards |
| `README.md`, `docs/REPO_MAP.md`, `docs/STAGE3_DESIGN.md`, this file | Local review instructions, updated component map, design contract and evidence |

Protected boundaries: `worker/*`, `shared/*`, `src/useRoom.ts`, `src/invites.ts`, `wrangler.jsonc` and both package files must match their pre-task hashes. No dependency installation, backend/protocol/storage migration, production request, account change, commit, push or deployment is part of this work.

## Automated checks

- Strict TypeScript and **68 passing Vitest tests**, including all Stage 2 permissions, deadlines, rate limits, host succession, storage-upgrade and hibernation tests.
- Added UI coverage: home → create → lobby → answer → sealed → discussion → server-authorized public reveal → next round; no local premature verdict; no out-of-phase role styling; modal focus wrap, retained closing and no unsolicited reopening after phase/host changes.
- `node scripts/check-design.mjs`: seven normal-text color pairings meet 4.5:1. Lowest is dark ink on signal red, **4.64:1**; paper body **14.77:1**; muted paper text **5.35:1**; darker red on paper **5.64:1**. Focus rings adapt to dark/paper surfaces. Reduced-motion, hover-capability and viewport/safe-area declarations are checked.
- Production build and backend question-string exclusion from the client bundle. Hash comparison verifies protected files remain unchanged. `git diff --check` and new-file whitespace checks verify scope/integrity.

## Browser evidence

Local Workers runtime at `http://localhost:5173`, with independent tabs and test nicknames only:

- Create/join from invite-prefilled form; three connected players; host-only Start Round.
- Exactly one private question on each screen. Two players received matching questions; the third received the related alternative. No alternate question or imposter indicator appeared before reveal.
- Answer submission, statement-sealed feedback, saved answer after refresh, simultaneous answer release and remaining round countdown.
- Confirmation, cancel/Escape without revealing, public result matching across tabs, questions/answers visible after reveal, host next round, blank new answer field, and early reveal during answering. Missing answers are clearly labelled.
- QR contrast/quiet zone, local public-code-only URL, copy feedback and preserved existing-session notice on refresh.
- Tab/Shift+Tab wrapping within QR/confirmation dialogs, visible solid focus rings, Escape and focus restored to the trigger. Ordinary clock/roster updates do not reset modal focus.
- Intentional host leave transferred controls to the next player. Notice expiration is also covered by the automated suite. Duplicate nickname errors stayed readable; a 24-character unbroken name wrapped at 320px.

Measured widths use actual browser `innerWidth` and document client/scroll widths, accounting for desktop scrollbars:

| Screen | Widths with no horizontal overflow |
| --- | --- |
| Home, lobby, private question, final verdict | 320, 375, 390, 430, 768, 1280 |
| Registration, discussion | 320, 390, 768, 1280 |
| Long nickname / revealed round | 320 |

Home and lobby button checks found no visible controls shorter than 44 CSS pixels. Main actions are 56px high. No header/footer is fixed over gameplay controls.

Representative local screenshots are under `.wrangler/qa/stage3/` (ignored QA artifacts): `home-1280.jpg`, `home-390.jpg`, `registration-390.jpg`, `lobby-390.jpg`, `question-390.jpg`, `sealed-390.jpg`, `discussion-1280.jpg`, `verdict-1280.jpg`, `verdict-390.jpg`, `invite-390.jpg`, and `long-name-320.jpg`.

## Limits and manual acceptance

- Browser sizes are simulated viewports, not physical-phone or on-screen-keyboard validation. Safe areas, scrolling and keyboard-resize metadata are implemented; real iOS/Android testing remains open.
- QR styling preserves the original local encoder, 4-module white margin and high contrast. No physical camera scan was performed.
- Reduced-motion CSS was checked automatically; no OS accessibility setting was changed to force the browser preference. Native discrete modal exits fall back to immediate closing on browsers without support.
- This is an AA-oriented implementation, not a full WCAG audit or screen-reader certification. Latin fonts use system fallbacks for other scripts.
- Timed rules are verified in automated tests; a real twenty-minute wait, long-session soak and hosted Cloudflare revalidation were not performed in this redesign task.
- No publishing has been done. The owner should review three-tab play and physical phones locally/on the normal publishing path before broad release.
