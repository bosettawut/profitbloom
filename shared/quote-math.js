// Quote arithmetic used by both the API and the screens, so the web page, the PDF and the saved
// total can never disagree. Every amount on a quote is a whole number of baht.

/** 'exclusive' adds VAT on top of the prices, 'inclusive' means the prices already contain it, 'none' charges no VAT */
export const VAT_MODES = ['exclusive', 'inclusive', 'none'];

/** round to whole baht, halves up; the toFixed step keeps 2.675-style float noise from rounding the wrong way */
export const wholeBaht = (n) => Math.round(Number((Number(n) || 0).toFixed(4)));

/** what one line comes to */
export const lineAmount = (item) => wholeBaht(item.quantity * item.unitPrice);

/**
 * The sums on a quote.
 *   subtotal       all lines
 *   discount       taken off the subtotal
 *   afterDiscount  what the lines come to after the discount — the figure a locked price is compared with
 *   beforeVat/vat  the price without VAT and the VAT itself
 *   total          what the customer pays
 */
export function quoteTotals({ items, discountRate = 0, taxRate = 0, vatMode = 'exclusive' }) {
  const subtotal = items.reduce((s, i) => s + lineAmount(i), 0);
  const discount = wholeBaht(subtotal * (discountRate / 100));
  const afterDiscount = subtotal - discount;
  const rate = vatMode === 'none' ? 0 : Number(taxRate) || 0;
  if (vatMode === 'inclusive') {
    const beforeVat = wholeBaht((afterDiscount * 100) / (100 + rate));
    return { subtotal, discount, afterDiscount, beforeVat, vat: afterDiscount - beforeVat, total: afterDiscount, rate };
  }
  const vat = wholeBaht(afterDiscount * (rate / 100));
  return { subtotal, discount, afterDiscount, beforeVat: afterDiscount, vat, total: afterDiscount + vat, rate };
}

/** a job's selling price in whole baht: planned cost plus its markup (unplanned extras are not part of the price) */
export function projectPrice(costItems, markupPct) {
  const cost = costItems.reduce((s, i) => s + (i.isExtra ? 0 : i.quantity * i.price), 0);
  return wholeBaht(cost * (1 + markupPct / 100));
}

/**
 * Changes one line so the quote comes to `target` after the discount. Prefers a line whose unit price
 * stays a clean number (largest first); otherwise the largest line takes the difference.
 * Returns the new items, or null when no subtotal gives exactly `target` (an awkward discount %).
 */
export function fitToPrice(items, target, discountRate = 0) {
  const current = quoteTotals({ items, discountRate });
  if (current.afterDiscount === target) return items;
  // the subtotal that leaves `target` after the discount; rounding means looking at the neighbours too
  const guess = Math.round(target / (1 - discountRate / 100));
  let goal = null;
  for (const d of [0, 1, -1, 2, -2]) {
    const s = guess + d;
    if (Number.isFinite(s) && s >= 0 && s - wholeBaht(s * (discountRate / 100)) === target) {
      goal = s;
      break;
    }
  }
  if (goal === null) return null;
  const diff = goal - current.subtotal;
  const order = items
    .map((item, index) => ({ item, index, amount: lineAmount(item) }))
    .filter((x) => x.item.quantity > 0 && x.amount + diff >= 0)
    .sort((a, b) => b.amount - a.amount);
  if (order.length === 0) return null;
  const clean = order.find((x) => Number.isInteger(((x.amount + diff) * 100) / x.item.quantity));
  const pick = clean ?? order[0];
  const unitPrice = (pick.amount + diff) / pick.item.quantity;
  return items.map((item, index) => (index === pick.index ? { ...item, unitPrice } : item));
}
