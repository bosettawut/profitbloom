import React, { forwardRef, useEffect, useRef, useState } from 'react';
import type { User } from '../lib/api';
import { brandLogo, brandName } from '../lib/brand';
import { lineAmount, quoteTotals, type Rounding, type VatMode } from '../../shared/quote-math.js';

export interface QuoteDocData {
  code: string;
  createdDate: string;
  validUntil: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientAddress?: string;
  clientTaxId?: string;
  clientBranch?: string;
  projectTitle: string;
  /** the customer's own reference, such as a purchase order number */
  referenceNo?: string;
  eventDate: string;
  /** days the customer has to pay after the event; 0 or missing = not stated */
  creditDays?: number;
  notes: string;
  taxRate: number;
  discountRate: number;
  /** withholding tax %, 0 or missing when the customer holds nothing back */
  whtRate?: number;
  vatMode: VatMode;
  rounding?: Rounding;
  items: Array<{ description: string; quantity: number; unit?: string; unitPrice: number; roundUp?: boolean }>;
}

/** what makes the sheet a receipt: its heading, the day the money came in and how, and the quote it was issued from */
export interface ReceiptDocInfo {
  /** "ใบเสร็จรับเงิน/ใบกำกับภาษี" (with VAT) or "ใบเสร็จรับเงิน" */
  title: string;
  paidDate: string;
  paymentMethodText: string;
  quoteCode: string;
  /** a cancelled receipt carries a stamp saying so */
  cancelled?: boolean;
}

interface QuoteDocumentProps {
  user: User;
  quote: QuoteDocData;
  /** set for a receipt: the same sheet as the quote, headed and signed as a receipt */
  receipt?: ReceiptDocInfo;
}

/** a unit price keeps its satang only when it has any */
const unitMoney = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 });
const thaiDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '-';

/**
 * The quote as the customer receives it: one A4-width sheet (794px = 210mm at 96dpi).
 * Used for the on-screen preview and rasterised as-is for the PDF. With `receipt` it is the receipt issued from the
 * quote: the same sheet, headed as a receipt, with how it was paid, and signed by whoever took the money.
 */
export const QuoteDocument = forwardRef<HTMLDivElement, QuoteDocumentProps>(function QuoteDocument({ user, quote, receipt }, ref) {
  const items = quote.items.filter((i) => i.description.trim() || i.quantity * i.unitPrice > 0);
  const { subtotal, discount, beforeVat, vat, total, rate, whtRate, withholding, payable } = quoteTotals({ ...quote, items });
  // amounts show their satang only when some amount on this quote has any
  const amounts = [subtotal, discount, vat, total, withholding, ...items.map((i) => lineAmount(i, quote.rounding))];
  const digits = amounts.some((n) => !Number.isInteger(n)) ? 2 : 0;
  const money = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const creditDays = quote.creditDays && quote.creditDays > 0 ? quote.creditDays : 0;
  /** payment falls due so many days after the event */
  const dueDate = creditDays && quote.eventDate ? new Date(Date.parse(quote.eventDate + 'T00:00:00Z') + creditDays * 864e5).toISOString().slice(0, 10) : '';

  return (
    // The sheet is a fixed size, so nothing in it may follow the size of the app's text: spacing utilities and the
    // base paragraph size are pinned here to what they are at a 16px root, whatever the screen it is made on.
    <div ref={ref} className="relative bg-white text-[#221A33]" style={{ width: 794, minHeight: 1123, padding: '56px 56px 48px', fontSize: 13, '--spacing': '4px', '--text-base': '16px' } as React.CSSProperties}>
      {receipt?.cancelled && (
        <div aria-label="ยกเลิกแล้ว" className="absolute pointer-events-none" style={{ top: 300, left: 0, right: 0, textAlign: 'center', transform: 'rotate(-18deg)' }}>
          <span style={{ display: 'inline-block', border: '5px solid rgba(225, 29, 72, 0.55)', color: 'rgba(225, 29, 72, 0.55)', borderRadius: 16, padding: '6px 36px', fontSize: 64, fontWeight: 800 }}>ยกเลิก</span>
        </div>
      )}
      {/* Seller + title */}
      <div className="flex justify-between items-start gap-8 pb-6 border-b-2 border-[#673AB7]">
        <div className="flex gap-4 items-start">
          <img src={brandLogo(user)} alt="" style={{ width: 64, height: 64, objectFit: 'contain' }} />
          <div style={{ maxWidth: 330 }}>
            <p style={{ fontSize: 18, fontWeight: 700 }}>{brandName(user)}</p>
            {user.businessAddress && <p className="text-[#5B566D] mt-1 leading-relaxed">{user.businessAddress}</p>}
            {user.businessPhone && <p className="text-[#5B566D]">โทร {user.businessPhone}</p>}
            {user.businessTaxId && <p className="text-[#5B566D]">เลขประจำตัวผู้เสียภาษี {user.businessTaxId}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p style={{ fontSize: receipt && receipt.title.length > 16 ? 20 : 24, fontWeight: 700, color: '#673AB7' }}>{receipt ? receipt.title : 'ใบเสนอราคา'}</p>
          <p className="text-[#5B566D] mb-3">{receipt ? (receipt.title.includes('ใบกำกับภาษี') ? 'Receipt / Tax Invoice' : 'Receipt') : 'Quotation'}</p>
          <table className="ml-auto text-left">
            <tbody>
              <tr><td className="pr-3 text-[#5B566D]">เลขที่</td><td style={{ fontWeight: 600 }}>{quote.code || 'ฉบับร่าง'}</td></tr>
              <tr><td className="pr-3 text-[#5B566D]">วันที่</td><td style={{ fontWeight: 600 }}>{quote.createdDate}</td></tr>
              {receipt ? (
                <tr><td className="pr-3 text-[#5B566D]">อ้างอิงใบเสนอราคา</td><td style={{ fontWeight: 600 }}>{receipt.quoteCode || '-'}</td></tr>
              ) : (
                <tr><td className="pr-3 text-[#5B566D]">ใช้ได้ถึง</td><td style={{ fontWeight: 600 }}>{thaiDate(quote.validUntil)}</td></tr>
              )}
              {quote.referenceNo && <tr><td className="pr-3 text-[#5B566D]">อ้างอิง</td><td style={{ fontWeight: 600 }}>{quote.referenceNo}</td></tr>}
              {!receipt && creditDays > 0 && <tr><td className="pr-3 text-[#5B566D]">เครดิต</td><td style={{ fontWeight: 600 }}>{creditDays} วัน</td></tr>}
              {!receipt && dueDate && <tr><td className="pr-3 text-[#5B566D]">ครบกำหนด</td><td style={{ fontWeight: 600 }}>{thaiDate(dueDate)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Customer + job */}
      <div className="grid grid-cols-2 gap-6 py-6">
        <div>
          <p className="text-[#5B566D] mb-1" style={{ fontWeight: 600 }}>{receipt ? 'ได้รับเงินจาก' : 'เสนอราคาให้'}</p>
          <p style={{ fontSize: 15, fontWeight: 700 }}>{quote.clientName || '-'}</p>
          {quote.clientAddress && <p className="text-[#5B566D] leading-relaxed whitespace-pre-line">{quote.clientAddress}</p>}
          {(quote.clientTaxId || quote.clientBranch) && (
            <p className="text-[#5B566D]">
              {quote.clientTaxId ? `เลขประจำตัวผู้เสียภาษี ${quote.clientTaxId}${quote.clientBranch ? ` (${quote.clientBranch})` : ''}` : quote.clientBranch}
            </p>
          )}
          {quote.clientPhone && <p className="text-[#5B566D]">โทร {quote.clientPhone}</p>}
          {quote.clientEmail && <p className="text-[#5B566D]">{quote.clientEmail}</p>}
        </div>
        <div>
          <p className="text-[#5B566D] mb-1" style={{ fontWeight: 600 }}>งาน</p>
          <p style={{ fontSize: 15, fontWeight: 700 }}>{quote.projectTitle || '-'}</p>
          {quote.eventDate && <p className="text-[#5B566D]">วันที่จัดงาน {thaiDate(quote.eventDate)}</p>}
        </div>
      </div>

      {/* Items */}
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#F4F1FB', color: '#35235e' }}>
            <th className="text-center py-2.5 px-2" style={{ width: 40, fontWeight: 600 }}>#</th>
            <th className="text-left py-2.5 px-2" style={{ fontWeight: 600 }}>รายการ</th>
            <th className="text-right py-2.5 px-2" style={{ width: 96, fontWeight: 600 }}>จำนวน</th>
            <th className="text-right py-2.5 px-2" style={{ width: 110, fontWeight: 600 }}>ราคาต่อหน่วย</th>
            <th className="text-right py-2.5 px-2" style={{ width: 120, fontWeight: 600 }}>จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr><td colSpan={5} className="text-center py-6 text-[#5B566D]">ยังไม่มีรายการ</td></tr>
          )}
          {items.map((item, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #ECEAF2' }}>
              <td className="text-center py-2.5 px-2 text-[#5B566D]">{i + 1}</td>
              <td className="py-2.5 px-2">{item.description || '-'}</td>
              <td className="text-right py-2.5 px-2">{item.quantity.toLocaleString('th-TH')}{item.unit?.trim() ? ` ${item.unit.trim()}` : ''}</td>
              <td className="text-right py-2.5 px-2">{unitMoney(item.unitPrice)}</td>
              <td className="text-right py-2.5 px-2" style={{ fontWeight: 600 }}>{money(lineAmount(item, quote.rounding))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals + notes */}
      <div className="flex justify-between gap-8 mt-6">
        <div className="flex-1">
          {receipt && (
            <div className="mb-4">
              <p className="text-[#5B566D] mb-1" style={{ fontWeight: 600 }}>การชำระเงิน</p>
              <p>ชำระโดย {receipt.paymentMethodText} · วันที่รับเงิน {thaiDate(receipt.paidDate)}</p>
            </div>
          )}
          {quote.notes && (
            <>
              <p className="text-[#5B566D] mb-1" style={{ fontWeight: 600 }}>หมายเหตุ</p>
              <p className="leading-relaxed whitespace-pre-line">{quote.notes}</p>
            </>
          )}
        </div>
        <table style={{ width: 280 }}>
          <tbody>
            <tr><td className="py-1 text-[#5B566D]">รวมเป็นเงิน</td><td className="py-1 text-right">{money(subtotal)}</td></tr>
            {quote.discountRate > 0 && (
              <tr><td className="py-1 text-[#5B566D]">ส่วนลด {quote.discountRate}%</td><td className="py-1 text-right">-{money(discount)}</td></tr>
            )}
            {rate > 0 && quote.vatMode === 'inclusive' && (
              <tr><td className="py-1 text-[#5B566D]">มูลค่าก่อนภาษี</td><td className="py-1 text-right">{money(beforeVat)}</td></tr>
            )}
            {rate > 0 && (
              <tr>
                <td className="py-1 text-[#5B566D]">ภาษีมูลค่าเพิ่ม {rate}%{quote.vatMode === 'inclusive' ? ' (รวมในราคาแล้ว)' : ''}</td>
                <td className="py-1 text-right">{money(vat)}</td>
              </tr>
            )}
            <tr style={{ borderTop: '2px solid #673AB7' }}>
              <td className="pt-2.5" style={{ fontSize: 15, fontWeight: 700 }}>ยอดรวมสุทธิ</td>
              <td className="pt-2.5 text-right" style={{ fontSize: 17, fontWeight: 700, color: '#673AB7' }}>฿{money(total)}</td>
            </tr>
            {withholding > 0 && (
              <>
                <tr><td className="pt-2 pb-1 text-[#5B566D]">หัก ณ ที่จ่าย {whtRate}%</td><td className="pt-2 pb-1 text-right">-{money(withholding)}</td></tr>
                <tr style={{ borderTop: '1px solid #ECEAF2' }}>
                  <td className="pt-2" style={{ fontWeight: 700 }}>ยอดชำระ</td>
                  <td className="pt-2 text-right" style={{ fontWeight: 700 }}>฿{money(payable)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Signatures */}
      <div className="grid grid-cols-2 gap-16 text-center" style={{ marginTop: 88 }}>
        {(receipt ? ['ผู้รับเงิน', 'ผู้จ่ายเงิน / ลูกค้า'] : ['ผู้เสนอราคา', 'ผู้อนุมัติ / ลูกค้า']).map((role) => (
          <div key={role}>
            <div style={{ borderBottom: '1px solid #BDB8CC', height: 40 }} />
            <p className="mt-2" style={{ fontWeight: 600 }}>{role}</p>
            <p className="text-[#5B566D] mt-1">วันที่ ......./......./.......</p>
          </div>
        ))}
      </div>
    </div>
  );
});

/** Shows an A4-width sheet shrunk to fit its container (for on-screen preview only, never for PDF capture). */
export function FitToWidth({ width = 794, children }: { width?: number; children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const s = Math.min(1, outer.current.clientWidth / width);
      setScale(s);
      setHeight(inner.current.offsetHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={outer} className="w-full" style={{ height }}>
      <div ref={inner} style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  );
}
