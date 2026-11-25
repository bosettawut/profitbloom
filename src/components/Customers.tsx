import React, { useEffect, useState } from 'react';
import { ArrowLeft, CalendarClock, ChevronRight, Edit, FileText, FolderOpen, Landmark, Mail, MapPin, MessageCircle, Phone, Plus, Search, Trash2, Wallet, X } from 'lucide-react';
import { api, baht, type Customer, type CustomerDetail, type CustomerInput, type CustomerSummary, type Project } from '../lib/api';
import { ProjectItem, statusPill, struck } from './ProjectItem';
import { StatsCard } from './StatsCard';
import { salePrice } from '../lib/job';
import { nextSort, Pagination, SortHeader, sortRows, usePaged, type Sort } from './ListTools';

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : 'ยังไม่กำหนดวัน';


function useToast() {
  const [toast, setToast] = useState('');
  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(''), 3000);
  };
  const node = toast ? (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-ink text-white px-5 py-3 rounded-full shadow-soft-xl z-50 animate-toast text-sm">{toast}</div>
  ) : null;
  return { flash, node };
}

interface CustomerFormProps {
  /** the customer being edited; leave out to add a new one */
  customer?: Customer;
  /** fills the name in when adding a customer from another screen */
  initialName?: string;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}

/** Add or edit a customer, in the same dialog style as the rest of the app. */
export function CustomerForm({ customer, initialName = '', onClose, onSaved }: CustomerFormProps) {
  const [form, setForm] = useState<Required<CustomerInput>>({
    name: customer?.name ?? initialName,
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    lineId: customer?.lineId ?? '',
    address: customer?.address ?? '',
    notes: customer?.notes ?? '',
    creditDays: customer?.creditDays ?? 0,
    taxId: customer?.taxId ?? '',
    branch: customer?.branch ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('กรุณากรอกชื่อลูกค้า');
    setSaving(true);
    setError('');
    try {
      onSaved(customer ? await api.updateCustomer(customer.id, form) : await api.createCustomer(form));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const field = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div>
      <label className="pb-label">{label}</label>
      <input className="pb-input" type={type} placeholder={placeholder} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-[#221A33]/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} className="bg-white rounded-[24px] shadow-soft-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-1">
          <h3 className="text-lg font-semibold text-ink">{customer ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้า'}</h3>
          <button type="button" onClick={onClose} aria-label="ปิด" className="p-1.5 rounded-full text-ink-muted hover:bg-[#F1F0F5]"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-ink-muted mb-4">ข้อมูลติดต่อนี้ใช้เติมให้อัตโนมัติตอนสร้างโปรเจ็กต์และใบเสนอราคา</p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">{field('ชื่อลูกค้า *', 'name', 'text', 'เช่น คุณสมชาย')}</div>
          {field('เบอร์โทรศัพท์', 'phone', 'tel', 'เช่น 081-234-5678')}
          {field('LINE', 'lineId', 'text', 'เช่น @somchai')}
          <div className="sm:col-span-2">{field('อีเมล', 'email', 'email', 'เช่น somchai@email.com')}</div>
          <div>
            <label className="pb-label">เครดิต (วัน)</label>
            <input
              className="pb-input"
              type="number"
              min="0"
              max="365"
              inputMode="numeric"
              placeholder="0"
              value={form.creditDays || ''}
              onChange={(e) => setForm((f) => ({ ...f, creditDays: Math.min(365, Math.max(0, Math.round(parseFloat(e.target.value) || 0))) }))}
            />
          </div>
          <p className="text-xs text-ink-muted sm:self-end sm:pb-3">นับจากวันจัดงาน ใบเสนอราคาใหม่ของลูกค้ารายนี้จะเติมให้</p>
          <div className="sm:col-span-2">
            <label className="pb-label">ที่อยู่</label>
            <textarea className="pb-input" rows={2} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>
          {field('เลขประจำตัวผู้เสียภาษี', 'taxId', 'text', 'เช่น 0105551234567')}
          {field('สำนักงาน/สาขา', 'branch', 'text', 'เช่น สำนักงานใหญ่')}
          <div className="sm:col-span-2">
            <label className="pb-label">หมายเหตุ</label>
            <textarea className="pb-input" rows={3} placeholder="เช่น สีที่ชอบ งบประมาณ ช่องทางที่สะดวกติดต่อ" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>

        {error && <p className="text-sm text-rose-600 mt-4">{error}</p>}

        <div className="flex gap-2 justify-end mt-6">
          <button type="button" onClick={onClose} className="pb-btn-secondary">ยกเลิก</button>
          <button type="submit" disabled={saving} className="pb-btn-primary">{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
        </div>
      </form>
    </div>
  );
}

interface CustomersProps {
  onOpenCustomer: (customerId: string) => void;
}

/** The shop's customer list. */
export function Customers({ onOpenCustomer }: CustomersProps) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const [adding, setAdding] = useState(false);
  const { flash, node: toast } = useToast();

  useEffect(() => {
    api.customers()
      .then(setCustomers)
      .catch((err) => flash(err.message))
      .finally(() => setLoading(false));
  }, []);

  const term = searchTerm.trim().toLowerCase();
  const found = customers.filter((c) => !term || [c.name, c.phone, c.email, c.lineId, c.address, c.notes].some((v) => v.toLowerCase().includes(term)));
  /** what each sortable column orders by */
  const sortValue: Record<string, (c: CustomerSummary) => string | number> = {
    name: (c) => c.name,
    phone: (c) => c.phone,
    lineId: (c) => c.lineId,
    email: (c) => c.email,
    projects: (c) => c.projectCount,
    quotes: (c) => c.quoteCount,
    sales: (c) => c.totalSales,
    lastEvent: (c) => c.lastEventDate,
    recent: (c) => Number(c.id),
  };
  /** numbers and dates start biggest/newest first, text starts A→Z */
  const firstDir = (key: string): Sort['dir'] => (['projects', 'quotes', 'sales', 'lastEvent', 'recent'].includes(key) ? 'desc' : 'asc');
  const sortBy = (key: string, dir = firstDir(key)) => setSort((cur) => nextSort(cur, key, dir));
  const shown = sortRows(found, sortValue[sort.key] ?? sortValue.name, sort.dir);
  const paged = usePaged(shown, [term, sort.key, sort.dir].join('|'));

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 md:mb-8 gap-4">
        <div>
          <h1 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight">ลูกค้า</h1>
          <p className="text-sm text-ink-muted mt-1">รายชื่อลูกค้าของร้าน แตะที่ลูกค้าเพื่อดูโปรเจ็กต์และใบเสนอราคาของแต่ละคน</p>
        </div>
        <div className="flex gap-2 w-full lg:w-auto">
          <button onClick={() => setAdding(true)} className="pb-btn-primary flex-1 lg:flex-none whitespace-nowrap">
            <Plus className="w-4 h-4" />
            เพิ่มลูกค้า
          </button>
        </div>
      </div>

      {/* Search and sort */}
      <div className="pb-card p-3 md:p-4 mb-6 md:mb-8">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted w-5 h-5" />
            <input
              type="text"
              placeholder="ค้นหาชื่อ, เบอร์โทร, อีเมล, หรือ LINE..."
              className="pb-input pl-10 pr-4"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {/* the cards have no column headings to sort by */}
          <select className="pb-input text-ink-muted rows:hidden" value={sort.key} onChange={(e) => setSort({ key: e.target.value, dir: firstDir(e.target.value) })} aria-label="เรียงลำดับ">
            <option value="name">เรียงตามชื่อ</option>
            <option value="sales">เรียงตามยอดซื้อรวม</option>
            <option value="projects">เรียงตามจำนวนโปรเจ็กต์</option>
            <option value="recent">เรียงตามที่เพิ่มล่าสุด</option>
          </select>
        </div>
      </div>

      {loading && <div className="text-center text-ink py-12">กำลังโหลด...</div>}
      {!loading && shown.length === 0 && (
        <div className="pb-card p-10 text-center mb-8">
          <p className="text-ink-muted mb-4">{customers.length === 0 ? 'ยังไม่มีลูกค้า' : 'ไม่พบลูกค้าที่ตรงกับคำค้นหา'}</p>
          {customers.length === 0 && (
            <button onClick={() => setAdding(true)} className="pb-btn-primary">
              เพิ่มลูกค้าคนแรก
            </button>
          )}
        </div>
      )}

      {/* Table (desktop) */}
      {paged.rows.length > 0 && (
        <div className="hidden rows:block pb-card overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* Until the screen is wide (2xl) LINE has no column of its own: it sits under the phone number, so the name keeps a readable width at this text size. */}
              <thead>
                <tr className="bg-canvas/60 border-b border-line">
                  <SortHeader label="ลูกค้า" sortKey="name" sort={sort} onSort={sortBy} />
                  <SortHeader label="เบอร์โทร" sortKey="phone" sort={sort} onSort={sortBy} />
                  <SortHeader label="LINE" sortKey="lineId" sort={sort} onSort={sortBy} className="hidden 2xl:table-cell" />
                  <SortHeader label="อีเมล" sortKey="email" sort={sort} onSort={sortBy} />
                  <SortHeader label="งานล่าสุด" sortKey="lastEvent" sort={sort} onSort={sortBy} firstDir="desc" />
                  <SortHeader label="โปรเจ็กต์" sortKey="projects" sort={sort} onSort={sortBy} align="right" firstDir="desc" />
                  <SortHeader label="ใบเสนอราคา" sortKey="quotes" sort={sort} onSort={sortBy} align="right" firstDir="desc" />
                  <SortHeader label="ยอดซื้อรวม" sortKey="sales" sort={sort} onSort={sortBy} align="right" firstDir="desc" />
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((c) => (
                  <tr key={c.id} onClick={() => onOpenCustomer(c.id)} className="border-b border-line last:border-b-0 hover:bg-canvas/60 cursor-pointer">
                    <td className="px-2 2xl:px-3 py-3 font-medium text-ink max-w-[16rem]"><span className="line-clamp-2">{c.name}</span></td>
                    <td className="px-2 2xl:px-3 py-3 text-ink whitespace-nowrap">
                      {c.phone || '-'}
                      {c.lineId && <span className="2xl:hidden block mt-0.5 text-xs text-ink-muted truncate max-w-[7.5rem]">LINE: {c.lineId}</span>}
                    </td>
                    <td className="hidden 2xl:table-cell px-3 py-3 text-ink max-w-[9rem] truncate">{c.lineId || '-'}</td>
                    <td className="px-2 2xl:px-3 py-3 text-ink max-w-[9rem] 2xl:max-w-[13rem] truncate">{c.email || '-'}</td>
                    <td className="px-2 2xl:px-3 py-3 text-ink whitespace-nowrap">{c.lastEventDate ? formatDate(c.lastEventDate) : '-'}</td>
                    <td className="px-2 2xl:px-3 py-3 text-right text-ink">{c.projectCount}</td>
                    <td className="px-2 2xl:px-3 py-3 text-right text-ink">{c.quoteCount}</td>
                    <td className="px-2 2xl:px-3 py-3 text-right font-medium text-ink whitespace-nowrap">{baht(c.totalSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cards (phone) */}
      <div className="rows:hidden grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {paged.rows.map((c) => (
          <div key={c.id} onClick={() => onOpenCustomer(c.id)} className="pb-card cursor-pointer transition-all duration-300 overflow-hidden">
            <div className="p-4 md:p-6 border-b border-line">
              <h3 className="text-base md:text-lg text-ink mb-1 line-clamp-2 font-semibold">{c.name}</h3>
              <div className="space-y-1 text-sm text-ink-muted">
                <p className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{c.phone || '-'}</span></p>
                {c.lineId && <p className="flex items-center gap-2"><MessageCircle className="w-3.5 h-3.5 shrink-0" /><span className="truncate">LINE: {c.lineId}</span></p>}
                {c.email && <p className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{c.email}</span></p>}
              </div>
            </div>
            <div className="p-4 md:p-6 grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-ink-muted mb-1">โปรเจ็กต์</div>
                <div className="font-medium text-ink text-sm md:text-base">{c.projectCount}</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted mb-1">ใบเสนอราคา</div>
                <div className="font-medium text-ink text-sm md:text-base">{c.quoteCount}</div>
              </div>
              <div>
                <div className="text-xs text-ink-muted mb-1">ยอดซื้อรวม</div>
                <div className="font-medium text-ink text-sm md:text-base">{baht(c.totalSales)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Pagination paged={paged} unit="ลูกค้า" />

      {adding && (
        <CustomerForm
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            onOpenCustomer(c.id);
          }}
        />
      )}
      {toast}
    </div>
  );
}

interface CustomerPageProps {
  customerId: string;
  onBack: () => void;
  /** the customer no longer exists (deleted here, or the address is stale) */
  onGone: () => void;
  onOpenProject: (project: Project) => void;
  onOpenQuote: (quoteId: string) => void;
}

/** One customer: contact details, how much they have bought, and their projects and quotes. */
export function CustomerPage({ customerId, onBack, onGone, onOpenProject, onOpenQuote }: CustomerPageProps) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const { flash, node: toast } = useToast();

  useEffect(() => {
    let stale = false;
    api.customer(customerId)
      .then((c) => !stale && setCustomer(c))
      .catch(() => !stale && onGone());
    return () => {
      stale = true;
    };
  }, [customerId]);

  if (!customer) return <div className="p-5 md:p-10 text-center text-ink py-12">กำลังโหลด...</div>;

  const remove = async () => {
    const kept = customer.projectCount + customer.quoteCount > 0 ? '\nโปรเจ็กต์และใบเสนอราคาของลูกค้ารายนี้จะยังอยู่ครบ' : '';
    if (!window.confirm(`ลบลูกค้า "${customer.name}" ใช่หรือไม่?${kept}`)) return;
    try {
      await api.deleteCustomer(customer.id);
      onGone();
    } catch (err) {
      flash((err as Error).message);
    }
  };

  const contact = [
    { icon: Phone, label: 'เบอร์โทรศัพท์', value: customer.phone, href: customer.phone ? `tel:${customer.phone.replace(/[^\d+]/g, '')}` : '' },
    { icon: MessageCircle, label: 'LINE', value: customer.lineId, href: '' },
    { icon: Mail, label: 'อีเมล', value: customer.email, href: customer.email ? `mailto:${customer.email}` : '' },
    { icon: MapPin, label: 'ที่อยู่', value: customer.address, href: '' },
    { icon: Landmark, label: 'เลขประจำตัวผู้เสียภาษี', value: [customer.taxId, customer.branch].filter(Boolean).join(' · '), href: '' },
    { icon: CalendarClock, label: 'เครดิต', value: customer.creditDays > 0 ? `${customer.creditDays} วัน หลังวันจัดงาน` : 'ไม่มีเครดิต', href: '' },
  ];

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-ink-muted hover:text-ink mb-4">
        <ArrowLeft className="w-4 h-4" /> ลูกค้าทั้งหมด
      </button>

      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 md:mb-8 gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight break-words">{customer.name}</h1>
          <p className="text-sm text-ink-muted mt-1">เพิ่มเมื่อ {customer.createdDate}</p>
        </div>
        <div className="flex gap-2 w-full lg:w-auto">
          <button onClick={() => setEditing(true)} className="pb-btn-secondary flex-1 lg:flex-none">
            <Edit className="w-4 h-4" /> แก้ไข
          </button>
          <button onClick={remove} aria-label="ลบลูกค้า" title="ลบ" className="flex items-center justify-center w-11 shrink-0 bg-rose-50 text-rose-600 rounded-full hover:bg-rose-100 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-6 mb-4 md:mb-6">
        <StatsCard icon={Wallet} iconBg="bg-amber-50 text-amber-500" value={baht(customer.totalSales)} label="ยอดซื้อรวม" change={`จาก ${customer.soldCount} งานที่อนุมัติหรือเสร็จสิ้น`} positive />
        <StatsCard icon={FolderOpen} iconBg="bg-violet-50 text-[#673AB7]" value={String(customer.projectCount)} label="โปรเจ็กต์" change={customer.lastEventDate ? `งานล่าสุด ${formatDate(customer.lastEventDate)}` : 'ยังไม่มีวันจัดงาน'} positive />
        <div className="col-span-2 lg:col-span-1">
          <StatsCard icon={FileText} iconBg="bg-violet-50 text-[#673AB7]" value={String(customer.quoteCount)} label="ใบเสนอราคา" change={`อนุมัติแล้ว ${customer.quotes.filter((q) => q.status === 'approved').length} ใบ`} positive />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Contact */}
        <div className="pb-card p-5 md:p-7 self-start">
          <h3 className="text-base font-semibold text-ink mb-4">ข้อมูลติดต่อ</h3>
          <div className="space-y-4">
            {contact.map(({ icon: Icon, label, value, href }) => (
              <div key={label} className="flex gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-violet-50 text-[#673AB7] shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-ink-muted">{label}</p>
                  {value && href ? (
                    <a href={href} className="text-sm text-ink break-words hover:text-[#673AB7]">{value}</a>
                  ) : (
                    <p className="text-sm text-ink break-words whitespace-pre-line">{value || '-'}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {customer.notes && (
            <div className="mt-5 pt-5 border-t border-line">
              <p className="text-xs text-ink-muted mb-1">หมายเหตุ</p>
              <p className="text-sm text-ink whitespace-pre-line break-words">{customer.notes}</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          {/* Projects */}
          <div className="pb-card p-5 md:p-7">
            <h3 className="text-base font-semibold text-ink mb-2">โปรเจ็กต์ของลูกค้า</h3>
            {customer.projects.length === 0 && <p className="text-sm text-ink-muted py-4">ยังไม่มีโปรเจ็กต์ของลูกค้ารายนี้</p>}
            <div className="divide-y divide-line">
              {customer.projects.map((p) => (
                <ProjectItem key={p.id} title={p.title} date={formatDate(p.eventDate)} budget={baht(salePrice(p))} status={p.status} statusText={p.statusText} onClick={() => onOpenProject(p)} />
              ))}
            </div>
          </div>

          {/* Quotes */}
          <div className="pb-card p-5 md:p-7">
            <h3 className="text-base font-semibold text-ink mb-2">ใบเสนอราคาของลูกค้า</h3>
            {customer.quotes.length === 0 && <p className="text-sm text-ink-muted py-4">ยังไม่มีใบเสนอราคาของลูกค้ารายนี้</p>}
            <div className="divide-y divide-line">
              {customer.quotes.map((q) => (
                <button key={q.id} onClick={() => onOpenQuote(q.id)} className="w-full flex items-center gap-4 py-3.5 text-left group">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium text-ink truncate ${struck(q.status)}`}>{q.projectTitle || q.code}</p>
                    <p className="flex items-center gap-1.5 text-xs text-ink-muted mt-1">
                      <FileText className="w-3.5 h-3.5" />
                      {q.code} · {q.createdDate}
                    </p>
                  </div>
                  <span className="hidden sm:block text-sm font-medium text-ink">{baht(q.totalAmount, Number.isInteger(q.totalAmount) ? 0 : 2)}</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${statusPill(q.status)}`}>{q.statusText}</span>
                  <ChevronRight className="w-4 h-4 text-ink-muted group-hover:text-ink" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {editing && (
        <CustomerForm
          customer={customer}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            setCustomer((c) => (c ? { ...c, ...saved } : c));
            flash('บันทึกข้อมูลลูกค้าแล้ว');
          }}
        />
      )}
      {toast}
    </div>
  );
}
