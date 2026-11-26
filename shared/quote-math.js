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
 *   total          the quote's amount, VAT included
 *   withholding    tax the customer holds back and pays to the revenue office for the seller: a % of the price without VAT
 *   payable        what the customer actually transfers: total less withholding
 */
export function quoteTotals({ items, discountRate = 0, taxRate = 0, vatMode = 'exclusive', rounding = 'baht', whtRate = 0 }) {
  // every sum goes back through the rounder: adding satang amounts as floats leaves 0.30000000000000004-style noise
  const r = rounder(rounding);
  const subtotal = r(items.reduce((s, i) => s + lineAmount(i, rounding), 0));
  const discount = r(subtotal * (discountRate / 100));
  const afterDiscount = r(subtotal - discount);
  const rate = vatMode === 'none' ? 0 : Number(taxRate) || 0;
  const wht = Math.min(100, Math.max(0, Number(whtRate) || 0));
  // withholding is worked out on the price without VAT, then taken off what the customer transfers
  const withheld = (beforeVat, total) => {
    const withholding = r(beforeVat * (wht / 100));
    return { whtRate: wht, withholding, payable: r(total - withholding) };
  };
  if (vatMode === 'inclusive') {
    const beforeVat = r((afterDiscount * 100) / (100 + rate));
    return { subtotal, discount, afterDiscount, beforeVat, vat: r(afterDiscount - beforeVat), total: afterDiscount, rate, ...withheld(beforeVat, afterDiscount) };
  }
  const vat = r(afterDiscount * (rate / 100));
  const total = r(afterDiscount + vat);
  return { subtotal, discount, afterDiscount, beforeVat: afterDiscount, vat, total, rate, ...withheld(afterDiscount, total) };
}

/** how a heading's discount is given: a share of its price, or an amount in baht */
export const DISCOUNT_TYPES = ['percent', 'baht'];

/**
 * What a heading's discount takes off a price of `listPrice` (the heading's price before the discount), in baht:
 * a share of it (never more than all of it) or a fixed amount (never more than the price itself).
 */
export function headingDiscount(group, listPrice) {
  const d = Number(group?.discount) || 0;
  if (!(d > 0) || !(listPrice > 0)) return 0;
  return Math.min(listPrice, group.discountType === 'baht' ? d : listPrice * (Math.min(d, 100) / 100));
}

/**
 * A job's planned cost and selling price, heading by heading: each heading has its own markup, and may take a
 * discount off the price that markup gives (`listPrice` before it, `off` in baht, `price` after it). The job's
 * price is the sum of its headings. Items outside any heading use the job's own markup.
 * Unplanned extras are not part of the price. Amounts are not rounded here.
 */
export function jobPricing(costItems, groups, markupPct = 0) {
  const list = groups || [];
  const planned = costItems.filter((i) => !i.isExtra);
  const sum = (items) => items.reduce((s, i) => s + i.quantity * i.price, 0);
  const ids = new Set(list.map((g) => g.id));
  const headings = list.map((g) => {
    const cost = sum(planned.filter((i) => i.groupId === g.id));
    const listPrice = cost * (1 + g.markup / 100);
    const off = headingDiscount(g, listPrice);
    return { id: g.id, name: g.name, markup: g.markup, cost, listPrice, off, price: listPrice - off };
  });
  const loose = sum(planned.filter((i) => !ids.has(i.groupId)));
  return {
    cost: headings.reduce((s, h) => s + h.cost, 0) + loose,
    price: headings.reduce((s, h) => s + h.price, 0) + loose * (1 + markupPct / 100),
    headings,
  };
}

/**
 * The markup one cost item is sold at: its heading's, or the job's when it has no heading. Given the job's
 * items too, a heading's discount is counted in: the markup is what the heading sells at after it, so the
 * items priced this way add up to the heading's price.
 */
export function markupOf(item, groups, markupPct = 0, costItems) {
  const g = (groups || []).find((x) => x.id === item.groupId);
  if (!g) return markupPct;
  if (!costItems || !(Number(g.discount) > 0)) return g.markup;
  const h = jobPricing(costItems, groups, markupPct).headings.find((x) => x.id === g.id);
  return h && h.cost > 0 ? (h.price / h.cost - 1) * 100 : g.markup;
}

/**
 * Whole-baht amounts for `prices` that add up to `total`: each price is rounded down, and the baht still missing go
 * to the ones that lost the largest fraction, so a price that was whole to begin with is never moved. Returns null
 * when `total` is not the prices' own sum to within their rounding (then it is not a matter of rounding at all).
 */
export function wholeBahtShares(prices, total) {
  if (!Number.isInteger(total)) return null;
  const floors = prices.map((p) => Math.floor(p + 1e-9));
  const left = total - floors.reduce((s, n) => s + n, 0);
  if (left < 0 || left > prices.length) return null;
  const out = [...floors];
  const byFraction = prices.map((p, i) => ({ i, lost: p - floors[i] })).sort((a, b) => b.lost - a.lost);
  for (const { i } of byFraction.slice(0, left)) out[i] += 1;
  return out;
}

/** a job's selling price in whole baht */
export function projectPrice(costItems, markupPct, groups) {
  return wholeBaht(jobPricing(costItems, groups, markupPct).price);
}

/**
 * The lines of the quote that follows a job, and the price they come to.
 * One line per heading, named after it and priced at what the heading sells for (its costs with its markup, less its
 * discount), so the customer sees the headings and not the costs inside them. A heading with nothing costed under it
 * is left out, unless that is true of every heading. The headings' prices are rounded to whole baht together, so they
 * add up to the job's price and a heading that was already a whole number of baht stays as it is; should that not be
 * possible, one line takes up the difference. `price` is null for a job with no price yet.
 */
export function quoteLinesFromJob(costItems, groups, markupPct = 0, agreedPrice = null) {
  const planned = costItems.filter((i) => !i.isExtra);
  const worked = jobPricing(costItems, groups, markupPct);
  const whole = agreedPrice ?? wholeBaht(worked.price);
  const price = whole > 0 ? whole : null;
  const used = worked.headings.map((h, n) => ({ ...h, place: n + 1 })).filter((h) => planned.some((i) => i.groupId === h.id));
  const costed = used.filter((h) => h.cost > 0);
  const chosen = costed.length ? costed : used;
  const fromHeadings = chosen.map((h) => ({ description: (h.name || '').trim() || `หัวข้อที่ ${h.place}`, quantity: 1, unit: '', unitPrice: wholeBaht(h.price) }));
  // items outside every heading (none on a job saved by this app) still come one by one
  const inHeading = new Set(worked.headings.map((h) => h.id));
  const loose = planned
    .filter((i) => !inHeading.has(i.groupId))
    .map((item) => ({ description: item.name ?? '', quantity: item.quantity, unit: item.unit ?? '', unitPrice: wholeBaht(item.price * (1 + markupOf(item, groups, markupPct, costItems) / 100)) }));
  const shares = price !== null && loose.length === 0 ? wholeBahtShares(chosen.map((h) => h.price), price) : null;
  if (shares) fromHeadings.forEach((line, n) => (line.unitPrice = shares[n]));
  // lines round up unless the job's price itself has satang, which whole-baht lines could never add up to
  const roundUp = price === null || Number.isInteger(price);
  const lines = [...fromHeadings, ...loose].map((line) => ({ ...line, roundUp }));
  return { price, lines: (price !== null && fitToPrice(lines, price, 0, 'line')) || lines };
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
