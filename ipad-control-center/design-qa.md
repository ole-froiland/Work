# Design QA

## Evidence

- Source visual truth 1: `/var/folders/bx/x598dj4x52163bx0hbhdrw3c0000gn/T/codex-clipboard-7dc84c1e-46f1-477f-a6a1-f4b63cee2e5f.png` (572 × 686 px, Oppgaver-kort before state).
- Source visual truth 2: `/var/folders/bx/x598dj4x52163bx0hbhdrw3c0000gn/T/codex-clipboard-0d9b785e-7873-42d8-8ad0-9c0eab0c955f.png` (596 × 230 px, Neste aktivitet before state).
- Browser-rendered implementation: `output/playwright/activity-cards-after-1366x768.png` (1366 × 768 px).
- Focused implementation crops: `output/playwright/agent-card-after.png` (280 × 267 px) and `output/playwright/next-event-after.png` (278 × 104 px).
- Combined comparison input: `output/playwright/activity-cards-design-compare.png` (1192 × 916 px).
- Viewport: 1366 × 768 CSS px in the Codex in-app browser, device density 1.
- Density normalization: the two Retina source crops were treated as 2× references; the implementation crops were scaled 2× with Lanczos only for the combined comparison board.
- State: live landscape dashboard, three recent agent tasks, no event currently in progress, next event shown for tomorrow.

## Full-view comparison evidence

The complete 1366 × 768 browser capture preserves the existing three-column dashboard, typography, color tokens, card radii, and landscape no-scroll layout. The only visual changes are confined to the requested Oppgaver and activity cards.

## Focused-region comparison evidence

- Oppgaver: before measurement showed a 244 px list with 298 px rows. After the fix both list and rows measure 254 px at the compact landscape breakpoint, with `scrollWidth === clientWidth`; long task details truncate inside the card instead of creating horizontal scrolling.
- Activity card: the title/icon group is vertically centered in the space above the divider. The live next-event state matches the existing visual language and keeps the date and countdown aligned.
- Ongoing-event state: covered by a deterministic UI-data test at 11:15, showing `Skole`, `45 min igjen`, and `Neste: Trening` with its countdown. The live calendar had no ongoing event at capture time, so this state could not be photographed without fabricating calendar data.
- Browser console: no warnings or errors were reported during the final capture.

## Required fidelity surfaces

- Fonts and typography: existing SF Pro system stack, weights, line heights, uppercase eyebrow labels, and ellipsis behavior are preserved.
- Spacing and layout rhythm: existing card dimensions and rail spacing are preserved; task rows now fit their parent, and the activity header is optically centered without changing card height.
- Colors and visual tokens: existing dark surfaces, borders, lime working state, orange calendar accent, and muted secondary text are reused.
- Image quality and asset fidelity: no new raster assets were required. Existing Phosphor calendar/folder icons and provider marks remain unchanged.
- Copy and content: existing Norwegian labels remain. The new state uses `Pågår nå`, remaining time such as `45 min igjen`, and `Neste: …` for the following event.

## Findings

No actionable P0, P1, or P2 differences remain in the requested regions.

## Comparison history

- Initial finding [P1]: task rows were 54 px wider than the list and forced horizontal scrolling.
- Fix: constrained each row to its grid width, allowed the final detail to shrink, and disabled horizontal list overflow.
- Post-fix evidence: list and all three rows measure 254 px wide with no horizontal overflow at 1366 × 768.
- Initial finding [P2]: a future event always displaced an event already in progress, and the activity header sat at the top of its available region.
- Fix: separated current and next event descriptions, added remaining-time copy, and centered the title/icon group in the upper grid row.
- Post-fix evidence: focused visual comparison passes for the live next-event state; current-plus-next behavior passes its deterministic test.

## Implementation checklist

- [x] Remove horizontal scrolling from Oppgaver.
- [x] Preserve readable title, folder, status, and activity text.
- [x] Center the activity title/icon group.
- [x] Show an ongoing activity with time remaining.
- [x] Show the following activity and its countdown when available.
- [x] Verify compact landscape layout, browser console, tests, and build.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed
