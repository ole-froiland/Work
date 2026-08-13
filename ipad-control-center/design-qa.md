# Design QA

## Evidence

- Source visual truth 1: `/var/folders/bx/x598dj4x52163bx0hbhdrw3c0000gn/T/codex-clipboard-26264b48-7b4c-4b38-9ae6-af2fcd5ae0b5.png` (2934 × 128 px, top-bar removal target)
- Source visual truth 2: `/var/folders/bx/x598dj4x52163bx0hbhdrw3c0000gn/T/codex-clipboard-1aa473ae-7a85-44b6-9d2e-601bb4597572.png` (586 × 1560 px, left-rail density target)
- Implementation URL: `http://192.168.68.104:4173/`
- Browser-rendered viewport inspected: 1280 × 720 CSS px, device density controlled by the Codex in-app browser
- Implementation screenshot: unavailable. The in-app browser rendered and exposed the full accessibility/DOM tree, but every `Page.captureScreenshot` request timed out before producing a file.
- State: landscape dashboard, day calendar selected, live usage and weather loaded, mobile metrics unsynced.

## Full-view comparison evidence

The browser-rendered DOM and measured layout confirm: no `.topbar` exists; the dashboard shell is 1280 × 720; document size is 1280 × 720; calendar bounds are x=298, y=10, w=686, h=700; all four quick actions are 48 px high; the bottom status row is visible; and there is no page overflow. The reference requests removal of the full-width header and major reduction of the quick-action height, which the measured implementation satisfies.

## Focused-region evidence

- Calendar toolbar: date and current clock are rendered beside the month heading; settings remain reachable from the same toolbar.
- Left rail: four quick actions are 48 px high and remain practical touch targets.
- Bottom status: `Skjermtid · i går`, weekly average, today’s steps, current weather, and sync state all appear in the browser DOM.
- Primary interactions tested: settings dialog opened and closed; month and day calendar tabs were clicked; manual usage refresh remains available.
- Browser console: a console-log capture API was unavailable on this browser surface. Build and runtime API checks showed no errors.

## Required fidelity surfaces

- Fonts and typography: existing SF Pro system stack and hierarchy preserved; compact controls use the same weights and scale as the surrounding dashboard.
- Spacing and layout rhythm: header space removed; grid expanded to the full viewport; compact 48 px action rows and 66 px bottom strip preserve the three-column rhythm.
- Colors and visual tokens: existing dark surfaces, higher-contrast borders, lime/violet/blue/orange semantic colors preserved.
- Image quality and assets: no raster imagery exists in the target region; existing Phosphor icon family is preserved, with no placeholder or custom SVG substitution.
- Copy and content: date/time moved to the calendar; bottom labels use Norwegian and distinguish unsynced mobile data from live weather.

## Findings

- [P1] Required browser screenshot could not be captured.
  - Location: full dashboard.
  - Evidence: the implementation rendered and was measurable in the in-app browser, but repeated screenshot calls timed out.
  - Impact: a combined source/implementation visual comparison cannot be produced, so visual QA cannot honestly pass.
  - Fix: recapture the current in-app browser tab once its screenshot service responds, create a combined comparison image, then re-run this gate.

## Comparison history

- Current pass: functional and layout measurements completed; screenshot capture remained blocked. No visual fixes were made from an unavailable combined comparison.

## Implementation checklist

- [x] Remove global top bar.
- [x] Move date, clock, and settings access into calendar toolbar.
- [x] Reduce quick actions to compact touch-safe rows.
- [x] Add screen-time yesterday/weekly average, steps, and live weather to bottom strip.
- [x] Preserve a truthful unsynced state for Apple-protected data.
- [x] Verify unit tests, production build, Sites bundle, API responses, DOM, interactions, and overflow.
- [ ] Capture browser-rendered screenshot and complete combined visual comparison.

final result: blocked
