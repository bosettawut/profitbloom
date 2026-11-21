// Quote arithmetic used by both the API and the screens, so the web page, the PDF and the saved
// total can never disagree. How amounts are rounded is the quote's own choice:
//   'line'    each line says whether it rounds up to a whole baht; discount, VAT and totals keep the satang
//   'satang'  nothing is rounded past the satang (the same as 'line' with no line rounding up)
//   'baht'    quotes made before lines could choose: every amount is whole baht, halves up

/** 'exclusive' adds VAT on top of the prices, 'inclusive' means the prices already contain it, 'none' charges no VAT */
export const VAT_MODES = ['exclusive', 'inclusive', 'none'];

/** round to whole baht, halves up; the toFixed step keeps 2.675-style float noise from rounding the wrong way */
export const wholeBaht = (n) => Math.round(Number((Number(n) || 0).toFixed(4)));

/** round to the satang (two decimals), halves up */
export const toSatang = (n) => Math.round(Number(((Number(n) || 0) * 100).toFixed(4))) / 100;

/** up to the next whole baht as soon as there is any fraction; the toFixed step stops 100.00000000000001 becoming 101 */
export const bahtUp = (n) => Math.ceil(Number((Number(n) || 0).toFixed(4)));

export const ROUNDINGS = ['line', 'satang', 'baht'];
/** how a quote's sums (subtotal, discount, VAT, total) are rounded */
const rounder = (rounding) => (rounding === 'baht' ? wholeBaht : toSatang);

/** what one line comes to; on a 'line' quote a line marked roundUp goes up to the next whole baht */
export const lineAmount = (item, rounding = 'baht') => {
  const raw = item.quantity * item.unitPrice;
  if (rounding === 'baht') return wholeBaht(raw);
  return rounding === 'line' && item.roundUp ? bahtUp(raw) : toSatang(raw);
};

/**
 * The sums on a quote.
 *   subtotal       all lines
 *   discount       taken off the subtotal
 *   afterDiscount  what the lines come to after the discount — the figure a locked price is compared with
 *   beforeVat/vat  the price without VAT and the VAT itself
 *   total          what the customer pays
 */
export function quoteTotals({ items, discountRate = 0, taxRate = 0, vatMode = 'exclusive', rounding = 'baht' }) {
  // every sum goes back through the rounder: adding satang amounts as floats leaves 0.30000000000000004-style noise
  const r = rounder(rounding);
  const subtotal = r(items.reduce((s, i) => s + lineAmount(i, rounding), 0));
  const discount = r(subtotal * (discountRate / 100));
  const afterDiscount = r(subtotal - discount);
  const rate = vatMode === 'none' ? 0 : Number(taxRate) || 0;
  if (vatMode === 'inclusive') {
    const beforeVat = r((afterDiscount * 100) / (100 + rate));
    return { subtotal, discount, afterDiscount, beforeVat, vat: r(afterDiscount - beforeVat), total: afterDiscount, rate };
  }
  const vat = r(afterDiscount * (rate / 100));
  return { subtotal, discount, afterDiscount, beforeVat: afterDiscount, vat, total: r(afterDiscount + vat), rate };
}

/**
 * A job's planned cost and selling price, heading by heading: each heading has its own markup and the
 * job's price is the sum of its headings. Items outside any heading use the job's own markup.
 * Unplanned extras are not part of the price. Amounts are not rounded here.
 */
export function jobPricing(costItems, groups, markupPct = 0) {
  const list = groups || [];
  const planned = costItems.filter((i) => !i.isExtra);
  const sum = (items) => items.reduce((s, i) => s + i.quantity * i.price, 0);
  const ids = new Set(list.map((g) => g.id));
  const headings = list.map((g) => {
    const cost = sum(planned.filter((i) => i.groupId === g.id));
    return { id: g.id, name: g.name, markup: g.markup, cost, price: cost * (1 + g.markup / 100) };
  });
  const loose = sum(planned.filter((i) => !ids.has(i.groupId)));
  return {
    cost: headings.reduce((s, h) => s + h.cost, 0) + loose,
    price: headings.reduce((s, h) => s + h.price, 0) + loose * (1 + markupPct / 100),
    headings,
  };
}

/** the markup one cost item is sold at: its heading's, or the job's when it has no heading */
export function markupOf(item, groups, markupPct = 0) {
  const g = (groups || []).find((x) => x.id === item.groupId);
  return g ? g.markup : markupPct;
}

/** a job's selling price in whole baht */
export function projectPrice(costItems, markupPct, groups) {
  return wholeBaht(jobPricing(costItems, groups, markupPct).price);
}

/**
 * Changes one line so the quote comes to `target` after the discount. Prefers a line whose unit price
 * stays a clean number (largest first); otherwise the largest line takes the difference.
 * Returns the new items, or null when no subtotal gives exactly `target` (an awkward discount %).
 */
export function fitToPrice(items, target, discountRate = 0, rounding = 'baht') {
  const r = rounder(rounding);
  const step = rounding === 'baht' ? 1 : 0.01;
  const want = r(target);
  const current = quoteTotals({ items, discountRate, rounding });
  if (current.afterDiscount === want) return items;
  // the subtotal that leaves `target` after the discount; rounding means looking at the neighbours too
  const guess = r(want / (1 - discountRate / 100));
  let goal = null;
  for (const d of [0, 1, -1, 2, -2]) {
    const s = r(guess + d * step);
    if (Number.isFinite(s) && s >= 0 && r(s - r(s * (discountRate / 100))) === want) {
      goal = s;
      break;
    }
  }
  if (goal === null) return null;
  const diff = r(goal - current.subtotal);
  // a line that rounds up can only take the difference when that leaves it on a whole baht
  const keepsWhole = (x) => !(rounding === 'line' && x.item.roundUp) || Number.isInteger(x.amount);
  const order = items
    .map((item, index) => ({ item, index, amount: r(lineAmount(item, rounding) + diff) }))
    .filter((x) => x.item.quantity > 0 && x.amount >= 0 && keepsWhole(x))
    .sort((a, b) => b.amount - a.amount);
  if (order.length === 0) return null;
  const clean = order.find((x) => Number.isInteger(Math.round(x.amount * 100) / x.item.quantity));
  const pick = clean ?? order[0];
  const unitPrice = pick.amount / pick.item.quantity;
  return items.map((item, index) => (index === pick.index ? { ...item, unitPrice } : item));
}
