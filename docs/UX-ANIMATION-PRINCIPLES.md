# FuelPro UX and animation principles

This document is the implementation contract for the 20 principles in the supplied reference. The shared web application is also the UI payload used by the PWA, Capacitor Android shell and Electron desktop shell; native packaging still requires separate builds and device verification.

## Implemented shared foundation in this change

- Shared motion tokens: 80/140/200/280 ms timing and standard/emphasized/exit easing.
- Restrained press feedback for enabled buttons and role=button controls; no global elastic animation.
- Visible keyboard focus indicators for buttons, links, inputs, selects, textareas and summaries.
- 44px minimum touch target sizing on coarse-pointer devices, without inflating desktop controls.
- Reusable enter, exit, emphasis, stagger and arc-motion classes for component-level adoption.
- Elevation tokens and semantic hooks for staging primary/secondary information.
- Explicit opt-out for financial/measurement values and individual elements.
- OS reduced-motion support for web, PWA and embedded web views.

## Principle-by-principle implementation contract

| # | Principle | FuelPro implementation rule | Status in shared foundation |
|---:|---|---|---|
| 1 | Squash and stretch | Use tiny press compression on actionable controls only; never distort text, charts or money values. | Applied to enabled buttons and role=button controls |
| 2 | Anticipation / wind-up | For consequential actions, show a clear pending/confirmation state before committing; never delay a transaction just to animate it. | Motion tokens available; workflow-level adoption required |
| 3 | Staging the focus | Give the current task and primary action visual priority; demote supporting detail without hiding it. | Semantic secondary/elevation hooks available; screen-level adoption required |
| 4 | Pose to pose | Define stable start, pending, success, empty and error states; transitions must reflect real application state. | Enter/exit primitives available; state wiring required |
| 5 | Follow through | Let menus, drawers and confirmations settle naturally after state changes; preserve focus and dismiss behavior. | Exit/enter primitives available; overlay-level adoption required |
| 6 | Slow in and slow out | Use consistent easing and short durations; avoid sluggish movement in high-frequency POS flows. | Shared easing and duration tokens applied |
| 7 | Moving in arcs | Reserve curved/arc motion for lightweight spatial transitions; do not animate operational data or impair reduced-motion users. | Arc primitive available for intentional use |
| 8 | Secondary action | Supporting motion must clarify the primary task, never compete with it. | Secondary-content and stagger hooks available |
| 9 | Snappy timing | Keep feedback immediate; target a perceptible response within 100ms and avoid blocking the main thread. | Fast motion tokens and interaction feedback applied; performance profiling required |
| 10 | Exaggeration | Use restrained emphasis for important state changes only; no theatrical movement in accounting/POS screens. | Emphasis primitive available |
| 11 | Solid drawing / 3D form | Use consistent elevation, layering and clear surfaces; preserve legibility and avoid decorative 3D clutter. | Three shared elevation levels available |
| 12 | Appeal | Maintain FuelPro's existing brand palette, typography, spacing and consistent component treatment. | Existing design tokens retained; visual QA required |
| 13 | Fitts's law | Make primary and frequent controls easy to reach; place destructive actions away from common actions. | Touch-target baseline applied; layout review required |
| 14 | Bigger hit areas | Ensure touch controls have at least 44px target height on coarse pointers. | Applied to common actionable controls |
| 15 | Hick's law | Group related choices, prioritize common tasks and avoid unnecessary navigation choices. | Existing grouped tabs from PR #85 retained; module-by-module review required |
| 16 | Miller's law | Chunk dense operational data into meaningful groups with clear labels and summaries. | Design contract; module-level information architecture work required |
| 17 | Doherty threshold | Provide immediate feedback and progressive loading; keep expensive work off the interaction path. | Fast interaction tokens; runtime profiling and loading-state audit required |
| 18 | Postel's law | Accept forgiving input formats where safe, validate clearly, preserve user input and never silently alter financial data. | Must be enforced in each form/workflow; not changed by CSS |
| 19 | Jakob's law | Keep familiar controls, labels, navigation and platform conventions; do not redesign established workflows without evidence. | Existing navigation and workflows preserved; usability testing required |
| 20 | Frequency of use | Put daily actions first and reduce steps for common tasks while keeping infrequent configuration discoverable. | Existing daily-first ordering from PR #82 retained; usage-informed audit required |

## Non-negotiable operational safeguards

1. Motion is presentation only. It must never control transaction timing, payment confirmation, inventory updates, authorization, or data persistence.
2. Reduced-motion preferences must be respected. No essential information may depend on animation.
3. Financial values, meter readings, litres, pump prices and reconciliation figures must not animate or visually interpolate.
4. Every action must remain keyboard accessible, have a visible focus state, and expose its real disabled/pending state.
5. Touch sizing must not cause tab overflow, cover content, or make dense desktop workflows unusable.
6. A loading animation is not evidence that a request succeeded. Success feedback must follow the authoritative response.
7. Existing routes, deep links, roles, station scoping, audit records and calculations must remain unchanged.

## Verification required before production release

- TypeScript, ESLint, Prettier, unit tests and production build.
- Playwright at 390x844, 820x1180 and 1366x768; verify no overflow, hidden controls or focus traps.
- Keyboard-only navigation and screen-reader labels.
- Reduced-motion emulation and touch-target inspection.
- POS sale, shift open/close, invoice/receipt, M-PESA callback, stock update and reconciliation regression tests.
- Real Android APK smoke test and Windows installer/portable EXE smoke test.
- Confirm Cloudflare Pages and Vercel production deployments use the same verified commit.

The presence of this document or the shared stylesheet is not, by itself, a claim that every module has passed the above checks. Module-specific adoption and release verification are required before calling the work complete.
