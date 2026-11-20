import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Save, Eye, FileText, Calculator, ArrowLeft, Download, Send, X, Phone, Mail, Calendar, MapPin, Lock, FolderPlus } from 'lucide-react';
import { api, Project, QuoteStatus, User, VatMode } from '../lib/api';
import { downloadPdf } from '../lib/pdf';
import { flushSync } from 'react-dom';
import { FitToWidth, QuoteDocument } from './QuoteDocument';
import { CustomerPicker } from './CustomerPicker';
import { useCustomerContactPrompt, type TypedContact } from './CustomerContactPrompt';
import { fitToPrice, lineAmount, markupOf, projectPrice, quoteTotals, wholeBaht } from '../../shared/quote-math.js';

interface QuoteItem {
  id: number;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
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
/** every amount on a quote is whole baht */
const money = (n: number) => `฿${n.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`;

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
    projectTitle: fromProject?.title ?? '',
    eventDate: fromProject?.eventDate ?? '',
    validUntil: isoDate(new Date(Date.now() + 30 * 864e5)),
    notes: fromProject?.notes ?? ''
  });

  // a quote made from a job is held to the job's price, so the profit worked out for the job stays true
  const [lockedPrice, setLockedPrice] = useState<number | null>(() => {
    const price = fromProject ? projectPrice(fromProject.costItems, fromProject.profitMargin, fromProject.costGroups) : 0;
    return price > 0 ? price : null;
  });

  // it lists each cost item at its selling price (cost + its heading's margin) in whole baht; rounding each
  // line can leave the sum a few baht off the job's price, so one line takes up the difference
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>(() => {
    if (!fromProject || !fromProject.costItems.some((i) => !i.isExtra)) return [{ id: 1, description: '', quantity: 1, unitPrice: 0, total: 0 }];
    const lines = fromProject.costItems.filter((i) => !i.isExtra).map((item, idx) => {
      const unitPrice = wholeBaht(item.price * (1 + markupOf(item, fromProject.costGroups, fromProject.profitMargin) / 100));
      return { id: idx + 1, description: item.name, quantity: item.quantity, unitPrice, total: 0 };
    });
    const fitted = (lockedPrice !== null && fitToPrice(lines, lockedPrice)) || lines;
    return fitted.map((i) => ({ ...i, total: lineAmount(i) }));
  });

  const [taxRate, setTaxRate] = useState(7);
  const [vatMode, setVatMode] = useState<VatMode>(user.vatMode);
  const [discountRate, setDiscountRate] = useState(0);
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
          projectTitle: q.projectTitle,
          eventDate: q.eventDate,
          validUntil: q.validUntil,
          notes: q.notes
        });
        setQuoteItems(q.items.length ? q.items : [{ id: 1, description: '', quantity: 1, unitPrice: 0, total: 0 }]);
        setTaxRate(q.taxRate);
        setDiscountRate(q.discountRate);
        setVatMode(q.vatMode);
        setLockedPrice(q.lockedPrice);
        if (startInPreview) setShowPreview(true);
      })
      .catch(err => showNotification(err.message))
      .finally(() => setLoading(false));
  }, [quoteId, startInPreview]);

  const { subtotal, discount, afterDiscount, beforeVat, vat: tax, total: grandTotal, rate: vatRate } = quoteTotals({ items: quoteItems, discountRate, taxRate, vatMode });
  /** how far the lines are from the locked job price (0 = they match) */
  const lockGap = lockedPrice === null ? 0 : afterDiscount - lockedPrice;

  const fitToLock = () => {
    if (lockedPrice === null) return;
    const fitted = fitToPrice(quoteItems, lockedPrice, discountRate);
    if (!fitted) return showNotification('ปรับอัตโนมัติไม่ได้กับส่วนลดนี้ ลองเปลี่ยนส่วนลดหรือแก้รายการเอง');
    setQuoteItems(fitted.map((i) => ({ ...i, total: lineAmount(i) })));
    showNotification('ปรับยอดรายการให้ตรงกับราคาที่ล็อกแล้ว');
  };

  const updateQuoteItem = (id: number, field: string, value: string | number) => {
    setQuoteItems(items => items.map(item => {
      if (item.id === id) {
        const updatedItem = { ...item, [field]: value };
        if (field === 'quantity' || field === 'unitPrice') {
          updatedItem.total = lineAmount(updatedItem);
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
      unitPrice: 0,
      total: 0
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
        vatMode,
        status: nextStatus === 'expired' ? undefined : nextStatus,
        items: quoteItems
          .filter(item => item.description.trim() || item.total > 0)
          .map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
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
  const docData = { ...quoteData, code: quoteCode, createdDate, taxRate, discountRate, vatMode, items: quoteItems };
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
        ...saved.items.map(i => `- ${i.description} x ${i.quantity} = ${money(i.total)}`),
        '',
        `ยอดรวมสุทธิ ${money(saved.totalAmount)}`,
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

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <button onClick={onDone} className="flex items-center gap-2 text-sm text-ink hover:text-ink-muted mb-3">
          <ArrowLeft className="w-4 h-4" /> ใบเสนอราคาทั้งหมด
        </button>
        <h2 className="text-2xl md:text-[28px] font-semibold text-ink tracking-tight mb-1">{savedId ? `ใบเสนอราคา ${quoteCode}` : 'สร้างใบเสนอราคาใหม่'}</h2>
        <p className="text-sm text-ink-muted">
          {fromProject ? `สร้างจากโปรเจ็กต์ ${fromProject.code} (ราคาต่อหน่วยรวมกำไรแล้ว)` : savedId ? 'แก้ไขรายละเอียดแล้วกดบันทึก' : 'สร้างใบเสนอราคาสำหรับลูกค้า'}
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="xl:col-span-2 space-y-6">
          {/* Client Information */}
          <div className="pb-card p-4 md:p-6">
            <h3 className="text-base md:text-lg text-ink mb-4 md:mb-6 font-semibold">ข้อมูลลูกค้า</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
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
                    setQuoteData({ ...quoteData, clientName: c.name, clientPhone: c.phone, clientEmail: c.email });
                  }}
                />
              </div>

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

              <div>
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
                <label className="pb-label">วันที่จัดงาน</label>
                <input
                  type="date"
                  value={quoteData.eventDate}
                  onChange={(e) => setQuoteData({ ...quoteData, eventDate: e.target.value })}
                  className="pb-input"
                />
              </div>

              <div>
                <label className="pb-label">ใบเสนอราคาใช้ได้ถึง</label>
                <input
                  type="date"
                  value={quoteData.validUntil}
                  onChange={(e) => setQuoteData({ ...quoteData, validUntil: e.target.value })}
                  className="pb-input"
                />
              </div>

              <div className="md:col-span-2">
                <label className="pb-label">หมายเหตุ</label>
                <textarea
                  value={quoteData.notes}
                  onChange={(e) => setQuoteData({ ...quoteData, notes: e.target.value })}
                  className="pb-input"
                  rows={3}
                  placeholder="เช่น ราคารวมค่าขนส่งและติดตั้ง"
                />
              </div>
            </div>
          </div>

          {/* Quote Items */}
          <div className="pb-card p-4 md:p-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 md:mb-6 gap-4">
              <h3 className="text-base md:text-lg text-ink font-semibold">รายการใบเสนอราคา</h3>
              <button
                onClick={addQuoteItem}
                className="flex items-center gap-2 px-4 py-2 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors text-sm md:text-base w-full md:w-auto justify-center"
              >
                <Plus className="w-4 h-4" />
                เพิ่มรายการ
              </button>
            </div>

            {/* Mobile View - Cards */}
            <div className="block md:hidden space-y-4">
              {quoteItems.map((item) => (
                <div key={item.id} className="bg-gray-50 p-4 rounded-lg border">
                  <div className="space-y-3">
                    <div>
                      <label className="pb-label">รายละเอียด</label>
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateQuoteItem(item.id, 'description', e.target.value)}
                        className="w-full px-3 py-2 border border-line rounded-lg text-sm"
                        placeholder="รายละเอียดสินค้า/บริการ"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
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

            {/* Desktop View - Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[34rem] table-fixed">
                <colgroup>
                  <col />
                  <col className="w-[5.5rem]" />
                  <col className="w-32" />
                  <col className="w-[8.5rem]" />
                  <col className="w-14" />
                </colgroup>
                <thead>
                  <tr className="bg-canvas/60 border-b border-line">
                    <th className="text-left px-3 py-4 text-ink font-medium">รายละเอียด</th>
                    <th className="text-right px-3 py-4 text-ink font-medium">จำนวน</th>
                    <th className="text-right px-3 py-4 text-ink font-medium whitespace-nowrap">ราคา/หน่วย</th>
                    <th className="text-right px-3 py-4 text-ink font-medium">รวม</th>
                    <th className="px-3 py-4"><span className="sr-only">ลบรายการ</span></th>
                  </tr>
                </thead>
                <tbody>
                  {quoteItems.map((item) => (
                    <tr key={item.id} className="border-b border-line hover:bg-canvas/60">
                      <td className="px-3 py-4">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateQuoteItem(item.id, 'description', e.target.value)}
                          className="w-full bg-transparent text-ink font-medium outline-none border-b border-line focus:border-[#673AB7] py-2"
                          placeholder="รายละเอียดสินค้า/บริการ"
                        />
                      </td>
                      <td className="px-3 py-4">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateQuoteItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent text-right text-ink-muted outline-none border-b border-line focus:border-[#673AB7] py-2"
                        />
                      </td>
                      <td className="px-3 py-4">
                        <input
                          type="number"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => updateQuoteItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className="w-full bg-transparent text-right text-ink-muted outline-none border-b border-line focus:border-[#673AB7] py-2"
                        />
                      </td>
                      <td className="px-3 py-4 text-right whitespace-nowrap">
                        <span className="text-ink font-medium">
                          {money(item.total)}
                        </span>
                      </td>
                      <td className="px-1 py-4 text-center">
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
          </div>

          {/* Tax and Discount Settings */}
          <div className="pb-card p-4 md:p-6">
            <h3 className="text-base md:text-lg text-ink mb-4 md:mb-6 font-semibold">การคำนวณเพิ่มเติม</h3>
            
            <div className={`grid grid-cols-1 gap-4 md:gap-6 ${vatMode === 'none' ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
              <div>
                <label className="pb-label">ส่วนลด (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={discountRate}
                  onChange={(e) => setDiscountRate(parseFloat(e.target.value) || 0)}
                  className="pb-input"
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

              {vatMode !== 'none' && (
                <div>
                  <label className="pb-label">อัตรา VAT (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={taxRate}
                    onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                    className="pb-input"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary Sidebar */}
        <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
          {/* Financial Summary */}
          <div className="pb-card p-4 md:p-6">
            <h4 className="text-base md:text-lg text-ink mb-4 md:mb-6 font-semibold">สรุปการเงิน</h4>
            
            <div className="space-y-3 md:space-y-4">
              <div className="flex justify-between">
                <span className="text-sm md:text-base text-ink-muted">ยอดรวม</span>
                <span className="font-medium text-ink text-sm md:text-base">
                  {money(subtotal)}
                </span>
              </div>
              
              {discountRate > 0 && (
                <div className="flex justify-between">
                  <span className="text-sm md:text-base text-ink-muted">ส่วนลด ({discountRate}%)</span>
                  <span className="font-medium text-red-600 text-sm md:text-base">
                    -{money(discount)}
                  </span>
                </div>
              )}
              
              <div className="flex justify-between">
                <span className="text-sm md:text-base text-ink-muted">ยอดหลังหักส่วนลด</span>
                <span className="font-medium text-ink text-sm md:text-base">
                  {money(afterDiscount)}
                </span>
              </div>
              
              {vatRate > 0 && vatMode === 'inclusive' && (
                <div className="flex justify-between">
                  <span className="text-sm md:text-base text-ink-muted">มูลค่าก่อน VAT</span>
                  <span className="font-medium text-ink text-sm md:text-base">
                    {money(beforeVat)}
                  </span>
                </div>
              )}

              {vatRate > 0 && (
                <div className="flex justify-between">
                  <span className="text-sm md:text-base text-ink-muted">{vatMode === 'inclusive' ? `VAT ${vatRate}% (รวมในราคาแล้ว)` : `ภาษี (${vatRate}%)`}</span>
                  <span className="font-medium text-amber-600 text-sm md:text-base">
                    {money(tax)}
                  </span>
                </div>
              )}
              
              <div className="flex justify-between pt-3 md:pt-4 border-t border-line text-base md:text-lg font-medium">
                <span className="text-ink">ยอดรวมสุทธิ</span>
                <span className="text-ink">
                  {money(grandTotal)}
                </span>
              </div>
            </div>

            {lockedPrice !== null && (
              <div className="rounded-xl bg-[#F7F6FA] px-3 py-3 mt-4">
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

            {/* Action Buttons */}
            <div className="grid grid-cols-1 gap-3 mt-6">
              <button
                onClick={handlePreview}
                className="pb-btn-secondary"
              >
                <Eye className="w-4 h-4" />
                ดูตัวอย่าง
              </button>

              {savedId && status === 'approved' && !projectId && (
                <button onClick={makeProject} disabled={saving} className="pb-btn-secondary disabled:opacity-60">
                  <FolderPlus className="w-4 h-4" />
                  สร้างโปรเจ็กต์และใส่ต้นทุน
                </button>
              )}

              <button onClick={exportPdf} disabled={saving || exporting} className="pb-btn-secondary disabled:opacity-60">
                <Download className="w-4 h-4" />
                {exporting ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
              </button>
              
              <button
                onClick={handleSave}
                disabled={saving}
                className="pb-btn-primary disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {saving ? 'กำลังบันทึก...' : 'บันทึกใบเสนอราคา'}
              </button>
            </div>
          </div>

          {/* Quote Info */}
          <div className="pb-card p-4 md:p-6">
            <h4 className="text-base md:text-lg text-ink mb-4 md:mb-6 font-semibold">ข้อมูลใบเสนอราคา</h4>
            
            <div className="space-y-3 md:space-y-4">
              <div className="flex items-center gap-3">
                <Calculator className="w-4 h-4 md:w-5 md:h-5 text-ink-muted" />
                <div>
                  <div className="text-xs md:text-sm text-ink-muted">จำนวนรายการ</div>
                  <div className="font-medium text-ink text-sm md:text-base">{quoteItems.length} รายการ</div>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 md:w-5 md:h-5 text-ink-muted" />
                <div>
                  <div className="text-xs md:text-sm text-ink-muted">วันที่สร้าง</div>
                  <div className="font-medium text-ink text-sm md:text-base">
                    {createdDate}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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