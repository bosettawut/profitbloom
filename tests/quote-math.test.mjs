// Rounding on a quote: line by line, to the satang, or the old whole-baht rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bahtUp, fitToPrice, lineAmount, quoteTotals, toSatang, wholeBaht } from '../shared/quote-math.js';

const lines = [{ quantity: 3, unitPrice: 33.33 }];

test('halves round up, in baht and in satang', () => {
  assert.equal(wholeBaht(0.5), 1);
  assert.equal(wholeBaht(2.4999), 2);
  assert.equal(toSatang(1.005), 1.01);
  assert.equal(toSatang(2.675), 2.68);
  assert.equal(toSatang(0.1 + 0.2), 0.3);
});

test('the old rule: every amount is a whole number, halves up', () => {
  const t = quoteTotals({ items: lines, discountRate: 5, taxRate: 7, rounding: 'baht' });
  assert.deepEqual([t.subtotal, t.discount, t.afterDiscount, t.vat, t.total], [100, 5, 95, 7, 102]);
  assert.equal(lineAmount(lines[0]), 100);
});

test('satang keeps two decimals on every amount, and they still add up', () => {
  const t = quoteTotals({ items: lines, discountRate: 5, taxRate: 7, rounding: 'satang' });
  assert.deepEqual([t.subtotal, t.discount, t.afterDiscount, t.vat, t.total], [99.99, 5, 94.99, 6.65, 101.64]);
  assert.equal(lineAmount(lines[0], 'satang'), 99.99);
  assert.equal(toSatang(t.afterDiscount + t.vat), t.total);
});

test('satang with VAT inside the price splits the price exactly', () => {
  const t = quoteTotals({ items: [{ quantity: 1, unitPrice: 1000 }], taxRate: 7, vatMode: 'inclusive', rounding: 'satang' });
  assert.deepEqual([t.beforeVat, t.vat, t.total], [934.58, 65.42, 1000]);
});

test('many satang lines add up without float noise', () => {
  const items = Array.from({ length: 10 }, () => ({ quantity: 1, unitPrice: 0.1 }));
  assert.equal(quoteTotals({ items, rounding: 'satang' }).subtotal, 1);
});

test('fitting to a locked price works in both modes', () => {
  const items = [{ quantity: 3, unitPrice: 33.33 }, { quantity: 2, unitPrice: 10.25 }];
  const baht = fitToPrice(items, 150, 0);
  assert.equal(quoteTotals({ items: baht }).afterDiscount, 150);
  const satang = fitToPrice(items, 150.75, 0, 'satang');
  assert.equal(quoteTotals({ items: satang, rounding: 'satang' }).afterDiscount, 150.75);
  const discounted = fitToPrice(items, 99.5, 10, 'satang');
  assert.equal(quoteTotals({ items: discounted, discountRate: 10, rounding: 'satang' }).afterDiscount, 99.5);
});

test('rounding up takes any fraction to the next baht, and float noise does not', () => {
  assert.equal(bahtUp(99.01), 100);
  assert.equal(bahtUp(100), 100);
  assert.equal(bahtUp(100.00000000000001), 100);
  assert.equal(bahtUp(3 * 33.333333333333336), 100);
  assert.equal(bahtUp(0), 0);
});

test('line by line: only the ticked lines round up, discount and VAT keep the satang', () => {
  const items = [{ quantity: 3, unitPrice: 33.33, roundUp: true }, { quantity: 1, unitPrice: 10.25, roundUp: false }];
  assert.deepEqual(items.map((i) => lineAmount(i, 'line')), [100, 10.25]);
  const t = quoteTotals({ items, discountRate: 5, taxRate: 7, rounding: 'line' });
  assert.deepEqual([t.subtotal, t.discount, t.afterDiscount, t.vat, t.total], [110.25, 5.51, 104.74, 7.33, 112.07]);
});

test('line by line with every line rounding up still charges VAT to the satang', () => {
  const items = [{ quantity: 3, unitPrice: 33.33, roundUp: true }, { quantity: 1, unitPrice: 10.25, roundUp: true }];
  const t = quoteTotals({ items, taxRate: 7, rounding: 'line' });
  assert.deepEqual([t.subtotal, t.vat, t.total], [111, 7.77, 118.77]);
});

test('line by line with no line rounding up is the same as satang', () => {
  const items = [{ quantity: 3, unitPrice: 33.33 }, { quantity: 7, unitPrice: 12.345 }];
  assert.deepEqual(quoteTotals({ items, discountRate: 3, taxRate: 7, rounding: 'line' }), quoteTotals({ items, discountRate: 3, taxRate: 7, rounding: 'satang' }));
});

test('fitting to a locked price leaves rounded-up lines on whole baht', () => {
  const items = [{ quantity: 3, unitPrice: 33.33, roundUp: true }, { quantity: 2, unitPrice: 10.25, roundUp: false }];
  const whole = fitToPrice(items, 150, 0, 'line');
  assert.equal(quoteTotals({ items: whole, rounding: 'line' }).afterDiscount, 150);
  // 150.75 can only be met by the line that keeps its satang
  const odd = fitToPrice(items, 150.75, 0, 'line');
  assert.equal(quoteTotals({ items: odd, rounding: 'line' }).afterDiscount, 150.75);
  assert.equal(lineAmount(odd[0], 'line'), 100);
  // and not at all when every line rounds up
  assert.equal(fitToPrice(items.map((i) => ({ ...i, roundUp: true })), 150.75, 0, 'line'), null);
});

test('withholding tax is a % of the price without VAT, taken off what the customer transfers', () => {
  const items = [{ quantity: 1, unitPrice: 10000 }];
  const t = quoteTotals({ items, taxRate: 7, rounding: 'line', whtRate: 3 });
  assert.deepEqual([t.total, t.withholding, t.payable], [10700, 300, 10400]);
  // the quote's own total does not move
  assert.equal(quoteTotals({ items, taxRate: 7, rounding: 'line' }).total, t.total);
});

test('withholding follows the discount and the VAT mode', () => {
  const items = [{ quantity: 1, unitPrice: 10700 }];
  const inside = quoteTotals({ items, taxRate: 7, vatMode: 'inclusive', rounding: 'line', whtRate: 3 });
  assert.deepEqual([inside.beforeVat, inside.withholding, inside.payable], [10000, 300, 10400]);
  const none = quoteTotals({ items, discountRate: 10, vatMode: 'none', rounding: 'line', whtRate: 3 });
  assert.deepEqual([none.afterDiscount, none.withholding, none.payable], [9630, 288.9, 9341.1]);
});

test('withholding keeps the satang, is whole baht on an old quote, and is nothing at 0%', () => {
  const items = [{ quantity: 3, unitPrice: 33.33 }];
  const line = quoteTotals({ items, taxRate: 7, rounding: 'line', whtRate: 3 });
  assert.deepEqual([line.withholding, line.payable], [3, 103.99]);
  const old = quoteTotals({ items, taxRate: 7, rounding: 'baht', whtRate: 1.5 });
  assert.deepEqual([old.total, old.withholding, old.payable], [107, 2, 105]);
  const off = quoteTotals({ items, taxRate: 7, rounding: 'line' });
  assert.deepEqual([off.whtRate, off.withholding, off.payable], [0, 0, off.total]);
});
