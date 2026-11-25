import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Plus, Trash2, Save, Eye, Download, Link2, Send, X, Lock, FolderOpen, FolderPlus, Receipt as ReceiptIcon } from 'lucide-react';
import { api, baht, quoteChangeOf, Project, Quote, QuoteStatus, Rounding, User, VatMode, type PaymentMethod } from '../lib/api';
import { downloadPdf } from '../lib/pdf';
import { flushSync } from 'react-dom';
import { FitToWidth, QuoteDocument } from './QuoteDocument';
import { CustomerPicker } from './CustomerPicker';
import { DateField, thaiShortDate } from './DateField';
import { statusPill, struck } from './ProjectItem';
import { QUOTE_STATUS_OPTIONS, StatusDialog } from './StatusDialog';
import { useCustomerContactPrompt, type TypedContact } from './CustomerContactPrompt';
import { useQuoteChangePrompt } from './job/QuoteChangePrompt';
import { fitToPrice, lineAmount, quoteLinesFromJob, quoteTotals, toSatang } from '../../shared/quote-math.js';

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
  /** opens a job on its own page */
  onOpenProject?: (project: Project) => void;
  /** a save here changed something about the job (its status, or which quote is tied to it) */
  onProjectChanged?: (projectId: string) => void;
  /** opens a receipt (one just issued from this quote, or its receipt) */
  onOpenReceipt?: (receiptId: string) => void;
  onDone: () => void;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function NewQuote({ user, quoteId, fromProject, startInPreview, onOpenProjectCosts, onOpenProject, onProjectChanged, onOpenReceipt, onDone }: NewQuoteProps) {
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

  // A quote made for a job is tied to it: what it lists and what it comes to are the job's, are changed in the job,
  // and follow it when the job is saved; here they are only shown. A job that was itself made from a quote is the
  // other way round: its lines are changed here, and the job's price follows them.
  const [follows, setFollows] = useState(!!fromProject && fromProject.agreedPrice == null);
  /** the job a saved quote follows, and whether the quote still holds what the job gives it */
  const [job, setJob] = useState<Quote['job'] | null>(null);
  /**
   * The job whose page opens this quote (a quote made for a job becomes that one). They share the customer's name,
   * phone and email and the job's name, changed on either; the event date is the job's, changed there.
   */
  const [linkedJob, setLinkedJob] = useState<Quote['linkedJob'] | null>(
    fromProject ? { id: fromProject.id, code: fromProject.code, eventDate: fromProject.eventDate, priceFromQuote: fromProject.agreedPrice != null } : null,
  );
  const [statusOpen, setStatusOpen] = useState(false);
  /** its latest receipt: while one is in force the quote is what the customer paid for, and cannot change */
  const [receipt, setReceipt] = useState<Quote['receipt'] | null>(null);
  const locked = receipt?.status === 'issued';
  /** the receipt being issued: when the money came in and how */
  const [issuing, setIssuing] = useState<{ paidDate: string; paymentMethod: PaymentMethod; busy: boolean } | null>(null);
  /** the number of the job this quote belonged to, when that job was deleted */
  const [deletedJob, setDeletedJob] = useState<string | null>(null);
  /** something on the form was typed or chosen since it was opened or last saved */
  const touched = useRef(false);
  /** the next render holds the quote as saved (just loaded, or just saved) */
  const takeBaseline = useRef(false);

  // One line per heading of the job, named after it and priced at what the heading sells for in whole baht, adding up
  // to the job's price: the customer sees the headings and not the costs inside them (see quoteLinesFromJob).
  const [fromJob] = useState(() => (fromProject ? quoteLinesFromJob(fromProject.costItems, fromProject.costGroups, fromProject.profitMargin, fromProject.agreedPrice) : null));
  // only an older copy of a job's quote is still held to a price; a new quote for a job never is
  const [lockedPrice, setLockedPrice] = useState<number | null>(follows ? fromJob?.price ?? null : null);
  // each line chooses whether its amount rounds up to a whole baht ('line'); a quote made before that
  // choice existed opens on the old rule ('baht') until the user switches it
  const [rounding, setRounding] = useState<Rounding>('line');
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>(() => {
    const lines = (fromJob?.lines ?? []).map((line, idx) => ({ ...line, id: idx + 1, total: lineAmount(line, 'line') }));
    // a job with no costs yet gives its quote no lines; any other quote starts with one empty line to fill in
    if (lines.length || follows) return lines;
    return [{ id: 1, description: '', quantity: 1, unit: '', unitPrice: 0, total: 0, roundUp: true }];
  });

  const [taxRate, setTaxRate] = useState(7);
  const [vatMode, setVatMode] = useState<VatMode>(user.vatMode);
  const [discountRate, setDiscountRate] = useState(0);
  // withholding tax: only some customers (companies paying for a service) hold it back, so it starts at none
  const [whtRate, setWhtRate] = useState(0);
  const [notification, setNotification] = useState('');
  const contactPrompt = useCustomerContactPrompt();
  const quoteChangePrompt = useQuoteChangePrompt();
  /** the contact details this quote started with (from its project, or as last saved): unchanged, they are not asked about */
  const startContact = useRef<TypedContact | undefined>(
    fromProject ? { customerId: fromProject.customerId, name: fromProject.client, phone: fromProject.phone, email: fromProject.email, creditDays: 0 } : undefined,
  );

  /** fills the form from a saved quote */
  const load = (id: string) =>
    api.quote(id)
      .then(q => {
        // what is about to be put in the form is what is saved: it becomes the baseline for "anything changed?"
        takeBaseline.current = true;
        setSavedId(q.id);
        setQuoteCode(q.code);
        setStatus(q.status);
        setProjectId(q.projectId);
        setCustomerId(q.customerId);
        startContact.current = { customerId: q.customerId, name: q.clientName, phone: q.clientPhone, email: q.clientEmail, creditDays: q.creditDays ?? 0, address: q.clientAddress ?? '', taxId: q.clientTaxId ?? '', branch: q.clientBranch ?? '' };
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
          // the event date of a job's quote is the job's (an older quote can be behind until it is next saved)
          eventDate: q.linkedJob ? q.linkedJob.eventDate : q.eventDate,
          validUntil: q.validUntil,
          creditDays: q.creditDays ?? 0,
          notes: q.notes,
          internalNote: q.internalNote ?? '',
        });
        setQuoteItems(q.items.length || q.followsProject ? q.items : [{ id: 1, description: '', quantity: 1, unit: '', unitPrice: 0, total: 0, roundUp: q.rounding !== 'baht' }]);
        setFollows(!!q.followsProject);
        setJob(q.job ?? null);
        setLinkedJob(q.linkedJob ?? null);
        setReceipt(q.receipt ?? null);
        setDeletedJob(q.deletedProjectCode ?? null);
        setTaxRate(q.taxRate);
        setDiscountRate(q.discountRate);
        setWhtRate(q.whtRate);
        setVatMode(q.vatMode);
        setRounding(q.rounding === 'baht' ? 'baht' : 'line');
        setLockedPrice(q.lockedPrice);
      })
      .catch(err => showNotification(err.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    if (!quoteId) return;
    load(quoteId).then(() => {
      if (startInPreview) setShowPreview(true);
    });
  }, [quoteId, startInPreview]);

  useEffect(() => {
    // A job has one quote. When this form is opened for a job that already has it (reached again with the browser's
    // back button, say), that quote is what opens, not the start of a second one; for a job made from a quote, that is
    // the quote it was made from.
    if (quoteId || !fromProject) return;
    let stale = false;
    api.project(fromProject.id)
      .then((p) => {
        if (stale || !p.quote) return;
        setLoading(true);
        return load(p.quote.id);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  useEffect(() => {
    // a quote made from a job: the job holds no address, tax id or credit, so they come from the customer's record and last quote
    if (!fromProject?.customerId) return;
    let stale = false;
    api.customers()
      .then((all) => {
        const c = all.find((x) => x.id === fromProject.customerId);
        if (!c || stale) return;
        setQuoteData((d) => ({ ...d, clientAddress: d.clientAddress || c.address || c.quoteAddress || '', clientTaxId: d.clientTaxId || c.taxId || c.quoteTaxId || '', clientBranch: d.clientBranch || c.branch || c.quoteBranch || '', creditDays: d.creditDays || c.creditDays || 0 }));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [fromProject?.customerId]);

  /** payment falls due so many days after the event */
  const dueDate = quoteData.creditDays > 0 && quoteData.eventDate ? new Date(Date.parse(quoteData.eventDate + 'T00:00:00Z') + quoteData.creditDays * 864e5) : null;

  const { subtotal, discount, afterDiscount, beforeVat, vat: tax, total: grandTotal, rate: vatRate, withholding, payable } = quoteTotals({ items: quoteItems, discountRate, taxRate, vatMode, rounding, whtRate });

  /**
   * Everything a save sends, to tell whether the form differs from the quote as it was last saved. The save button
   * is only live when it does, or when the quote has never been saved; changing something back makes it idle again.
   */
  const current = JSON.stringify({
    quoteData, customerId, status, taxRate, discountRate, whtRate, vatMode, rounding,
    items: quoteItems.map(({ description, quantity, unit, unitPrice, roundUp }) => ({ description, quantity, unit: unit ?? '', unitPrice, roundUp: !!roundUp })),
  });
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    // the render after a quote is loaded or saved shows it as saved
    if (!takeBaseline.current) return;
    takeBaseline.current = false;
    setSaved(current);
  });
  const changed = !savedId || saved === null || current !== saved;
  const saveTitle = changed ? undefined : 'บันทึกแล้ว ยังไม่มีการแก้ไข';
  // show the satang only when some amount on this quote has any, so a whole-baht quote stays clean
  const showSatang = rounding !== 'baht' && [subtotal, discount, tax, grandTotal, withholding, ...quoteItems.map((i) => i.total)].some((n) => !Number.isInteger(n));
  const money = (n: number) => baht(n, showSatang ? 2 : 0);
  /** how far the lines are from the locked job price (0 = they match) */
  const lockGap = follows || lockedPrice === null ? 0 : toSatang(afterDiscount - lockedPrice);

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
    const contact: TypedContact = {
      customerId, name: quoteData.clientName, phone: quoteData.clientPhone, email: quoteData.clientEmail,
      creditDays: quoteData.creditDays, address: quoteData.clientAddress, taxId: quoteData.clientTaxId, branch: quoteData.clientBranch,
    };
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
        whtRate,
        vatMode,
        status: nextStatus === 'expired' ? undefined : nextStatus,
        // the lines, the discount and the rounding of a quote tied to a job are the job's: the server fills them in
        ...(follows ? {} : {
          discountRate,
          rounding,
          items: quoteItems
            .filter(item => item.description.trim() || item.total > 0)
            .map(({ description, quantity, unit, unitPrice, roundUp }) => ({ description, quantity, unit: unit ?? '', unitPrice, roundUp: !!roundUp })),
        }),
      };
      const saved = savedId ? await api.updateQuote(savedId, body) : await api.createQuote(body);
      setSavedId(saved.id);
      startContact.current = contact;
      setQuoteCode(saved.code);
      setStatus(saved.status);
      setLockedPrice(saved.lockedPrice);
      setFollows(!!saved.followsProject);
      setJob(saved.job ?? null);
      setLinkedJob(saved.linkedJob ?? null);
      setReceipt(saved.receipt ?? null);
      if (saved.followsProject) setQuoteItems(saved.items);
      // the event date of a job's quote is the job's: the server keeps it so
      if (saved.linkedJob) setQuoteData((d) => ({ ...d, eventDate: saved.eventDate }));
      touched.current = false;
      takeBaseline.current = true;
      if (saved.projectId) onProjectChanged?.(saved.projectId);
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
    if (!saved) return;
    showNotification(saved.jobUpdated && saved.linkedJob ? `บันทึกใบเสนอราคา ${saved.code} แล้ว โปรเจ็กต์ ${saved.linkedJob.code} เปลี่ยนตามแล้ว` : `บันทึกใบเสนอราคา ${saved.code} เรียบร้อยแล้ว!`);
  };

  const handlePreview = () => {
    setShowPreview(true);
  };

  const docRef = useRef<HTMLDivElement>(null);
  const docData = { ...quoteData, code: quoteCode, createdDate, taxRate, discountRate, whtRate, vatMode, rounding, items: quoteItems };
  const [exporting, setExporting] = useState(false);

  /** Saves first so the PDF always carries a real quote number, then downloads it. */
  const exportPdf = async () => {
    // a quote with a receipt in force cannot change, so there is nothing to save first
    const saved = locked ? { code: quoteCode, clientName: quoteData.clientName } : await persist();
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

  /**
   * Goes to the quote's job. A tied quote's lines and prices are changed there, so it opens on the costs; any other
   * quote linked to a job (the one the job was made from, or an older copy) opens the job's own page.
   */
  const backToProject = async (where: 'costs' | 'page' = 'costs') => {
    if (touched.current && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก ออกจากหน้านี้เลยหรือไม่?')) return;
    try {
      // read again, not the copy this form was opened with: saving the quote has changed the job (its quote, its status)
      const target = projectId ? await api.project(projectId) : fromProject;
      if (target) (where === 'page' && onOpenProject ? onOpenProject : onOpenProjectCosts)(target);
    } catch (err) {
      showNotification((err as Error).message);
    }
  };
  const jobCode = job?.code ?? (follows ? fromProject?.code : undefined);

  /**
   * A quote from before jobs and quotes were tied can still hold its old lines. This brings it into line with its job,
   * asking first when the customer already has it. Only the lines and the price change; what else is on the form stays.
   */
  const syncWithJob = async () => {
    if (!savedId) return;
    const apply = (q: Quote) => {
      setQuoteItems(q.items);
      setDiscountRate(q.discountRate);
      setRounding(q.rounding === 'baht' ? 'baht' : 'line');
      setLockedPrice(q.lockedPrice);
      setJob(q.job ?? null);
      showNotification('อัปเดตใบเสนอราคาตามโปรเจ็กต์แล้ว');
    };
    try {
      apply(await api.syncQuote(savedId));
    } catch (err) {
      const change = quoteChangeOf(err);
      if (!change) return showNotification((err as Error).message);
      if (!(await quoteChangePrompt.ask(change, 'quote'))) return;
      try {
        apply(await api.syncQuote(savedId, true));
      } catch (again) {
        showNotification((again as Error).message);
      }
    }
  };

  /** the customer has paid for an approved quote: its receipt is issued (saving any change first), and opened */
  const startReceipt = async () => {
    if (changed && !(await persist())) return;
    const d = new Date();
    // today as the shop sees it (not UTC): the morning in Thailand is still yesterday in UTC
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    setIssuing({ paidDate: today, paymentMethod: 'transfer', busy: false });
  };
  const issueReceipt = async () => {
    if (!issuing || !savedId) return;
    setIssuing({ ...issuing, busy: true });
    try {
      const made = await api.createReceipt(savedId, { paidDate: issuing.paidDate, paymentMethod: issuing.paymentMethod });
      setIssuing(null);
      if (projectId) onProjectChanged?.(projectId);
      if (onOpenReceipt) onOpenReceipt(made.id);
      else load(savedId);
    } catch (err) {
      setIssuing({ ...issuing, busy: false });
      showNotification((err as Error).message);
    }
  };

  const handleSend = async () => {
    if (locked) return;
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
          <h2 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight mb-1">
            {savedId ? <>ใบเสนอราคา <span className={`text-[#673AB7] ${struck(status)}`}>{quoteCode}</span></> : 'สร้างใบเสนอราคาใหม่'}
          </h2>
          <p className="text-sm text-ink-muted">
            {follows
              ? `ผูกกับโปรเจ็กต์${jobCode ? ` ${jobCode}` : ''} · หนึ่งบรรทัดต่อหนึ่งหัวข้อ ราคารวมกำไรแล้ว`
              : linkedJob ? `ผูกกับโปรเจ็กต์ ${linkedJob.code} · แก้รายการและราคาที่ใบนี้ ราคาขายของโปรเจ็กต์เปลี่ยนตาม`
              : savedId ? 'แก้ไขรายละเอียดแล้วกดบันทึก' : 'สร้างใบเสนอราคาสำหรับลูกค้า'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* the quote's status, changed here as on the job's page: it is saved with the rest of the page */}
          <button
            type="button"
            onClick={() => setStatusOpen(true)}
            disabled={locked}
            aria-label="สถานะใบเสนอราคา"
            title={locked ? 'ออกใบเสร็จแล้ว ยกเลิกใบเสร็จก่อนจึงเปลี่ยนสถานะได้' : 'เปลี่ยนสถานะ'}
            className={`self-stretch inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium disabled:cursor-default ${statusPill(status)}`}
          >
            {QUOTE_STATUS_OPTIONS.find((o) => o.id === status)?.name ?? 'หมดอายุ'}
            {!locked && <ChevronDown className="w-4 h-4 opacity-60" aria-hidden />}
          </button>
          <button onClick={onDone} className="pb-btn-secondary">
            <X className="w-4 h-4" />
            ปิดหน้าต่าง
          </button>
          <button onClick={handleSave} disabled={saving || !changed} title={saveTitle} className="pb-btn-primary !hidden md:!inline-flex md:min-w-[12rem] disabled:opacity-60 disabled:cursor-not-allowed">
            <Save className="w-4 h-4" />
            {saving ? 'กำลังบันทึก...' : 'บันทึกใบเสนอราคา'}
          </button>
        </div>
      </div>

      {receipt && locked && (
        <div role="note" aria-label="ออกใบเสร็จแล้ว" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 text-emerald-800">
            <p className="font-semibold">ออกใบเสร็จ {receipt.code} แล้ว</p>
            <p className="text-sm mt-0.5">ใบเสนอราคานี้แก้ไม่ได้ ถ้าจะแก้ ให้ยกเลิกใบเสร็จก่อน (ใบเสนอราคาจะถูกยกเลิกด้วย แล้วสร้างใบใหม่ที่โปรเจ็กต์)</p>
          </div>
          {onOpenReceipt && (
            <button type="button" onClick={() => onOpenReceipt(receipt.id)} className="pb-btn-secondary !py-2 !bg-white shrink-0">
              <ReceiptIcon className="w-4 h-4" />
              เปิดใบเสร็จ
            </button>
          )}
        </div>
      )}
      {receipt && !locked && status === 'cancelled' && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 mb-4 text-rose-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">ใบเสร็จ {receipt.code} ถูกยกเลิก ใบเสนอราคานี้จึงถูกยกเลิกด้วย</p>
            <p className="text-sm mt-0.5">{receipt.projectCode ? `สร้างใบเสนอราคาใหม่ได้ที่โปรเจ็กต์ ${receipt.projectCode}` : 'สร้างใบเสนอราคาใหม่ได้'}</p>
          </div>
          {onOpenReceipt && (
            <button type="button" onClick={() => onOpenReceipt(receipt.id)} className="pb-btn-secondary !py-2 !bg-white shrink-0">
              <ReceiptIcon className="w-4 h-4" />
              เปิดใบเสร็จ
            </button>
          )}
        </div>
      )}
      {deletedJob && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 mb-4 text-rose-700">
          <p className="font-semibold">โปรเจ็กต์ {deletedJob} ของใบเสนอราคานี้ถูกลบแล้ว</p>
          <p className="text-sm mt-0.5">ใบเสนอราคานี้จึงถูกยกเลิก รายการและราคาที่เห็นคือของล่าสุดก่อนโปรเจ็กต์ถูกลบ</p>
        </div>
      )}
      <div className="pb-card p-4 md:p-6 xl:p-8" onChange={() => { touched.current = true; }}>
        {/* the customer on the left; the total, what can be done with the quote and its dates on the right */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] gap-6 lg:gap-12">
          <fieldset disabled={locked} className="min-w-0 m-0 p-0 border-0"><div role="group" aria-label="ข้อมูลลูกค้า" className="space-y-4">
            {linkedJob && (
              <p role="note" className="flex items-start gap-2 text-xs text-ink-muted">
                <Link2 className="w-4 h-4 text-[#673AB7] shrink-0" />
                ชื่อลูกค้า เบอร์โทร อีเมล และชื่อโปรเจ็กต์ ใช้ร่วมกับโปรเจ็กต์ {linkedJob.code} แก้ที่นี่หรือที่โปรเจ็กต์ก็ได้ บันทึกแล้วอีกฝั่งเปลี่ยนตาม
              </p>
            )}
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
                    clientTaxId: c.taxId || c.quoteTaxId || quoteData.clientTaxId,
                    clientBranch: c.branch || c.quoteBranch || quoteData.clientBranch,
                    creditDays: c.creditDays || quoteData.creditDays,
                  });
                }}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4">
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
          </div></fieldset>

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
              {savedId && status === 'approved' && !locked && (
                <button onClick={startReceipt} disabled={saving} className={`${action} !text-[#673AB7]`}>
                  <ReceiptIcon className="w-6 h-6" />
                  ออกใบเสร็จ
                </button>
              )}
              {savedId && status === 'approved' && !projectId && (
                <button onClick={makeProject} disabled={saving} className={action}>
                  <FolderPlus className="w-6 h-6" />
                  สร้างโปรเจ็กต์และใส่ต้นทุน
                </button>
              )}
              {/* a quote linked to a job but not tied to it (the job was made from it): its lines are its own, the job is a click away */}
              {savedId && projectId && !follows && (
                <button onClick={() => backToProject('page')} className={action}>
                  <FolderOpen className="w-6 h-6" />
                  เปิดโปรเจ็กต์
                </button>
              )}
            </div>
            <p className="text-sm font-medium text-ink">จำนวนเงินรวมทั้งสิ้น</p>
            <p className="text-3xl md:text-4xl font-semibold text-[#673AB7] tracking-tight mt-1 mb-4 break-words">{money(grandTotal)}</p>
            <fieldset disabled={locked} className="min-w-0 m-0 p-0 border-0"><div className="space-y-2">
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
                <span className="text-sm font-medium text-ink">วันที่สร้าง</span>
                <span className="text-sm text-ink py-2 px-[0.95rem]">{createdDate}</span>
              </div>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
                <label className="text-sm font-medium text-ink">ใบเสนอราคาใช้ได้ถึง</label>
                <DateField label="ใบเสนอราคาใช้ได้ถึง" className="pb-input-sm" value={quoteData.validUntil} onChange={(v) => { touched.current = true; setQuoteData({ ...quoteData, validUntil: v }); }} />
              </div>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-3">
                <label className="text-sm font-medium text-ink">วันที่จัดงาน</label>
                {linkedJob ? (
                  // the job's date: changed on the job, and this quote takes it
                  <div role="group" aria-label="วันที่จัดงาน (จากโปรเจ็กต์)" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 px-[0.95rem]">
                    <span className={`text-sm ${quoteData.eventDate ? 'text-ink' : 'text-ink-muted'}`}>{quoteData.eventDate ? thaiShortDate(quoteData.eventDate) : 'ยังไม่ได้ระบุ'}</span>
                    <button type="button" onClick={() => backToProject('page')} className="text-xs font-medium text-[#673AB7] hover:underline">
                      แก้ที่โปรเจ็กต์
                    </button>
                  </div>
                ) : (
                  <DateField label="วันที่จัดงาน" className="pb-input-sm" value={quoteData.eventDate} onChange={(v) => { touched.current = true; setQuoteData({ ...quoteData, eventDate: v }); }} />
                )}
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
            </div></fieldset>
          </div>
        </div>

        <div className="border-t border-line my-6" />

        {/* what the quote is for, and whether its prices carry VAT */}
        <fieldset disabled={locked} className="min-w-0 m-0 p-0 border-0"><div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_minmax(0,18rem)] gap-4">
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
        </div></fieldset>

        {/* Quote items */}
        <fieldset disabled={locked} className="min-w-0 m-0 p-0 border-0"><div role="group" aria-label="รายการใบเสนอราคา" className="mt-6">
          {follows ? (
            <>
              <div role="note" aria-label="รายการมาจากโปรเจ็กต์" className="rounded-2xl bg-[#F7F6FA] px-4 py-3 mb-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Link2 className="w-4 h-4 text-[#673AB7] shrink-0" />
                    รายการและราคามาจากโปรเจ็กต์{jobCode ? ` ${jobCode}` : ''}
                  </p>
                  <p className="text-xs text-ink-muted mt-1">แก้ชื่อรายการ ราคา หรือส่วนลดได้ที่โปรเจ็กต์ บันทึกโปรเจ็กต์แล้วใบนี้จะเปลี่ยนตาม</p>
                  {job && !job.inStep && (
                    <p className="text-xs text-rose-600 mt-1">ใบนี้สร้างไว้ก่อนผูกกับโปรเจ็กต์ รายการจึงยังไม่ตรงกัน (ราคาโปรเจ็กต์ตอนนี้ {money(job.price ?? 0)}) และจะเปลี่ยนตามเมื่อแก้ราคาในโปรเจ็กต์ หรือกด "อัปเดตใบนี้ตามโปรเจ็กต์"</p>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  {job && !job.inStep && (
                    <button type="button" onClick={syncWithJob} className="pb-btn-secondary !py-2 !bg-white">อัปเดตใบนี้ตามโปรเจ็กต์</button>
                  )}
                  <button type="button" onClick={() => backToProject()} className="pb-btn-secondary !py-2 !bg-white">
                    <ArrowLeft className="w-4 h-4" />
                    กลับไปแก้โปรเจ็กต์
                  </button>
                </div>
              </div>
              {quoteItems.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-ink-muted text-center">โปรเจ็กต์นี้ยังไม่ได้ใส่ต้นทุน ใบนี้จึงยังไม่มีรายการ</p>
              ) : (
                <>
                  {/* Cards: phones, tablets and small laptops */}
                  <div className="block xl:hidden space-y-3">
                    {quoteItems.map((item, index) => (
                      <div key={item.id} className="bg-gray-50 p-4 rounded-lg border flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink break-words">{index + 1}. {item.description}</p>
                          <p className="text-xs text-ink-muted mt-1">{item.quantity}{item.unit ? ` ${item.unit}` : ''} × {money(item.unitPrice)}</p>
                        </div>
                        <span className="font-medium text-ink whitespace-nowrap">{money(item.total)}</span>
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
                        <col className="w-32" />
                        <col className="w-36" />
                      </colgroup>
                      <thead>
                        <tr className="bg-[#673AB7] text-white text-sm">
                          <th className="text-center px-1 py-3 font-medium">ลำดับ</th>
                          <th className="text-left px-3 py-3 font-medium">รายละเอียด</th>
                          <th className="text-right px-3 py-3 font-medium">จำนวน</th>
                          <th className="text-left px-3 py-3 font-medium">หน่วย</th>
                          <th className="text-right px-3 py-3 font-medium whitespace-nowrap">ราคา/หน่วย</th>
                          <th className="text-right px-3 py-3 font-medium">รวม</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quoteItems.map((item, index) => (
                          <tr key={item.id} className="border-t border-line">
                            <td className="px-1 py-4 text-center text-ink-muted">{index + 1}</td>
                            <td className="px-3 py-4 text-ink font-medium break-words">{item.description}</td>
                            <td className="px-3 py-4 text-right text-ink">{item.quantity}</td>
                            <td className="px-3 py-4 text-ink">{item.unit}</td>
                            <td className="px-3 py-4 text-right text-ink whitespace-nowrap">{money(item.unitPrice)}</td>
                            <td className="px-3 py-4 text-right text-ink font-medium whitespace-nowrap">{money(item.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
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
                  <div className="grid grid-cols-[2.4fr_3.5fr_3.3fr] gap-2">
                    <div>
                      <label className="pb-label">จำนวน</label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateQuoteItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-2 border border-line rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="pb-label">หน่วย</label>
                      <input
                        type="text"
                        value={item.unit ?? ''}
                        maxLength={30}
                        onChange={(e) => updateQuoteItem(item.id, 'unit', e.target.value)}
                        className="w-full px-2 py-2 border border-line rounded-lg text-sm"
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
                        className="w-full px-2 py-2 border border-line rounded-lg text-sm"
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
            </>
          )}
        </div></fieldset>

        {/* the note on the left; discount, VAT, the total and withholding on the right */}
        <fieldset disabled={locked} className="min-w-0 m-0 p-0 border-0"><div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-6 lg:gap-12 mt-6">
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

            {follows ? (discount > 0 && (
              <>
                {sumRow(`ส่วนลด ${discountRate}%`, `-${money(discount)}`, 'text-red-600')}
                {sumRow('ยอดหลังหักส่วนลด', money(afterDiscount))}
              </>
            )) : (
              <>
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
              </>
            )}
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
              {rounding !== 'baht' && <p className="text-xs text-ink-muted mt-1">{follows ? '' : 'ส่วนลด '}VAT และหัก ณ ที่จ่าย คิดถึงสตางค์ ไม่ปัดเศษ</p>}
            </div>

            {lockedPrice !== null && !follows && (
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
        </div></fieldset>
      </div>

      {/* on a phone the save button sits at the end of the form, where the thumb is */}
      <button onClick={handleSave} disabled={saving || !changed} title={saveTitle} className="pb-btn-primary w-full mt-5 md:!hidden disabled:opacity-60 disabled:cursor-not-allowed">
        <Save className="w-4 h-4" />
        {saving ? 'กำลังบันทึก...' : 'บันทึกใบเสนอราคา'}
      </button>

      {issuing && (
        <div className="fixed inset-0 z-50 bg-[#221A33]/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => !issuing.busy && setIssuing(null)}>
          <div role="dialog" aria-modal="true" aria-label="ออกใบเสร็จ" className="bg-white rounded-[24px] shadow-soft-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-1">
              <h3 className="text-lg font-semibold text-ink">ออกใบเสร็จ</h3>
              <button type="button" onClick={() => setIssuing(null)} aria-label="ปิด" className="p-1.5 rounded-full text-ink-muted hover:bg-[#F1F0F5]"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-ink-muted mb-4">จากใบเสนอราคา {quoteCode} · {quoteData.clientName}</p>
            <div className="rounded-2xl bg-[#F7F6FA] p-4 mb-4 flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-muted">{withholding > 0 ? 'ยอดรับชำระ (หลังหัก ณ ที่จ่าย)' : 'ยอดรับชำระ'}</span>
              <span className="text-xl font-semibold text-[#673AB7]">{money(payable)}</span>
            </div>
            <div className="space-y-4">
              <div>
                <label className="pb-label">วันที่รับเงิน</label>
                <DateField label="วันที่รับเงิน" clearable={false} value={issuing.paidDate} onChange={(v) => setIssuing({ ...issuing, paidDate: v || issuing.paidDate })} />
              </div>
              <div>
                <label className="pb-label">วิธีรับเงิน</label>
                <select className="pb-input" aria-label="วิธีรับเงิน" value={issuing.paymentMethod} onChange={(e) => setIssuing({ ...issuing, paymentMethod: e.target.value as PaymentMethod })}>
                  <option value="transfer">โอนเงิน</option>
                  <option value="cash">เงินสด</option>
                  <option value="cheque">เช็ค</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-ink-muted mt-4">
              ออกใบเสร็จแล้ว{linkedJob ? ` โปรเจ็กต์ ${linkedJob.code} จะเป็น "เสร็จสิ้น" และ` : ''} ใบเสนอราคานี้จะแก้ไม่ได้จนกว่าจะยกเลิกใบเสร็จ
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-end mt-6">
              <button type="button" onClick={() => setIssuing(null)} disabled={issuing.busy} className="pb-btn-secondary">ยกเลิก</button>
              <button type="button" onClick={issueReceipt} disabled={issuing.busy} className="pb-btn-primary disabled:opacity-60">
                <ReceiptIcon className="w-4 h-4" />
                {issuing.busy ? 'กำลังออกใบเสร็จ...' : 'ออกใบเสร็จ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {statusOpen && (
        <StatusDialog
          title="เปลี่ยนสถานะใบเสนอราคา"
          subject={`${quoteCode || 'ใบเสนอราคาใหม่'} · ${quoteData.projectTitle || quoteData.clientName}`}
          options={QUOTE_STATUS_OPTIONS}
          current={status}
          blocked={() => (locked ? 'ออกใบเสร็จแล้ว' : null)}
          note={
            status === 'expired'
              ? 'ใบนี้เลยวันที่ใช้ได้แล้ว (หมดอายุ) เลือกสถานะใหม่ได้ หรือเลื่อนวันที่ใช้ได้ถึง'
              : linkedJob ? `โปรเจ็กต์ ${linkedJob.code} จะเปลี่ยนสถานะตามเมื่อบันทึก` : undefined
          }
          noteTone={status === 'expired' ? 'warn' : 'info'}
          onPick={(id) => {
            touched.current = true;
            setStatus(id);
            setStatusOpen(false);
          }}
          onClose={() => setStatusOpen(false)}
        />
      )}

      {/* Notification */}
      {contactPrompt.node}
      {quoteChangePrompt.node}
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
              <button onClick={handleSend} disabled={saving || exporting} className={`pb-btn-primary disabled:opacity-60 ${locked ? '!hidden' : ''}`}>
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