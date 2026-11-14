export type VatMode = 'exclusive' | 'inclusive' | 'none';
export const VAT_MODES: VatMode[];
export function wholeBaht(n: number): number;
export function lineAmount(item: { quantity: number; unitPrice: number }): number;
export interface QuoteTotals {
  subtotal: number;
  discount: number;
  afterDiscount: number;
  beforeVat: number;
  vat: number;
  total: number;
  /** the VAT % actually applied (0 when the quote has no VAT) */
  rate: number;
}
export function quoteTotals(q: {
  items: Array<{ quantity: number; unitPrice: number }>;
  discountRate?: number;
  taxRate?: number;
  vatMode?: VatMode;
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
}
export interface JobPricing {
  cost: number;
  price: number;
  headings: Array<PricedGroup & { cost: number; price: number }>;
}
export function jobPricing(costItems: PricedItem[], groups?: PricedGroup[] | null, markupPct?: number): JobPricing;
export function markupOf(item: { groupId?: number | null }, groups?: PricedGroup[] | null, markupPct?: number): number;
export function projectPrice(costItems: PricedItem[], markupPct: number, groups?: PricedGroup[] | null): number;
export function fitToPrice<T extends { quantity: number; unitPrice: number }>(items: T[], target: number, discountRate?: number): T[] | null;
