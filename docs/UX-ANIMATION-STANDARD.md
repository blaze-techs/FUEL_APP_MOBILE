# FuelPro UX & Animation Implementation Standard

This standard translates the 20 principles in the supplied reference video into implementation rules for the shared FuelPro web application. The PWA, Capacitor Android shell and Electron desktop shell consume the same web UI, so shared UI work is the source of truth for those surfaces. Native packaging and release artifacts still require their own build and device verification.

## Principles and acceptance criteria

1. **Squash & stretch** — use restrained press/feedback scale on interactive controls only; never distort text, charts, prices or financial values.
2. **Anticipation wind-up** — provide immediate pressed/loading state before expensive actions; prevent duplicate submissions while pending.
3. **Staging the focus** — establish clear visual hierarchy for primary actions, totals, alerts and current workflow state.
4. **Pose to pose** — define stable start, pending, success, empty and error states for each async workflow.
5. **Follow through** — preserve completion feedback until the user can perceive it; do not delay navigation or data entry for decorative animation.
6. **Slow in & slow out** — use the shared easing tokens; avoid linear motion for ordinary UI transitions.
7. **Moving in arcs** — reserve curved paths for small decorative/illustrative motion; operational controls should move predictably.
8. **Secondary action** — use subtle supporting feedback (icon/state change) only when it reinforces the primary action.
9. **Snappy timing** — target 100–220ms for routine feedback and keep longer motion below 300ms unless it communicates a meaningful process.
10. **Exaggerated feedback** — make success, warning and failure distinguishable through text/icon/state as well as color; no color-only status.
11. **Solid drawing in 3D** — maintain consistent elevation, layering and perspective; avoid unnecessary parallax or fake depth in data-dense screens.
12. **Overall appeal** — reuse the existing FuelPro design tokens, typography, spacing and theme behavior rather than introducing competing visual systems.
13. **Fitts's law** — place primary actions near the relevant content and make frequent actions easy to reach.
14. **Bigger hit areas** — touch controls should be at least 44×44 CSS pixels where practical, without making desktop data tables unwieldy.
15. **Hick's law** — reduce simultaneous choices, group secondary actions and keep navigation shallow.
16. **Miller's law** — group related fields, metrics and actions into scannable sections; do not present long undifferentiated lists.
17. **Doherty threshold** — show immediate acknowledgement, optimistic progress only when safe, and skeleton/progress states for slow work.
18. **Postel's law** — accept reasonable input variations, validate clearly, preserve user input on errors and never silently coerce financial values.
19. **Jakob's law** — keep familiar platform conventions for navigation, forms, dialogs, tables, keyboard behavior and mobile gestures.
20. **Frequency of use** — prioritize daily workflows (sales, shift close, payments, stock, reports) over rarely used administration actions.

## Shared implementation primitives

- `src/react-app/styles/ux-motion.css` defines opt-in motion classes, motion tokens, keyboard focus and coarse-pointer target sizing.
- Use `.fp-motion-target` only on real interactive surfaces and `.fp-motion-enter` for short, non-blocking entrance transitions.
- Respect `prefers-reduced-motion`; motion is decorative and must never carry essential meaning.
- Keep financial values, ledger records, audit history, and transaction state changes free from animation-driven or optimistic data mutation.

## Required verification before calling the rollout complete

- Run typecheck, lint, unit tests and production build.
- Run Playwright flows for sign-in, station selection, sale, payment, shift close, reports and offline recovery.
- Verify keyboard-only navigation, focus visibility, reduced-motion mode and 320px/360px phone, tablet, laptop and wide-screen layouts.
- Verify the same release on Cloudflare Pages and the Vercel fallback.
- Build and smoke-test the Android APK and Windows installer/portable EXE separately; confirm native navigation, file exports, safe areas and update behavior.
- Do not claim the native packages or production site are updated until their actual build/deployment artifacts and live URLs are verified.
