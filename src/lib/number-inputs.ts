/**
 * Tidies every number box in the app while it is being typed in:
 *   - a zero in front of other digits goes away ("0555" → "555"; "0.5" stays)
 *   - a box emptied by the user shows 0 again, unless it has a placeholder (those boxes mean
 *     "not filled in" when empty) or is marked data-keep-empty; those stay empty
 *
 * It runs before React sees the keystroke, and writes through the browser's own value setter,
 * so React still notices the change and the screens' onChange handlers receive the tidy value.
 */
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function tidy(event: Event) {
  const el = event.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
  // half-typed text the browser cannot read as a number yet, such as "-"
  if (el.validity.badInput) return;
  const text = el.value;
  const next = text === '' ? (el.placeholder || 'keepEmpty' in el.dataset ? '' : '0') : text.replace(/^(-?)0+(?=\d)/, '$1');
  if (next !== text) setValue.call(el, next);
}

export function tidyNumberInputs() {
  document.addEventListener('input', tidy, true);
}
