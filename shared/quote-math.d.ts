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
export function projectPrice(costItems: Array<{ quantity: number; price: number; isExtra?: boolean }>, markupPct: number): number;
export function fitToPrice<T extends { quantity: number; unitPrice: number }>(items: T[], target: number, discountRate?: number): T[] | null;
