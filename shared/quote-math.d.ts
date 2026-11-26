export type VatMode = 'exclusive' | 'inclusive' | 'none';
export const VAT_MODES: VatMode[];
/**
 * 'line'    each line says whether it rounds up to a whole baht; discount, VAT and totals keep the satang
 * 'satang'  nothing is rounded past the satang
 * 'baht'    quotes made before lines could choose: every amount is whole baht, halves up
 */
export type Rounding = 'line' | 'satang' | 'baht';
export const ROUNDINGS: Rounding[];
export function wholeBaht(n: number): number;
export function toSatang(n: number): number;
export function bahtUp(n: number): number;
export function lineAmount(item: { quantity: number; unitPrice: number; roundUp?: boolean }, rounding?: Rounding): number;
export interface QuoteTotals {
  subtotal: number;
  discount: number;
  afterDiscount: number;
  beforeVat: number;
  vat: number;
  total: number;
  /** the VAT % actually applied (0 when the quote has no VAT) */
  rate: number;
  /** the withholding-tax % applied (0 when none is withheld) */
  whtRate: number;
  /** tax the customer holds back: a % of the price without VAT */
  withholding: number;
  /** what the customer actually transfers: total less withholding */
  payable: number;
}
export function quoteTotals(q: {
  items: Array<{ quantity: number; unitPrice: number; roundUp?: boolean }>;
  discountRate?: number;
  taxRate?: number;
  vatMode?: VatMode;
  rounding?: Rounding;
  whtRate?: number;
}): QuoteTotals;
export interface PricedItem {
  quantity: number;
  price: number;
  isExtra?: boolean;
  groupId?: number | null;
}
export interface PricedGroup {
  id: number;
  name: string;
  /** markup on cost in % */
  markup: number;
  /** how the heading's discount is given; nothing (or 0) = no discount */
  discountType?: 'percent' | 'baht';
  /** a share of the heading's price in %, or an amount in baht */
  discount?: number;
}
export interface JobPricing {
  cost: number;
  price: number;
  /** `listPrice` is the heading's price before its discount, `off` what the discount takes in baht, `price` what is left */
  headings: Array<{ id: number; name: string; markup: number; cost: number; listPrice: number; off: number; price: number }>;
}
export function jobPricing(costItems: PricedItem[], groups?: PricedGroup[] | null, markupPct?: number): JobPricing;
export function markupOf(item: { groupId?: number | null }, groups?: PricedGroup[] | null, markupPct?: number, costItems?: PricedItem[]): number;
export const DISCOUNT_TYPES: Array<'percent' | 'baht'>;
/** what a heading's discount takes off a price of `listPrice`, in baht */
export function headingDiscount(group: { discountType?: 'percent' | 'baht'; discount?: number } | null | undefined, listPrice: number): number;
export function projectPrice(costItems: PricedItem[], markupPct: number, groups?: PricedGroup[] | null): number;
/** whole-baht amounts for `prices` that add up to `total`; null when `total` is not their sum to within rounding */
export function wholeBahtShares(prices: number[], total: number): number[] | null;
/** the lines of the quote that follows a job (one per heading, at the heading's selling price) and the price they come to; `price` is null for a job with no price yet */
export function quoteLinesFromJob(
  costItems: Array<PricedItem & { name?: string; unit?: string }>,
  groups?: PricedGroup[] | null,
  markupPct?: number,
  agreedPrice?: number | null,
): { price: number | null; lines: Array<{ description: string; quantity: number; unit: string; unitPrice: number; roundUp: boolean }> };
export function fitToPrice<T extends { quantity: number; unitPrice: number; roundUp?: boolean }>(items: T[], target: number, discountRate?: number, rounding?: Rounding): T[] | null;
