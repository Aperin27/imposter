# CASE FILE — Stage 3 design contract

## Scope

Frontend presentation only. Keep `worker/`, `shared/`, `src/useRoom.ts`, `src/invites.ts`, package files and Cloudflare configuration unchanged. No Git mutations, deployment or cloud access. Stage 2 state handling and permissions remain authoritative.

## Art direction

- Charcoal `#111216` investigation desk; warm-paper `#F0EBDF` statements; signal red `#E84C43` actions/reveal; muted gold `#E5C66B` case metadata; slate `#343740` dividers and secondary controls.
- Self-hosted Barlow Condensed for display and Barlow for readable body copy, with the SIL Open Font License included. No runtime font CDN or new packages.
- Original SVG suspect dossier illustration, document rules, sparse stamps and reference labels. No fabricated player information or decorative role hints.
- Mobile-first single column; desktop hero composition and game/roster split. No fixed controls, safe-area padding, shrink-safe long names and copy, minimum 44px interactive targets.
- Paper text uses dark ink; small red text on paper uses a darker accessible red. Signal-red buttons use dark text, not low-contrast white. Focus rings adapt to the surface.

## Interaction and privacy

- Consistent 150ms button feedback with hover movement only on hover-capable devices. 220ms screen/modal entrances and a short, non-blocking reveal animation; reduced motion removes nonessential transitions.
- Preserve the stable native dialog mount/focus lifecycle. Use native CSS discrete exit transitions where supported; actions and Escape never wait for animation.
- Only server `phase === 'revealed'` plus its public `reveal` object may render identity or question-pair results. All discussion/answering displays use the existing filtered `RoomView`; no local role inference.
- Preserve accessible action names, private answer submission, host-only start/invite/reveal/removal, copy feedback, offline explanations and temporary notices. Keep reveal separate from normal answering controls.

## Acceptance

Full Stage 2 tests, additional UI flow/privacy/contrast checks, strict typecheck, production build, protected-file hash comparison and backend-question bundle checks. Browser QA: home → join/lobby → private question → sealed statement → discussion → confirmed public reveal → next round, plus QR, keyboard, reduced-motion CSS and responsive viewports where supported. Report physical-device, scanning and hosted gaps explicitly.
