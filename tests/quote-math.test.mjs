// Rounding on a quote: whole baht (the default) or to the satang.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitToPrice, lineAmount, quoteTotals, toSatang, wholeBaht } from '../shared/quote-math.js';

const lines = [{ quantity: 3, unitPrice: 33.33 }];

test('halves round up, in baht and in satang', () => {
  assert.equal(wholeBaht(0.5), 1);
  assert.equal(wholeBaht(2.4999), 2);
  assert.equal(toSatang(1.005), 1.01);
  assert.equal(toSatang(2.675), 2.68);
  assert.equal(toSatang(0.1 + 0.2), 0.3);
});

test('whole baht is the default and every amount is a whole number', () => {
  const t = quoteTotals({ items: lines, discountRate: 5, taxRate: 7 });
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
