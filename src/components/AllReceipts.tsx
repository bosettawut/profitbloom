import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Download, Filter, Loader2, Search } from 'lucide-react';
import { api, baht, type Receipt, type User } from '../lib/api';
import { downloadPdf } from '../lib/pdf';
import { QuoteDocument } from './QuoteDocument';
import { DateRange, inDateRange, nextSort, Pagination, SortHeader, sortRows, usePaged, type Sort } from './ListTools';
import { statusPill, struck } from './ProjectItem';
import { receiptDoc } from './ReceiptPage';

interface AllReceiptsProps {
  user: User;
  onOpenReceipt: (receiptId: string) => void;
  /** to the quotes, where receipts are issued */
  onNavigate?: (page: string) => void;
}

const money = (n: number) => baht(n, Number.isInteger(n) ? 0 : 2);

/** Every receipt the shop has issued, to look one up: by customer, job, number or quote, by status and by the day paid. */
export function AllReceipts({ user, onOpenReceipt, onNavigate }: AllReceiptsProps) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'date', dir: 'desc' });
  const [notification, setNotification] = useState('');
  const [pdfOf, setPdfOf] = useState<Receipt | null>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  const flash = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  useEffect(() => {
    api.receipts()
      .then(setReceipts)
      .catch((err) => flash((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const term = searchTerm.trim().toLowerCase();
  const found = receipts.filter(
    (r) =>
      (!term || [r.code, r.quoteCode, r.clientName, r.projectTitle].some((v) => v.toLowerCase().includes(term))) &&
      (statusFilter === 'all' || r.status === statusFilter) &&
      inDateRange(r.paidDate, dateFrom, dateTo),
  );
  /** what each sortable column orders by */
  const sortValue: Record<string, (r: Receipt) => string | number> = {
    code: (r) => r.code,
    title: (r) => r.projectTitle,
    client: (r) => r.clientName,
    date: (r) => Number(r.id),
    paid: (r) => r.paidDate,
    amount: (r) => r.payableAmount,
    status: (r) => (r.status === 'issued' ? 0 : 1),
  };
  /** numbers and dates start biggest/newest first, text starts A→Z */
  const firstDir = (key: string): Sort['dir'] => (['date', 'paid', 'amount'].includes(key) ? 'desc' : 'asc');
  const sortBy = (key: string, dir = firstDir(key)) => setSort((cur) => nextSort(cur, key, dir));
  const sorted = sortRows(found, sortValue[sort.key] ?? sortValue.date, sort.dir);
  const paged = usePaged(sorted, [searchTerm, statusFilter, dateFrom, dateTo, sort.key, sort.dir].join('|'));
  const count = (status: string) => receipts.filter((r) => r.status === status).length;

  const exportPdf = async (r: Receipt) => {
    // render the receipt off-screen, capture it, then drop it again
    flushSync(() => setPdfOf(r));
    try {
      if (pdfRef.current) await downloadPdf(pdfRef.current, `${r.code}${r.clientName ? '-' + r.clientName : ''}`);
    } catch {
      flash('สร้างไฟล์ PDF ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setPdfOf(null);
    }
  };

  const pdfButton = (r: Receipt, wide = false) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        exportPdf(r);
      }}
      disabled={!!pdfOf}
      aria-label="ดาวน์โหลด PDF"
      title="ดาวน์โหลด PDF"
      className={`flex items-center justify-center gap-1.5 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors disabled:opacity-60 ${wide ? 'py-2 px-4 text-sm' : 'w-8 h-8'}`}
    >
      {pdfOf?.id === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      {wide && 'PDF'}
    </button>
  );
  const pill = (r: Receipt) => <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${statusPill(r.status)}`}>{r.statusText}</span>;

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      <div className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight">ใบเสร็จ</h1>
        <p className="text-sm text-ink-muted mt-1">ใบเสร็จที่ออกแล้ว ออกใบเสร็จใหม่ได้ที่หน้าใบเสนอราคาที่ลูกค้าอนุมัติแล้ว</p>
      </div>

      {/* Status filter chips */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
        {[{ id: 'all', label: 'ทั้งหมด', count: receipts.length }, { id: 'issued', label: 'ออกแล้ว', count: count('issued') }, { id: 'cancelled', label: 'ยกเลิก', count: count('cancelled') }].map((chip) => (
          <button
            key={chip.id}
            onClick={() => setStatusFilter(chip.id)}
            aria-pressed={statusFilter === chip.id}
            className={`shrink-0 flex items-center gap-2 pl-3.5 pr-2 py-1.5 rounded-full text-sm transition-colors ${
              statusFilter === chip.id ? 'bg-white shadow-card text-ink font-medium' : 'text-ink-muted hover:text-ink hover:bg-white/60'
            }`}
          >
            {chip.label}
            <span className={`min-w-6 px-1.5 py-0.5 rounded-full text-xs ${statusFilter === chip.id ? 'bg-violet-50 text-[#673AB7]' : 'bg-[#F1F0F5]'}`}>{chip.count}</span>
          </button>
        ))}
      </div>

      {/* Search and filters */}
      <div className="pb-card p-3 md:p-4 mb-6 md:mb-8">
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted w-5 h-5" />
            <input type="text" placeholder="ค้นหาเลขใบเสร็จ, ลูกค้า, งาน, หรือเลขใบเสนอราคา..." className="pb-input pl-10 pr-4" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
          <div className="flex items-center justify-between">
            <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 px-3 py-1.5 -ml-1 text-sm text-ink-muted hover:text-ink rounded-full">
              <Filter className="w-4 h-4" />
              {showFilters ? 'ซ่อนตัวเลือก' : 'ช่วงเวลาและการเรียง'}
            </button>
            {(statusFilter !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setStatusFilter('all');
                  setDateFrom('');
                  setDateTo('');
                }}
                className="text-xs md:text-sm text-ink-muted hover:text-ink"
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>
          {showFilters && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 pt-4 border-t border-line">
              <select className="pb-input text-ink-muted" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">สถานะทั้งหมด</option>
                <option value="issued">ออกแล้ว</option>
                <option value="cancelled">ยกเลิก</option>
              </select>
              <DateRange label="วันที่รับเงิน" from={dateFrom} to={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
              <select className="pb-input text-ink-muted" value={sort.key} onChange={(e) => setSort({ key: e.target.value, dir: firstDir(e.target.value) })}>
                <option value="date">เรียงตามวันที่ออก</option>
                <option value="paid">เรียงตามวันที่รับเงิน</option>
                <option value="amount">เรียงตามจำนวนเงิน</option>
                <option value="client">เรียงตามลูกค้า</option>
                <option value="title">เรียงตามชื่องาน</option>
                <option value="code">เรียงตามเลขที่</option>
                <option value="status">เรียงตามสถานะ</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {loading && <div className="text-center text-ink py-12">กำลังโหลด...</div>}
      {!loading && sorted.length === 0 && (
        <div className="pb-card p-10 text-center mb-8">
          <p className="text-ink-muted mb-4">{receipts.length === 0 ? 'ยังไม่มีใบเสร็จ ออกใบเสร็จได้ที่หน้าใบเสนอราคาที่ลูกค้าอนุมัติแล้ว' : 'ไม่พบใบเสร็จที่ตรงกับเงื่อนไข'}</p>
          {receipts.length === 0 && onNavigate && (
            <button onClick={() => onNavigate('quotes')} className="pb-btn-primary">
              ไปที่ใบเสนอราคา
            </button>
          )}
        </div>
      )}

      {/* Table (wide screens) */}
      {paged.rows.length > 0 && (
        <div className="hidden rows:block pb-card overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-canvas/60 border-b border-line">
                  <SortHeader label="เลขที่" sortKey="code" sort={sort} onSort={sortBy} className="hidden 2xl:table-cell" />
                  <SortHeader label="งาน" sortKey="title" sort={sort} onSort={sortBy} />
                  <SortHeader label="ลูกค้า" sortKey="client" sort={sort} onSort={sortBy} className="hidden 2xl:table-cell" />
                  <SortHeader label="วันที่รับเงิน" sortKey="paid" sort={sort} onSort={sortBy} firstDir="desc" />
                  <th className="px-2 2xl:px-3 py-3 text-left text-ink font-medium">วิธีรับเงิน</th>
                  <th className="px-2 2xl:px-3 py-3 text-left text-ink font-medium">ใบเสนอราคา</th>
                  <SortHeader label="จำนวนเงิน" sortKey="amount" sort={sort} onSort={sortBy} align="right" firstDir="desc" />
                  <SortHeader label="สถานะ" sortKey="status" sort={sort} onSort={sortBy} />
                  <th className="px-2 py-3 text-center text-ink font-medium">PDF</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((r) => (
                  <tr key={r.id} onClick={() => onOpenReceipt(r.id)} className="border-b border-line last:border-b-0 hover:bg-canvas/60 cursor-pointer">
                    <td className={`hidden 2xl:table-cell px-3 py-3 text-ink-muted whitespace-nowrap ${struck(r.status)}`}>{r.code}</td>
                    <td className="px-2 2xl:px-3 py-3 font-medium text-ink max-w-[16rem]">
                      <span className={`line-clamp-2 ${struck(r.status)}`}>{r.projectTitle || '-'}</span>
                      {r.clientName && <span className="2xl:hidden block mt-0.5 font-normal text-ink truncate">{r.clientName}</span>}
                      <span className={`2xl:hidden block mt-0.5 text-xs font-normal text-ink-muted whitespace-nowrap ${struck(r.status)}`}>{r.code}</span>
                    </td>
                    <td className="hidden 2xl:table-cell px-3 py-3 text-ink max-w-[10rem] truncate">{r.clientName}</td>
                    <td className="px-2 2xl:px-3 py-3 text-ink whitespace-nowrap">{r.paidDateText || '-'}</td>
                    <td className="px-2 2xl:px-3 py-3 text-ink whitespace-nowrap">{r.paymentMethodText}</td>
                    <td className="px-2 2xl:px-3 py-3 text-ink-muted whitespace-nowrap">{r.quoteCode || '-'}</td>
                    <td className="px-2 2xl:px-3 py-3 text-right font-medium text-ink whitespace-nowrap">{money(r.payableAmount)}</td>
                    <td className="px-2 2xl:px-3 py-3">{pill(r)}</td>
                    <td className="px-2 py-3">
                      <div className="flex justify-center">{pdfButton(r)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cards (phones and smaller screens) */}
      <div className="rows:hidden grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {paged.rows.map((r) => (
          <div key={r.id} onClick={() => onOpenReceipt(r.id)} className="pb-card cursor-pointer overflow-hidden">
            <div className="p-4 md:p-6 border-b border-line">
              <div className="flex justify-between items-start gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className={`text-base md:text-lg mb-1 line-clamp-2 font-semibold text-ink ${struck(r.status)}`}>{r.projectTitle || r.clientName || r.code}</h3>
                  <p className={`text-sm text-ink-muted ${struck(r.status)}`}>เลขที่: {r.code}</p>
                </div>
                <div className="shrink-0">{pill(r)}</div>
              </div>
              <div className="text-xs md:text-sm text-ink-muted">
                ลูกค้า: <span className="font-medium text-ink">{r.clientName}</span>
              </div>
            </div>
            <div className="p-4 md:p-6">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-xs text-ink-muted mb-1">ยอดรับชำระ</div>
                  <div className="font-medium text-ink text-sm md:text-base">{money(r.payableAmount)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted mb-1">วันที่รับเงิน</div>
                  <div className="font-medium text-ink text-sm md:text-base">{r.paidDateText || '-'}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted mb-1">วิธีรับเงิน</div>
                  <div className="font-medium text-ink text-sm md:text-base">{r.paymentMethodText}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted mb-1">ใบเสนอราคา</div>
                  <div className="font-medium text-ink text-sm md:text-base">{r.quoteCode || '-'}</div>
                </div>
              </div>
              <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>{pdfButton(r, true)}</div>
            </div>
          </div>
        ))}
      </div>

      <Pagination paged={paged} unit="ใบเสร็จ" />

      {pdfOf && (
        <div aria-hidden className="fixed top-0 pointer-events-none" style={{ left: -10000 }}>
          <QuoteDocument ref={pdfRef} user={user} {...receiptDoc(pdfOf)} />
        </div>
      )}

      {notification && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-ink text-white px-5 py-3 rounded-full shadow-soft-xl z-50 animate-toast text-sm">{notification}</div>
      )}
    </div>
  );
}
