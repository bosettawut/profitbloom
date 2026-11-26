import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Ban, Download, FileText, FolderOpen, X } from 'lucide-react';
import { api, baht, type Receipt, type User } from '../lib/api';
import { downloadPdf } from '../lib/pdf';
import { FitToWidth, QuoteDocument, type QuoteDocData, type ReceiptDocInfo } from './QuoteDocument';
import { statusPill, struck } from './ProjectItem';

/** what the sheet needs to print a receipt: the copy of its quote, and what makes it a receipt */
export const receiptDoc = (r: Receipt): { quote: QuoteDocData; receipt: ReceiptDocInfo } => ({
  quote: {
    code: r.code,
    createdDate: r.createdDate,
    validUntil: '',
    clientName: r.clientName,
    clientPhone: r.clientPhone,
    clientEmail: r.clientEmail,
    clientAddress: r.clientAddress,
    clientTaxId: r.clientTaxId,
    clientBranch: r.clientBranch,
    projectTitle: r.projectTitle,
    referenceNo: r.referenceNo,
    eventDate: r.eventDate,
    notes: r.notes,
    taxRate: r.taxRate,
    discountRate: r.discountRate,
    whtRate: r.whtRate,
    vatMode: r.vatMode,
    rounding: r.rounding,
    items: r.items,
  },
  receipt: { title: r.title, paidDate: r.paidDate, paymentMethodText: r.paymentMethodText, quoteCode: r.quoteCode, cancelled: r.status === 'cancelled' },
});

interface ReceiptPageProps {
  receiptId: string;
  user: User;
  onClose: () => void;
  onOpenQuote: (quoteId: string) => void;
  onOpenProject: (projectId: string) => void;
}

/**
 * One receipt: what was paid, by whom and how, and the sheet as it prints. It cannot be changed; it can be cancelled,
 * which cancels its quote too (the job then takes a new quote).
 */
export function ReceiptPage({ receiptId, user, onClose, onOpenQuote, onOpenProject }: ReceiptPageProps) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notification, setNotification] = useState('');
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stale = false;
    api.receipt(receiptId).then((r) => !stale && setReceipt(r)).catch((err) => !stale && setError((err as Error).message));
    return () => {
      stale = true;
    };
  }, [receiptId]);

  const flash = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3500);
  };

  if (error) return <div className="p-8 text-center text-ink">{error}</div>;
  if (!receipt) return <div className="p-8 text-center text-ink">กำลังโหลด...</div>;

  const cancelled = receipt.status === 'cancelled';
  const doc = receiptDoc(receipt);
  const money = (n: number) => baht(n, Number.isInteger(n) ? 0 : 2);
  const action = 'flex flex-col items-center gap-1.5 min-w-[4.5rem] px-2 py-2 rounded-2xl text-xs font-medium text-ink-muted hover:bg-[#F1F0F5] hover:text-ink transition-colors disabled:opacity-60';

  const exportPdf = async () => {
    flushSync(() => setExporting(true));
    try {
      if (docRef.current) await downloadPdf(docRef.current, `${receipt.code}${receipt.clientName ? '-' + receipt.clientName : ''}`);
    } catch {
      flash('สร้างไฟล์ PDF ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setExporting(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      setReceipt(await api.cancelReceipt(receipt.id));
      setConfirming(false);
      flash(`ยกเลิกใบเสร็จ ${receipt.code} แล้ว ใบเสนอราคา ${receipt.quoteCode} ถูกยกเลิกด้วย`);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: string) => (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="text-sm text-ink py-1">{value || '-'}</span>
    </div>
  );

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-2 md:mb-3">
        <div className="min-w-0">
          <h2 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight mb-1">
            {receipt.title} <span className={`text-[#673AB7] ${struck(receipt.status)}`}>{receipt.code}</span>
          </h2>
          <p className="text-sm text-ink-muted">
            ออกจากใบเสนอราคา {receipt.quoteCode}
            {receipt.projectCode ? ` · โปรเจ็กต์ ${receipt.projectCode}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`self-stretch inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium ${statusPill(receipt.status)}`}>{receipt.statusText}</span>
          <button onClick={onClose} className="pb-btn-secondary">
            <X className="w-4 h-4" />
            ปิดหน้าต่าง
          </button>
        </div>
      </div>

      {cancelled && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 mb-4 text-rose-700">
          <p className="font-semibold">ใบเสร็จนี้ถูกยกเลิกเมื่อ {receipt.cancelledDate}</p>
          <p className="text-sm mt-0.5">
            ใบเสนอราคา {receipt.quoteCode} ถูกยกเลิกด้วย{receipt.projectCode ? ` สร้างใบเสนอราคาใหม่ได้ที่โปรเจ็กต์ ${receipt.projectCode}` : ''}
          </p>
        </div>
      )}

      <div className="pb-card p-4 md:p-6 xl:p-8 mb-4 md:mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] gap-6 lg:gap-12">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-muted">ได้รับเงินจาก</p>
            <p className={`text-lg font-semibold text-ink mt-1 break-words ${struck(receipt.status)}`}>{receipt.clientName}</p>
            {receipt.clientAddress && <p className="text-sm text-ink-muted mt-1 whitespace-pre-line break-words">{receipt.clientAddress}</p>}
            {(receipt.clientTaxId || receipt.clientBranch) && (
              <p className="text-sm text-ink-muted">
                {receipt.clientTaxId ? `เลขประจำตัวผู้เสียภาษี ${receipt.clientTaxId}${receipt.clientBranch ? ` (${receipt.clientBranch})` : ''}` : receipt.clientBranch}
              </p>
            )}
            <p className="text-sm font-medium text-ink-muted mt-5">งาน</p>
            <p className={`text-base font-medium text-ink mt-1 break-words ${struck(receipt.status)}`}>{receipt.projectTitle || '-'}</p>
          </div>

          <div>
            <div className="flex flex-wrap lg:justify-end gap-1 -mx-2 mb-4">
              <button onClick={exportPdf} disabled={exporting} className={action}>
                <Download className="w-6 h-6" />
                {exporting ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
              </button>
              {receipt.quoteId && (
                <button onClick={() => onOpenQuote(receipt.quoteId!)} className={action}>
                  <FileText className="w-6 h-6" />
                  เปิดใบเสนอราคา
                </button>
              )}
              {receipt.projectId && (
                <button onClick={() => onOpenProject(receipt.projectId!)} className={action}>
                  <FolderOpen className="w-6 h-6" />
                  เปิดโปรเจ็กต์
                </button>
              )}
              {!cancelled && (
                <button onClick={() => setConfirming(true)} className={`${action} !text-rose-600 hover:!bg-rose-50`}>
                  <Ban className="w-6 h-6" />
                  ยกเลิกใบเสร็จ
                </button>
              )}
            </div>
            <p className="text-sm font-medium text-ink">{receipt.withholding > 0 ? 'ยอดรับชำระ (หลังหัก ณ ที่จ่าย)' : 'ยอดรับชำระ'}</p>
            <p className={`text-3xl md:text-4xl font-semibold text-[#673AB7] tracking-tight mt-1 mb-4 break-words ${struck(receipt.status)}`}>{money(receipt.payableAmount)}</p>
            <div className="space-y-1">
              {row('วันที่รับเงิน', receipt.paidDateText)}
              {row('วิธีรับเงิน', receipt.paymentMethodText)}
              {row('วันที่ออก', receipt.createdDate)}
            </div>
          </div>
        </div>
      </div>

      {/* the receipt as it prints */}
      <div className="rounded-[20px] bg-[#E9E7EF] p-3 md:p-8">
        <div className="shadow-soft-xl rounded-sm overflow-hidden max-w-[794px] mx-auto">
          <FitToWidth>
            <QuoteDocument user={user} {...doc} />
          </FitToWidth>
        </div>
      </div>

      {exporting && (
        <div aria-hidden className="fixed top-0 pointer-events-none" style={{ left: -10000 }}>
          <QuoteDocument ref={docRef} user={user} {...doc} />
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 bg-[#221A33]/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => !busy && setConfirming(false)}>
          <div role="dialog" aria-modal="true" aria-label="ยกเลิกใบเสร็จ" className="bg-white rounded-[24px] shadow-soft-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-ink mb-1">ยกเลิกใบเสร็จ {receipt.code}?</h3>
            <ul className="text-sm text-ink-muted mt-3 space-y-2 list-disc pl-5">
              <li>ใบเสร็จยังอยู่ เลขเดิม แต่เป็น "ยกเลิก" และชื่อมีเส้นขีดฆ่า</li>
              <li>ใบเสนอราคา {receipt.quoteCode} จะถูกยกเลิกด้วย{receipt.projectCode ? ` และหลุดจากโปรเจ็กต์ ${receipt.projectCode}` : ''}</li>
              {receipt.projectCode && <li>โปรเจ็กต์ {receipt.projectCode} กลับเป็น "ร่าง" แล้วสร้างใบเสนอราคาใหม่ที่โปรเจ็กต์นั้น</li>}
            </ul>
            <div className="flex flex-col sm:flex-row gap-2 justify-end mt-6">
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="pb-btn-secondary">ไม่ยกเลิก</button>
              <button type="button" onClick={cancel} disabled={busy} className="pb-btn-primary !bg-rose-600 hover:!bg-rose-700 disabled:opacity-60">
                {busy ? 'กำลังยกเลิก...' : 'ยกเลิกใบเสร็จ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {notification && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-ink text-white px-5 py-3 rounded-full shadow-soft-xl z-50 animate-toast text-sm">{notification}</div>
      )}
    </div>
  );
}
