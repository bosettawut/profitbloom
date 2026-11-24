import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Save, Eye, Download, Send, X, Lock, FolderPlus } from 'lucide-react';
import { api, baht, Project, QuoteStatus, Rounding, User, VatMode } from '../lib/api';
import { downloadPdf } from '../lib/pdf';
import { flushSync } from 'react-dom';
import { FitToWidth, QuoteDocument } from './QuoteDocument';
import { CustomerPicker } from './CustomerPicker';
import { useCustomerContactPrompt, type TypedContact } from './CustomerContactPrompt';
import { fitToPrice, lineAmount, markupOf, projectPrice, quoteTotals, toSatang, wholeBaht } from '../../shared/quote-math.js';

interface QuoteItem {
  id: number;
  description: string;
  quantity: number;
  /** what the line is counted in (ดอก, กำ, คน): free text, not used in any sum */
  unit?: string;
  unitPrice: number;
  total: number;
  /** round this line's amount up to a whole baht as soon as it has a fraction */
  roundUp?: boolean;
}

interface NewQuoteProps {
  user: User;
  quoteId: string | null;
  fromProject: Project | null;
  startInPreview: boolean;
  /** opens a job on its cost step */
  onOpenProjectCosts: (project: Project) => void;
  onDone: () => void;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function NewQuote({ user, quoteId, fromProject, startInPreview, onOpenProjectCosts, onDone }: NewQuoteProps) {
  const [savedId, setSavedId] = useState<string | null>(quoteId);
  const [quoteCode, setQuoteCode] = useState('');
  const [status, setStatus] = useState<QuoteStatus>('draft');
  const [projectId, setProjectId] = useState<string | null>(fromProject?.id ?? null);
  const [customerId, setCustomerId] = useState<string | null>(fromProject?.customerId ?? null);
  const [createdDate, setCreatedDate] = useState(new Date().toLocaleDateString('th-TH'));
  const [loading, setLoading] = useState(!!quoteId);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [quoteData, setQuoteData] = useState({
    clientName: fromProject?.client ?? '',
    clientPhone: fromProject?.phone ?? '',
    clientEmail: fromProject?.email ?? '',
    clientAddress: '',
    clientTaxId: '',
    clientBranch: '',
    projectTitle: fromProject?.title ?? '',
    referenceNo: '',
    eventDate: fromProject?.eventDate ?? '',
    validUntil: isoDate(new Date(Date.now() + 30 * 864e5)),
    creditDays: 0,
    notes: fromProject?.notes ?? '',
    internalNote: '',
  });

  // a quote made from a job is held to the job's price, so the profit worked out for the job stays true
  const [lockedPrice, setLockedPrice] = useState<number | null>(() => {
    const price = fromProject ? fromProject.agreedPrice ?? projectPrice(fromProject.costItems, fromProject.profitMargin, fromProject.costGroups) : 0;
    return price > 0 ? price : null;
  });
  // each line chooses whether its amount rounds up to a whole baht ('line'); a quote made before that
  // choice existed opens on the old rule ('baht') until the user switches it
  const [rounding, setRounding] = useState<Rounding>('line');
  // lines round up unless the job's price itself has satang, which whole-baht lines could never add up to
  const startRoundUp = lockedPrice === null || Number.isInteger(lockedPrice);

  // it lists each cost item at its selling price (cost + its heading's margin, less the heading's discount) in whole baht; rounding each
  // line can leave the sum a few baht off the job's price, so one line takes up the difference
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>(() => {
    if (!fromProject || !fromProject.costItems.some((i) => !i.isExtra)) return [{ id: 1, description: '', quantity: 1, unit: '', unitPrice: 0, total: 0, roundUp: true }];
    const lines = fromProject.costItems.filter((i) => !i.isExtra).map((item, idx) => {
      const unitPrice = wholeBaht(item.price * (1 + markupOf(item, fromProject.costGroups, fromProject.profitMargin, fromProject.costItems) / 100));
      return { id: idx + 1, description: item.name, quantity: item.quantity, unit: item.unit ?? '', unitPrice, total: 0, roundUp: startRoundUp };
    });
    const fitted = (lockedPrice !== null && fitToPrice(lines, lockedPrice, 0, rounding)) || lines;
    return fitted.map((i) => ({ ...i, total: lineAmount(i, rounding) }));
  });

  const [taxRate, setTaxRate] = useState(7);
  const [vatMode, setVatMode] = useState<VatMode>(user.vatMode);
  const [discountRate, setDiscountRate] = useState(0);
  // withholding tax: only some customers (companies paying for a service) hold it back, so it starts at none
  const [whtRate, setWhtRate] = useState(0);
  const [notification, setNotification] = useState('');
  const contactPrompt = useCustomerContactPrompt();
  /** the contact details this quote started with (from its project, or as last saved): unchanged, they are not asked about */
  const startContact = useRef<TypedContact | undefined>(
    fromProject ? { customerId: fromProject.customerId, name: fromProject.client, phone: fromProject.phone, email: fromProject.email } : undefined,
  );

  useEffect(() => {
    if (!quoteId) return;
    api.quote(quoteId)
      .then(q => {
        setQuoteCode(q.code);
        setStatus(q.status);
        setProjectId(q.projectId);
        setCustomerId(q.customerId);
        startContact.current = { customerId: q.customerId, name: q.clientName, phone: q.clientPhone, email: q.clientEmail };
        setCreatedDate(q.createdDate);
        setQuoteData({
          clientName: q.clientName,
          clientPhone: q.clientPhone,
          clientEmail: q.clientEmail,
          clientAddress: q.clientAddress ?? '',
          clientTaxId: q.clientTaxId ?? '',
          clientBranch: q.clientBranch ?? '',
          projectTitle: q.projectTitle,
          referenceNo: q.referenceNo ?? '',
          eventDate: q.eventDate,
          validUntil: q.validUntil,
          creditDays: q.creditDays ?? 0,
          notes: q.notes,
          internalNote: q.internalNote ?? '',
        });
        setQuoteItems(q.items.length ? q.items : [{ id: 1, description: '', quantity: 1, unit: '', unitPrice: 0, total: 0, roundUp: q.rounding !== 'baht' }]);
        setTaxRate(q.taxRate);
        setDiscountRate(q.discountRate);
        setWhtRate(q.whtRate);
        setVatMode(q.vatMode);
        setRounding(q.rounding === 'baht' ? 'baht' : 'line');
        setLockedPrice(q.lockedPrice);
        if (startInPreview) setShowPreview(true);
      })
      .catch(err => showNotification(err.message))
      .finally(() => setLoading(false));
  }, [quoteId, startInPreview]);

  useEffect(() => {
    // a quote made from a job: the job holds no address or tax id, so they come from the customer's record and last quote
    if (!fromProject?.customerId) return;
    let stale = false;
    api.customers()
      .then((all) => {
        const c = all.find((x) => x.id === fromProject.customerId);
        if (!c || stale) return;
        setQuoteData((d) => ({ ...d, clientAddress: d.clientAddress || c.address || c.quoteAddress || '', clientTaxId: d.clientTaxId || c.quoteTaxId || '', clientBranch: d.clientBranch || c.quoteBranch || '' }));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [fromProject?.customerId]);

  /** payment falls due so many days after the event */
  const dueDate = quoteData.creditDays > 0 && quoteData.eventDate ? new Date(Date.parse(quoteData.eventDate + 'T00:00:00Z') + quoteData.creditDays * 864e5) : null;

  const { subtotal, discount, afterDiscount, beforeVat, vat: tax, total: grandTotal, rate: vatRate, withholding, payable } = quoteTotals({ items: quoteItems, discountRate, taxRate, vatMode, rounding, whtRate });
  // show the satang only when some amount on this quote has any, so a whole-baht quote stays clean
  const showSatang = rounding !== 'baht' && [subtotal, discount, tax, grandTotal, withholding, ...quoteItems.map((i) => i.total)].some((n) => !Number.isInteger(n));
  const money = (n: number) => baht(n, showSatang ? 2 : 0);
  /** how far the lines are from the locked job price (0 = they match) */
  const lockGap = lockedPrice === null ? 0 : toSatang(afterDiscount - lockedPrice);

  const fitToLock = () => {
    if (lockedPrice === null) return;
    const fitted = fitToPrice(quoteItems, lockedPrice, discountRate, rounding);
    if (!fitted) return showNotification('ปรับอัตโนมัติไม่ได้กับส่วนลดนี้ ลองเปลี่ยนส่วนลดหรือแก้รายการเอง');
    setQuoteItems(fitted.map((i) => ({ ...i, total: lineAmount(i, rounding) })));
    showNotification('ปรับยอดรายการให้ตรงกับราคาที่ล็อกแล้ว');
  };

  /** moves a quote from the old whole-baht rule to choosing line by line, starting with every line rounding up */
  const chooseByLine = () => {
    setRounding('line');
    setQuoteItems((items) => items.map((i) => ({ ...i, roundUp: true })).map((i) => ({ ...i, total: lineAmount(i, 'line') })));
  };
  const setRoundUp = (id: number, roundUp: boolean) =>
    setQuoteItems((items) => items.map((i) => (i.id === id ? { ...i, roundUp, total: lineAmount({ ...i, roundUp }, rounding) } : i)));

  const updateQuoteItem = (id: number, field: string, value: string | number) => {
    setQuoteItems(items => items.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        if (field === 'quantity' || field === 'unitPrice') {
          updatedItem.total = lineAmount(updatedItem, rounding);
        }
        return updatedItem;
      }
      return item;
    }));
  };

  const addQuoteItem = () => {
    const newId = Math.max(0, ...quoteItems.map(item => item.id)) + 1;
    setQuoteItems([...quoteItems, {
      id: newId,
      description: '',
      quantity: 1,
      unit: '',
      unitPrice: 0,
      total: 0,
      roundUp: rounding === 'line',
    }]);
  };

  const removeQuoteItem = (id: number) => {
    setQuoteItems(items => items.filter(item => item.id !== id));
  };

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  const persist = async (nextStatus: QuoteStatus = status) => {
    if (!quoteData.clientName.trim()) {
      setShowPreview(false);
      showNotification('กรุณากรอกชื่อลูกค้า');
      return null;
    }
    if (lockGap !== 0) {
      setShowPreview(false);
      showNotification(`ยอดรายการยังไม่เท่าราคาที่ล็อกไว้ ${money(lockedPrice ?? 0)} กด "ปรับส่วนต่างอัตโนมัติ"`);
      return null;
    }
    const contact: TypedContact = { customerId, name: quoteData.clientName, phone: quoteData.clientPhone, email: quoteData.clientEmail };
    const updateCustomer = await contactPrompt.ask(contact, startContact.current);
    if (updateCustomer === null) return null;
    setSaving(true);
    try {
      const body = {
        ...quoteData,
        projectId,
        customerId,
        updateCustomer,
        taxRate,
        discountRate,
        whtRate,
        vatMode,
        rounding,
        status: nextStatus === 'expired' ? undefined : nextStatus,
        items: quoteItems
          .filter(item => item.description.trim() || item.total > 0)
          .map(({ description, quantity, unit, unitPrice, roundUp }) => ({ description, quantity, unit: unit ?? '', unitPrice, roundUp: !!roundUp })),
      };
      const saved = savedId ? await api.updateQuote(savedId, body) : await api.createQuote(body);
      setSavedId(saved.id);
      startContact.current = contact;
      setQuoteCode(saved.code);
      setStatus(saved.status);
      setLockedPrice(saved.lockedPrice);
      return saved;
    } catch (err) {
      showNotification((err as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const saved = await persist();
    if (saved) showNotification(`บันทึกใบเสนอราคา ${saved.code} เรียบร้อยแล้ว!`);
  };

  const handlePreview = () => {
    setShowPreview(true);
  };

  const docRef = useRef<HTMLDivElement>(null);
  const docData = { ...quoteData, code: quoteCode, createdDate, taxRate, discountRate, whtRate, vatMode, rounding, items: quoteItems };
  const [exporting, setExporting] = useState(false);

  /** Saves first so the PDF always carries a real quote number, then downloads it. */
  const exportPdf = async () => {
    const saved = await persist();
    if (!saved) return null;
    // render a full-size copy off-screen (with the saved number) and capture that
    flushSync(() => setExporting(true));
    try {
      if (docRef.current) await downloadPdf(docRef.current, `${saved.code}${saved.clientName ? '-' + saved.clientName : ''}`);
      return saved;
    } catch {
      showNotification('สร้างไฟล์ PDF ไม่สำเร็จ กรุณาลองใหม่');
      return null;
    } finally {
      setExporting(false);
    }
  };

  /** an approved quote that was written on its own becomes a job, and the costs get filled in there */
  const makeProject = async () => {
    const saved = await persist();
    if (!saved) return;
    try {
      onOpenProjectCosts(await api.createProjectFromQuote(saved.id));
    } catch (err) {
      showNotification((err as Error).message);
    }
  };

  const handleSend = async () => {
    if (!(await exportPdf())) return;
    const saved = await persist(status === 'approved' || status === 'rejected' ? status : 'sent');
    if (!saved) return;
    if (saved.clientEmail) {
      // open the user's mail app with the quote summary; there is no server-side email
      const subject = `ใบเสนอราคา ${saved.code} - ${saved.projectTitle || saved.clientName}`;
      const lines = [
        `เรียน ${saved.clientName}`,
        '',
        `ขอส่งใบเสนอราคา ${saved.code}${saved.projectTitle ? ` สำหรับ ${saved.projectTitle}` : ''}`,
        ...saved.items.map(i => `- ${i.description} x ${i.quantity}${i.unit ? ` ${i.unit}` : ''} = ${money(i.total)}`),
        '',
        `ยอดรวมสุทธิ ${money(saved.totalAmount)}`,
        ...(saved.withholding > 0 ? [`หัก ณ ที่จ่าย ${saved.whtRate}% ${money(saved.withholding)}`, `ยอดชำระ ${money(saved.payableAmount)}`] : []),
        saved.validUntilText ? `ใบเสนอราคานี้ใช้ได้ถึง ${saved.validUntilText}` : '',
        '',
        user.businessName || user.name,
      ];
      window.location.href = `mailto:${encodeURIComponent(saved.clientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
    }
    showNotification(`ดาวน์โหลด PDF แล้ว แนบไฟล์ในอีเมลเพื่อส่งให้ลูกค้า`);
  };

  const handleBack = () => {
    setShowPreview(false);
  };

  if (loading) return <div className="p-8 text-center text-ink">กำลังโหลด...</div>;

  /** a row of the money summary: what it is on the left, the amount on the right */
  const sumRow = (label: string, amount: string, tone = 'text-ink') => (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span className={`font-medium ${tone}`}>{amount}</span>
    </div>
  );
  /** a rate typed inside the summary, beside the amount it leads to */
  const rateBox = 'pb-input pb-input-sm !w-20 text-right';
  const action = 'flex flex-col items-center gap-1.5 min-w-[4.5rem] px-2 py-2 rounded-2xl text-xs font-medium text-ink-muted hover:bg-[#F1F0F5] hover:text-ink transition-colors disabled:opacity-60';

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      {/* Header: what this is and its number on the left; close and save on the right. On a desktop it stays in view while the form scrolls. */}
      <div className="md:sticky md:top-0 z-20 md:-mt-4 md:pt-4 pb-3 mb-2 md:mb-3 bg-[var(--sheet)] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl md:text-[28px] font-semibold text-ink tracking-tight mb-1">
            {savedId ? <>ใบเสนอราคา <span className="text-[#673AB7]">{quoteCode}</span></> : 'สร้างใบเสนอราคาใหม่'}
          </h2>
          <p className="text-sm text-ink-muted">
            {fromProject ? `สร้างจากโปรเจ็กต์ ${fromProject.code} (ราคาต่อหน่วยรวมกำไรแล้ว)` : savedId ? 'แก้ไขรายละเอียดแล้วกดบันทึก' : 'สร้างใบเสนอราคาสำหรับลูกค้า'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onDone} className="pb-btn-secondary">
            <X className="w-4 h-4" />
            ปิดหน้าต่าง
          </button>
          <button onClick={handleSave} disabled={saving} className="pb-btn-primary !hidden md:!inline-flex md:min-w-[12rem] disabled:opacity-60">
            <Save className="w-4 h-4" />
            {saving ? 'กำลังบันทึก...' : 'บันทึกใบเสนอราคา'}
          </button>
        </div>
      </div>

      <div className="pb-card p-4 md:p-6 xl:p-8">
        {/* the customer on the left; the total, what can be done with the quote and its dates on the right */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] gap-6 lg:gap-12">
          <div role="group" aria-label="ข้อมูลลูกค้า" className="space-y-4">
            <div>
              <label className="pb-label">ชื่อลูกค้า *</label>
              <CustomerPicker
                value={quoteData.clientName}
                placeholder="เช่น คุณสมชาย"
                onChange={(clientName) => {
                  setCustomerId(null);
                  setQuoteData({ ...quoteData, clientName });
                }}
                onPick={(c) => {
                  setCustomerId(c.id);
                  setQuoteData({
                    ...quoteData,
                    clientName: c.name,
                    clientPhone: c.phone,
                    clientEmail: c.email,
                    // what the customer's record or last quote carried; what is already typed stays when they have none
                    clientAddress: c.address || c.quoteAddress || quoteData.clientAddress,
                    clientTaxId: c.quoteTaxId || quoteData.clientTaxId,
                    clientBranch: c.quoteBranch || quoteData.clientBranch,
                  });
                }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="pb-label">เบอร์โทรศัพท์</label>
                <input
                  type="tel"
                  value={quoteData.clientPhone}
                  onChange={(e) => setQuoteData({ ...quoteData, clientPhone: e.target.value })}
                  className="pb-input"
                  placeholder="เช่น 081-234-5678"
                />
              </div>
              <div>
                <label className="pb-label">อีเมล</label>
                <input
                  type="email"
                  value={quoteData.clientEmail}
                  onChange={(e) => setQuoteData({ ...quoteData, clientEmail: e.target.value })}
                  className="pb-input"
                  placeholder="เช่น customer@email.com"
                />
              </div>
            </div>
            <div>
              <label className="pb-label">ที่อยู่ลูกค้า</label>
              <textarea
                value={quoteData.clientAddress}
                onChange={(e) => setQuoteData({ ...quoteData, clientAddress: e.target.value })}
                className="pb-input"
                rows={2}
                maxLength={500}
                placeholder="เช่น 99/1 ถ.สุขุมวิท แขวงคลองตัน เขตคลองเตย กรุงเทพฯ 10110"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="pb-label">เลขประจำตัวผู้เสียภาษี</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={quoteData.clientTaxId}
                  onChange={(e) => setQuoteData({ ...quoteData, clientTaxId: e.target.value })}
                  className="pb-input"
                  maxLength={20}
                  placeholder="เช่น 0105551234567"
                />
              </div>
              <div>
                <label className="pb-label">สำนักงาน/สาขา</label>
                <input
                  type="text"
                  value={quoteData.clientBranch}
                  onChange={(e) => setQuoteData({ ...quoteData, clientBranch: e.target.value })}
                  className="pb-input"
                  maxLength={60}
                  placeholder="เช่น สำนักงานใหญ่"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex flex-wrap lg:justify-end gap-1 -mx-2 mb-4">
              <button onClick={handlePreview} className={action}>
                <Eye className="w-6 h-6" />
                ดูตัวอย่าง
              </button>
              <button onClick={exportPdf} disabled={saving || exporting} className={action}>
                <Download className="w-6 h-6" />
                {exporting ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
              </button>
              {savedId && status === 'approved' && !projectId && (
                <button onClick={makeProject} disabled={saving} className={action}>
                  <FolderPlus className="w-6 h-6" />
                  สร้างโปรเจ็กต์และใส่ต้นทุน
                </button>
              )}
            </div>
            <p className="text-sm font-medium text-ink">จำนวนเงินรวมทั้งสิ้น</p>
            <p className="text-3xl md:text-4xl font-semibold text-[#673AB7] tracking-tight mt-1 mb-4 break-words">{money(grandTotal)}</p>
            <div className="space-y-2">
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
                <span className="text-sm font-medium text-ink">วันที่สร้าง</span>
                <span className="text-sm text-ink py-2 px-[0.95rem]">{createdDate}</span>
              </div>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
                <label className="text-sm font-medium text-ink">ใบเสนอราคาใช้ได้ถึง</label>
                <input
                  type="date"
                  value={quoteData.validUntil}
                  onChange={(e) => setQuoteData({ ...quoteData, validUntil: e.target.value })}
                  className="pb-input pb-input-sm"
                />
              </div>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
                <label className="text-sm font-medium text-ink">วันที่จัดงาน</label>
                <input
                  type="date"
                  value={quoteData.eventDate}
                  onChange={(e) => setQuoteData({ ...quoteData, eventDate: e.target.value })}
                  className="pb-input pb-input-sm"
                />
              </div>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
                <label className="text-sm font-medium text-ink">เครดิต (วัน)</label>
                <input
                  type="number"
                  min="0"
                  max="365"
                  inputMode="numeric"
                  value={quoteData.creditDays || ''}
                  placeholder="0"
                  onChange={(e) => setQuoteData({ ...quoteData, creditDays: Math.min(365, Math.max(0, Math.round(parseFloat(e.target.value) || 0))) })}
                  className="pb-input pb-input-sm"
                />
              </div>
              {quoteData.creditDays > 0 && (
                <p role="note" className="text-xs text-ink-muted text-right">
                  {dueDate ? `ครบกำหนดชำระ ${dueDate.toLocaleDateString('th-TH')} (${quoteData.creditDays} วันหลังวันจัดงาน)` : 'ใส่วันที่จัดงาน ระบบจะคิดวันครบกำหนดชำระให้'}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-line my-6" />

        {/* what the quote is for, and whether its prices carry VAT */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_minmax(0,18rem)] gap-4">
          <div className="md:col-span-2 xl:col-span-1">
            <label className="pb-label">ชื่อโปรเจ็กต์</label>
            <input
              type="text"
              value={quoteData.projectTitle}
              onChange={(e) => setQuoteData({ ...quoteData, projectTitle: e.target.value })}
              className="pb-input"
              placeholder="เช่น งานแต่งงาน"
            />
          </div>
          <div>
            <label className="pb-label">เลขที่อ้างอิง</label>
            <input
              type="text"
              value={quoteData.referenceNo}
              onChange={(e) => setQuoteData({ ...quoteData, referenceNo: e.target.value })}
              className="pb-input"
              maxLength={60}
              placeholder="เช่น PO-2026-015"
            />
          </div>
          <div>
            <label className="pb-label">ภาษีมูลค่าเพิ่ม (VAT)</label>
            <select className="pb-input" value={vatMode} onChange={(e) => setVatMode(e.target.value as VatMode)}>
              <option value="exclusive">บวก VAT เพิ่มจากราคา</option>
              <option value="inclusive">ราคารวม VAT แล้ว (ถอด VAT)</option>
              <option value="none">ไม่มี VAT</option>
            </select>
          </div>
        </div>

        {/* Quote items */}
        <div role="group" aria-label="รายการใบเสนอราคา" className="mt-6">
          {/* Cards: phones, tablets and small laptops */}
          <div className="block xl:hidden space-y-4">
            {quoteItems.map((item, index) => (
              <div key={item.id} className="bg-gray-50 p-4 rounded-lg border">
                <div className="space-y-3">
                  <div>
                    <label className="pb-label">{index + 1}. รายละเอียด</label>
                    <input
                      type="text"
                      value={item.description}
                      onChange={(e) => updateQuoteItem(item.id, 'description', e.target.value)}
                      className="w-full px-3 py-2 border border-line rounded-lg text-sm"
                      placeholder="รายละเอียดสินค้า/บริการ"
                    />
                  </div>
                  <div className="grid grid-cols-[2.6fr_3fr_3.6fr] gap-2">
                    <div>
                      <label className="pb-label">จำนวน</label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateQuoteItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-line rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="pb-label">หน่วย</label>
                      <input
                        type="text"
                        value={item.unit ?? ''}
                        maxLength={30}
                        onChange={(e) => updateQuoteItem(item.id, 'unit', e.target.value)}
                        className="w-full px-3 py-2 border border-line rounded-lg text-sm"
                        placeholder="เช่น ดอก"
                      />
                    </div>
                    <div>
                      <label className="pb-label">ราคา/หน่วย</label>
                      <input
                        type="number"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateQuoteItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-line rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  {rounding === 'line' && (
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={!!item.roundUp}
                        onChange={(e) => setRoundUp(item.id, e.target.checked)}
                        className="w-4 h-4 accent-[#673AB7]"
                      />
                      ปัดขึ้นเป็นบาทเต็ม
                    </label>
                  )}
                  <div className="flex justify-between items-center">
                    <div>
                      <span className="text-xs text-ink-muted">รวม: </span>
                      <span className="font-medium text-ink">
                        {money(item.total)}
                      </span>
                    </div>
                    <button
                      onClick={() => removeQuoteItem(item.id)}
                      className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Table: wide screens */}
          <div className="hidden xl:block overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[44rem] table-fixed">
              <colgroup>
                <col className="w-14" />
                <col />
                <col className="w-20" />
                <col className="w-24" />
                <col className="w-28" />
                {rounding === 'line' && <col className="w-12" />}
                <col className="w-32" />
                <col className="w-11" />
              </colgroup>
              <thead>
                <tr className="bg-[#673AB7] text-white text-sm">
                  <th className="text-center px-1 py-3 font-medium">ลำดับ</th>
                  <th className="text-left px-3 py-3 font-medium">รายละเอียด</th>
                  <th className="text-right px-3 py-3 font-medium">จำนวน</th>
                  <th className="text-left px-3 py-3 font-medium">หน่วย</th>
                  <th className="text-right px-3 py-3 font-medium whitespace-nowrap">ราคา/หน่วย</th>
                  {rounding === 'line' && <th className="text-center px-1 py-3 font-medium" title="ปัดยอดของรายการขึ้นเป็นบาทเต็มเมื่อมีเศษ">ปัด</th>}
                  <th className="text-right px-3 py-3 font-medium">รวม</th>
                  <th className="px-3 py-3"><span className="sr-only">ลบรายการ</span></th>
                </tr>
              </thead>
              <tbody>
                {quoteItems.map((item, index) => (
                  <tr key={item.id} className="border-t border-line hover:bg-canvas/60">
                    <td className="px-1 py-3 text-center text-ink-muted">{index + 1}</td>
                    <td className="px-2 py-3">
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateQuoteItem(item.id, 'description', e.target.value)}
                        className="pb-input pb-input-sm"
                        placeholder="รายละเอียดสินค้า/บริการ"
                      />
                    </td>
                    <td className="px-2 py-3">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateQuoteItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                        className="pb-input pb-input-sm text-right !px-2.5"
                      />
                    </td>
                    <td className="px-2 py-3">
                      <input
                        type="text"
                        value={item.unit ?? ''}
                        maxLength={30}
                        onChange={(e) => updateQuoteItem(item.id, 'unit', e.target.value)}
                        aria-label="หน่วย"
                        className="pb-input pb-input-sm !px-2.5"
                        placeholder="เช่น ดอก"
                      />
                    </td>
                    <td className="px-2 py-3">
                      <input
                        type="number"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => updateQuoteItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="pb-input pb-input-sm text-right !px-2.5"
                      />
                    </td>
                    {rounding === 'line' && (
                      <td className="px-1 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={!!item.roundUp}
                          onChange={(e) => setRoundUp(item.id, e.target.checked)}
                          aria-label="ปัดขึ้นเป็นบาทเต็ม"
                          title="ปัดยอดของรายการนี้ขึ้นเป็นบาทเต็มเมื่อมีเศษ"
                          className="w-4 h-4 align-middle accent-[#673AB7] cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <span className="text-ink font-medium">
                        {money(item.total)}
                      </span>
                    </td>
                    <td className="px-1 py-3 text-center">
                      <button
                        onClick={() => removeQuoteItem(item.id)}
                        aria-label="ลบรายการ"
                        title="ลบรายการ"
                        className="p-2 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button onClick={addQuoteItem} className="pb-btn-secondary !py-2 w-full xl:w-auto mt-4">
            <Plus className="w-4 h-4" />
            เพิ่มรายการ
          </button>
          {rounding === 'line' ? (
            <p className="text-xs text-ink-muted mt-3">รายการที่ติ๊ก "ปัด" จะปัดยอดขึ้นเป็นบาทเต็มทันทีที่มีเศษ เช่น 99.01 เป็น 100 รายการที่ไม่ติ๊กคิดถึงสตางค์</p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#F7F6FA] px-3 py-3 mt-3">
              <p className="text-xs text-ink-muted">ใบนี้ใช้การปัดแบบเดิม: ทุกยอดปัดเป็นบาทเต็ม (ตั้งแต่ 50 สตางค์ปัดขึ้น)</p>
              <button type="button" onClick={chooseByLine} className="pb-btn-secondary !py-2 text-sm">เลือกปัดทีละรายการ</button>
            </div>
          )}
        </div>

        {/* the note on the left; discount, VAT, the total and withholding on the right */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-6 lg:gap-12 mt-6">
          <div className="space-y-4">
            <div>
              <label className="pb-label">หมายเหตุ</label>
              <textarea
                value={quoteData.notes}
                onChange={(e) => setQuoteData({ ...quoteData, notes: e.target.value })}
                className="pb-input"
                rows={4}
                placeholder="เช่น ราคารวมค่าขนส่งและติดตั้ง"
              />
            </div>
            <div>
              <label className="pb-label">โน้ตภายใน (ไม่แสดงในใบเสนอราคา)</label>
              <textarea
                value={quoteData.internalNote}
                onChange={(e) => setQuoteData({ ...quoteData, internalNote: e.target.value })}
                className="pb-input"
                rows={2}
                maxLength={2000}
                placeholder="เช่น ลูกค้าขอส่วนลดเพิ่มถ้าจองภายในสิ้นเดือน"
              />
            </div>
          </div>

          <div role="group" aria-label="สรุปการเงิน" className="space-y-3 text-sm md:text-base">
            {sumRow('ยอดรวม', money(subtotal))}

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="text-ink-muted">ส่วนลด (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={discountRate}
                  onChange={(e) => setDiscountRate(parseFloat(e.target.value) || 0)}
                  className={rateBox}
                />
              </div>
              <span className={`font-medium ${discount > 0 ? 'text-red-600' : 'text-ink'}`}>{discount > 0 ? '-' : ''}{money(discount)}</span>
            </div>

            {sumRow('ยอดหลังหักส่วนลด', money(afterDiscount))}
            {vatRate > 0 && vatMode === 'inclusive' && sumRow('มูลค่าก่อน VAT', money(beforeVat))}

            {vatMode !== 'none' && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-ink-muted">อัตรา VAT (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={taxRate}
                    onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                    className={rateBox}
                  />
                  {vatMode === 'inclusive' && <span className="text-xs text-ink-muted">รวมในราคาแล้ว</span>}
                </div>
                <span className="font-medium text-amber-600">{money(tax)}</span>
              </div>
            )}

            <div className="flex justify-between pt-3 border-t border-line text-base md:text-lg font-medium">
              <span className="text-ink">ยอดรวมสุทธิ</span>
              <span className="text-ink">{money(grandTotal)}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <label className="text-ink-muted">หัก ณ ที่จ่าย (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={whtRate}
                  onChange={(e) => setWhtRate(Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                  className={rateBox}
                />
              </div>
              <span className={`font-medium ${withholding > 0 ? 'text-rose-600' : 'text-ink'}`}>{withholding > 0 ? '-' : ''}{money(withholding)}</span>
            </div>

            {whtRate > 0 && (
              <div className="flex justify-between pt-3 border-t border-line text-base md:text-lg font-medium">
                <span className="text-ink">ยอดชำระ</span>
                <span className="text-ink">{money(payable)}</span>
              </div>
            )}

            <div>
              <p className="text-xs text-ink-muted">หัก ณ ที่จ่าย: ใส่ 0 ถ้าลูกค้าไม่หัก ค่าบริการทั่วไปหัก 3% คิดจากยอดก่อน VAT</p>
              {rounding !== 'baht' && <p className="text-xs text-ink-muted mt-1">ส่วนลด VAT และหัก ณ ที่จ่าย คิดถึงสตางค์ ไม่ปัดเศษ</p>}
            </div>

            {lockedPrice !== null && (
              <div className="rounded-xl bg-[#F7F6FA] px-3 py-3">
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Lock className="w-4 h-4 text-[#673AB7] shrink-0" />
                  ราคาโปรเจ็กต์ที่ล็อกไว้ {money(lockedPrice)}
                </p>
                {lockGap === 0 ? (
                  <p className="text-xs text-emerald-600 mt-1">ยอดรายการหลังหักส่วนลดตรงกับราคาที่ล็อก</p>
                ) : (
                  <>
                    <p className="text-xs text-rose-600 mt-1">
                      ยอดรายการหลังหักส่วนลด {money(afterDiscount)} {lockGap > 0 ? 'เกิน' : 'ขาด'}อยู่ {money(Math.abs(lockGap))} ต้องเท่าราคาที่ล็อกจึงจะบันทึกได้
                    </p>
                    <button onClick={fitToLock} className="pb-btn-secondary !py-2 w-full mt-3 !bg-white">
                      ปรับส่วนต่างอัตโนมัติ
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* on a phone the save button sits at the end of the form, where the thumb is */}
      <button onClick={handleSave} disabled={saving} className="pb-btn-primary w-full mt-5 md:!hidden disabled:opacity-60">
        <Save className="w-4 h-4" />
        {saving ? 'กำลังบันทึก...' : 'บันทึกใบเสนอราคา'}
      </button>

      {/* Notification */}
      {contactPrompt.node}
      {notification && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-ink text-white px-5 py-3 rounded-full shadow-soft-xl z-50 animate-toast text-sm">
          {notification}
        </div>
      )}

      {/* Preview: exactly what goes into the PDF */}
      {showPreview && (
        <div className="fixed inset-0 bg-[#221A33]/40 backdrop-blur-[2px] z-50 flex flex-col items-center p-3 md:p-6" onClick={handleBack}>
          <div className="w-full max-w-[860px] flex items-center justify-between gap-3 mb-3" onClick={(e) => e.stopPropagation()}>
            <button onClick={handleBack} className="pb-btn-secondary !bg-white" aria-label="ปิดตัวอย่าง">
              <X className="w-4 h-4" />
              <span className="hidden sm:inline">ปิด</span>
            </button>
            <div className="flex gap-2">
              <button onClick={exportPdf} disabled={saving || exporting} className="pb-btn-secondary !bg-white disabled:opacity-60">
                <Download className="w-4 h-4" />
                {exporting ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
              </button>
              <button onClick={handleSend} disabled={saving || exporting} className="pb-btn-primary disabled:opacity-60">
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">ส่งใบเสนอราคา</span>
              </button>
            </div>
          </div>
          <div className="w-full max-w-[860px] flex-1 overflow-y-auto rounded-[20px] bg-[#E9E7EF] p-3 md:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="shadow-soft-xl rounded-sm overflow-hidden">
              <FitToWidth>
                <QuoteDocument user={user} quote={docData} />
              </FitToWidth>
            </div>
          </div>
        </div>
      )}

      {exporting && (
        <div aria-hidden className="fixed top-0 pointer-events-none" style={{ left: -10000 }}>
          <QuoteDocument ref={docRef} user={user} quote={docData} />
        </div>
      )}
    </div>
  );
}