# Prompts dropdown — "can't scroll down past initial view"

User reported the Prompts dropdown UI is broken because they can't scroll
down past what's initially visible (screenshot showed scrollbar at ~60%
with more content below, but wheel/drag does not advance further).

## Most likely root cause (chosen)

`attachPromptsDropdownBehavior` in `panel-controls.ts` registered a
capture-phase `scroll` listener on `window` that re-runs
`positionPromptsDropdown` on EVERY scroll event — including scrolls that
originate inside the dropdown itself.

`positionPromptsDropdown` first resets `maxHeight` back to the cap
(`DROPDOWN_MAX_HEIGHT_CAP = 480`), measures, then clamps. Doing this on
every wheel tick causes layout thrash; the dropdown's scrollTop snaps and
further wheel input is effectively swallowed.

## Fix applied

Filter the scroll listener: ignore events whose `target` is the dropdown
or any descendant. Resize still re-positions.

## Alternatives considered

- Throttle/debounce — adds latency, doesn't address the conceptual bug
  that internal scroll should never trigger re-positioning.
- Remove the scroll listener entirely — would break re-positioning when
  the host page scrolls while the dropdown is open.

## Recommendation if user reports different symptom

Could be max-height undercount when dropdown is opened before content
renders. If so, call `positionPromptsDropdown` a second time after
`renderPromptsDropdown` resolves.
