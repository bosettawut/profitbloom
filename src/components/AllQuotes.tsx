import { statusPill } from './ProjectItem';
import React, { useEffect, useRef, useState } from 'react';
import { Search, Filter, Plus, Eye, Edit, Trash2, Download, Loader2 } from 'lucide-react';
import { flushSync } from 'react-dom';
import type { User } from '../lib/api';
import { downloadPdf } from '../lib/pdf';
import { QuoteDocument } from './QuoteDocument';
import { api, baht, Quote, QuoteStatus , type Project } from '../lib/api';
import { DateRange, inDateRange, nextSort, Pagination, SortHeader, sortRows, usePaged, type Sort } from './ListTools';

/** the local calendar day a UTC timestamp falls on, as YYYY-MM-DD */
const localDay = (utc: string) => {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const STATUS_ORDER: QuoteStatus[] = ['draft', 'sent', 'approved', 'rejected', 'expired'];

interface AllQuotesProps {
  onNavigate?: (page: string) => void;
  onOpenQuote: (quoteId: string | null, preview?: boolean) => void;
  /** opens a job on its cost step */
  onOpenProjectCosts: (project: Project) => void;
  user: User;
}

export function AllQuotes({ onNavigate, onOpenQuote, onOpenProjectCosts, user }: AllQuotesProps) {
  const [pdfQuote, setPdfQuote] = useState<Quote | null>(null);
  const pdfRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'date', dir: 'desc' });
  const [notification, setNotification] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.quotes()
      .then(setQuotes)
      .catch((err) => showNotification(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredQuotes = quotes.filter(quote => {
    const matchesSearch = quote.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         quote.projectTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         quote.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || quote.status === statusFilter;
    return matchesSearch && matchesStatus && inDateRange(localDay(quote.createdAt), dateFrom, dateTo);
  });

  const getStatusStyles = (status: string) => statusPill(status);

  const getStatsByStatus = (status: string) => {
    return quotes.filter(q => q.status === status).length;
  };

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  /** what each sortable column orders by */
  const sortValue: Record<string, (q: Quote) => string | number> = {
    code: (q) => q.code,
    title: (q) => q.projectTitle,
    client: (q) => q.clientName,
    date: (q) => Number(q.id),
    validUntil: (q) => q.validUntil,
    amount: (q) => q.totalAmount,
    status: (q) => STATUS_ORDER.indexOf(q.status),
  };
  /** numbers and dates start biggest/newest first, text starts A→Z */
  const firstDir = (key: string): Sort['dir'] => (['date', 'validUntil', 'amount'].includes(key) ? 'desc' : 'asc');
  const sortBy = (key: string, dir = firstDir(key)) => setSort((cur) => nextSort(cur, key, dir));
  const sortedQuotes = sortRows(filteredQuotes, sortValue[sort.key] ?? sortValue.date, sort.dir);
  const paged = usePaged(sortedQuotes, [searchTerm, statusFilter, dateFrom, dateTo, sort.key, sort.dir].join('|'));

  const changeStatus = async (quote: Quote, status: QuoteStatus) => {
    try {
      const saved = await api.updateQuote(quote.id, { status });
      setQuotes(list => list.map(q => (q.id === saved.id ? saved : q)));
      // the client said yes to a quote written on its own: offer to turn it into a job and go fill in its costs
      if (saved.status === 'approved' && quote.status !== 'approved' && !saved.projectId && saved.totalAmount > 0
        && window.confirm(`${saved.code} อนุมัติแล้ว\nสร้างโปรเจ็กต์จากใบเสนอราคานี้ แล้วไปใส่ต้นทุนเลยไหม?\n(ข้อมูลงานและรายการจะถูกดึงมาให้ ไม่ต้องกรอกใหม่)`)) {
        onOpenProjectCosts(await api.createProjectFromQuote(saved.id));
        return;
      }
      showNotification(
        saved.status === 'expired' && status !== 'expired'
          ? `${saved.code} เลยวันที่ใช้ได้แล้ว กด "แก้ไข" เพื่อเลื่อนวันที่ใช้ได้ถึงก่อน`
          : `อัปเดต ${saved.code} เป็น "${saved.statusText}" แล้ว`
      );
    } catch (err) {
      showNotification((err as Error).message);
    }
  };

  const deleteQuote = async (quote: Quote) => {
    if (!window.confirm(`ลบใบเสนอราคา ${quote.code} ใช่หรือไม่?`)) return;
    try {
      await api.deleteQuote(quote.id);
      setQuotes(list => list.filter(q => q.id !== quote.id));
      showNotification(`ลบใบเสนอราคา ${quote.code} แล้ว`);
    } catch (err) {
      showNotification((err as Error).message);
    }
  };

  const exportPdf = async (quote: Quote) => {
    // render the document off-screen, capture it, then drop it again
    flushSync(() => setPdfQuote(quote));
    try {
      if (pdfRef.current) await downloadPdf(pdfRef.current, `${quote.code}${quote.clientName ? '-' + quote.clientName : ''}`);
    } catch {
      showNotification('สร้างไฟล์ PDF ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setPdfQuote(null);
    }
  };

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 md:mb-8 gap-4">
        <div>
          <h1 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight">ใบเสนอราคา</h1>
          <p className="text-sm text-ink-muted mt-1">จัดการใบเสนอราคาของคุณ</p>
        </div>
        <div className="flex gap-2 w-full lg:w-auto">
          <button 
            onClick={() => onOpenQuote(null)}
            className="pb-btn-primary flex-1 lg:flex-none whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            สร้างใบเสนอราคา
          </button>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
        {[{ id: 'all', label: 'ทั้งหมด', count: quotes.length }, { id: 'draft', label: 'ร่าง', count: getStatsByStatus('draft') }, { id: 'sent', label: 'ส่งแล้ว', count: getStatsByStatus('sent') }, { id: 'approved', label: 'อนุมัติแล้ว', count: getStatsByStatus('approved') }, { id: 'rejected', label: 'ปฏิเสธ', count: getStatsByStatus('rejected') }, { id: 'expired', label: 'หมดอายุ', count: getStatsByStatus('expired') }].map(chip => (
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

      {/* Search and Filters */}
      <div className="pb-card p-3 md:p-4 mb-6 md:mb-8">
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-ink-muted w-5 h-5" />
            <input
              type="text"
              placeholder="ค้นหาใบเสนอราคา, ลูกค้า, หรือรหัส..."
              className="pb-input pl-10 pr-4"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-2 px-3 py-1.5 -ml-1 text-sm text-ink-muted hover:text-ink rounded-full"
            >
              <Filter className="w-4 h-4" />
              {showFilters ? "ซ่อนตัวเลือก" : "ช่วงเวลาและการเรียง"}
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
              <select 
                className="pb-input text-ink-muted"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">สถานะทั้งหมด</option>
                <option value="draft">ร่าง</option>
                <option value="sent">ส่งแล้ว</option>
                <option value="approved">อนุมัติแล้ว</option>
                <option value="rejected">ปฏิเสธ</option>
                <option value="expired">หมดอายุ</option>
              </select>
              <DateRange label="วันที่สร้าง" from={dateFrom} to={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
              <select 
                className="pb-input text-ink-muted"
                value={sort.key}
                onChange={(e) => setSort({ key: e.target.value, dir: firstDir(e.target.value) })}
              >
                <option value="date">เรียงตามวันที่</option>
                <option value="amount">เรียงตามจำนวนเงิน</option>
                <option value="status">เรียงตามสถานะ</option>
                <option value="client">เรียงตามลูกค้า</option>
                <option value="title">เรียงตามชื่องาน</option>
                <option value="validUntil">เรียงตามวันที่ใช้ได้ถึง</option>
                <option value="code">เรียงตามรหัส</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {loading && <div className="text-center text-ink py-12">กำลังโหลด...</div>}
      {!loading && sortedQuotes.length === 0 && (
        <div className="pb-card p-10 text-center mb-8">
          <p className="text-ink-muted mb-4">{quotes.length === 0 ? 'ยังไม่มีใบเสนอราคา' : 'ไม่พบใบเสนอราคาที่ตรงกับเงื่อนไข'}</p>
          {quotes.length === 0 && (
            <button onClick={() => onOpenQuote(null)} className="pb-btn-primary">
              สร้างใบเสนอราคาแรก
            </button>
          )}
        </div>
      )}

      {/* Table (desktop) */}
      {paged.rows.length > 0 && (
        <div className="hidden md:block pb-card overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-canvas/60 border-b border-line">
                  <SortHeader label="รหัส" sortKey="code" sort={sort} onSort={sortBy} className="hidden 2xl:table-cell" />
                  <SortHeader label="งาน" sortKey="title" sort={sort} onSort={sortBy} />
                  <SortHeader label="ลูกค้า" sortKey="client" sort={sort} onSort={sortBy} />
                  <SortHeader label="วันที่สร้าง" sortKey="date" sort={sort} onSort={sortBy} firstDir="desc" />
                  <SortHeader label="ใช้ได้ถึง" sortKey="validUntil" sort={sort} onSort={sortBy} firstDir="desc" />
                  <SortHeader label="จำนวนเงิน" sortKey="amount" sort={sort} onSort={sortBy} align="right" firstDir="desc" />
                  <SortHeader label="สถานะ" sortKey="status" sort={sort} onSort={sortBy} />
                  <th className="px-2 py-3 text-center text-ink font-medium">การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((quote) => (
                  <tr key={quote.id} onClick={() => onOpenQuote(quote.id, true)} className="border-b border-line last:border-b-0 hover:bg-canvas/60 cursor-pointer">
                    <td className="hidden 2xl:table-cell px-3 py-3 text-ink-muted whitespace-nowrap">{quote.code}</td>
                    <td className="px-2 2xl:px-3 py-3 font-medium text-ink max-w-[16rem]">
                      <span className="line-clamp-2">{quote.projectTitle || '-'}</span>
                      <span className="2xl:hidden block mt-0.5 text-xs font-normal text-ink-muted whitespace-nowrap">{quote.code}</span>
                    </td>
                    <td className="px-2 2xl:px-3 py-3 text-ink max-w-[10rem] truncate">{quote.clientName}</td>
                    <td className="px-2 2xl:px-3 py-3 text-ink whitespace-nowrap">{quote.createdDate}</td>
                    <td className="px-2 2xl:px-3 py-3 text-ink whitespace-nowrap">{quote.validUntilText || '-'}</td>
                    <td className="px-2 2xl:px-3 py-3 text-right font-medium text-ink whitespace-nowrap">{baht(quote.totalAmount, Number.isInteger(quote.totalAmount) ? 0 : 2)}</td>
                    <td className="px-2 2xl:px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={quote.status}
                        onChange={(e) => changeStatus(quote, e.target.value as QuoteStatus)}
                        title="เปลี่ยนสถานะ"
                        className={`px-3 py-1 rounded-full text-xs font-medium border cursor-pointer outline-none whitespace-nowrap ${getStatusStyles(quote.status)}`}
                      >
                        <option value="draft">ร่าง</option>
                        <option value="sent">ส่งแล้ว</option>
                        <option value="approved">อนุมัติแล้ว</option>
                        <option value="rejected">ปฏิเสธ</option>
                        {quote.status === 'expired' && <option value="expired" disabled>หมดอายุ</option>}
                      </select>
                    </td>
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => onOpenQuote(quote.id, true)} aria-label="ดูใบเสนอราคา" title="ดู" className="flex items-center justify-center w-8 h-8 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => onOpenQuote(quote.id)} aria-label="แก้ไขใบเสนอราคา" title="แก้ไข" className="flex items-center justify-center w-8 h-8 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => exportPdf(quote)} disabled={!!pdfQuote} aria-label="ดาวน์โหลด PDF" title="ดาวน์โหลด PDF" className="flex items-center justify-center w-8 h-8 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors disabled:opacity-60">
                          {pdfQuote?.id === quote.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        </button>
                        <button onClick={() => deleteQuote(quote)} aria-label="ลบใบเสนอราคา" title="ลบ" className="flex items-center justify-center w-8 h-8 bg-rose-50 text-rose-600 rounded-full hover:bg-rose-100 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cards (phones) */}
      <div className="md:hidden grid grid-cols-1 gap-4 mb-6">
        {paged.rows.map((quote) => (
          <div
            key={quote.id}
            className="pb-card cursor-pointer transition-all duration-300 overflow-hidden"
          >
            {/* Quote Header */}
            <div className="p-4 md:p-6 border-b border-line">
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base md:text-lg text-ink mb-1 line-clamp-2 font-semibold">{quote.projectTitle}</h3>
                  <p className="text-sm text-ink-muted">รหัส: {quote.code}</p>
                </div>
                <select
                  value={quote.status}
                  onChange={(e) => changeStatus(quote, e.target.value as QuoteStatus)}
                  title="เปลี่ยนสถานะ"
                  className={`px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium border ml-2 cursor-pointer outline-none whitespace-nowrap ${getStatusStyles(quote.status)}`}
                >
                  <option value="draft">ร่าง</option>
                  <option value="sent">ส่งแล้ว</option>
                  <option value="approved">อนุมัติแล้ว</option>
                  <option value="rejected">ปฏิเสธ</option>
                  {quote.status === 'expired' && <option value="expired" disabled>หมดอายุ</option>}
                </select>
              </div>
              <div className="text-xs md:text-sm text-ink-muted">
                ลูกค้า: <span className="font-medium text-ink">{quote.clientName}</span>
              </div>
            </div>

            {/* Quote Body */}
            <div className="p-4 md:p-6">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-xs text-ink-muted mb-1">จำนวนเงิน</div>
                  <div className="font-medium text-ink text-sm md:text-base">
                    {baht(quote.totalAmount, Number.isInteger(quote.totalAmount) ? 0 : 2)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted mb-1">รายการ</div>
                  <div className="font-medium text-ink text-sm md:text-base">
                    {quote.itemCount} รายการ
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted mb-1">วันที่สร้าง</div>
                  <div className="font-medium text-ink text-sm md:text-base">
                    {quote.createdDate}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted mb-1">ใช้ได้ถึง</div>
                  <div className="font-medium text-ink text-sm md:text-base">
                    {quote.validUntilText || '-'}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                <button onClick={() => onOpenQuote(quote.id, true)} className="flex items-center justify-center gap-1.5 py-2 px-2 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors text-sm">
                  <Eye className="w-4 h-4" />
                  <span className="hidden md:inline">ดู</span>
                </button>
                <button onClick={() => onOpenQuote(quote.id)} className="flex items-center justify-center gap-1.5 py-2 px-2 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors text-sm">
                  <Edit className="w-4 h-4" />
                  <span className="hidden md:inline">แก้ไข</span>
                </button>
                <button onClick={() => exportPdf(quote)} disabled={!!pdfQuote} className="flex items-center justify-center gap-1.5 py-2 px-2 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors text-sm disabled:opacity-60" title="ดาวน์โหลด PDF">
                  {pdfQuote?.id === quote.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  PDF
                </button>
                <button onClick={() => deleteQuote(quote)} aria-label="ลบใบเสนอราคา" title="ลบ" className="flex items-center justify-center w-9 bg-rose-50 text-rose-600 rounded-full hover:bg-rose-100 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Pagination paged={paged} unit="ใบเสนอราคา" />

      {/* Notification */}
      {notification && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-ink text-white px-5 py-3 rounded-full shadow-soft-xl z-50 animate-toast text-sm">
          {notification}
        </div>
      )}

      {/* Empty State */}
      {filteredQuotes.length === 0 && (
        <div className="text-center py-12 md:py-16">
          <div className="text-ink-muted mb-4">
            <svg className="mx-auto h-8 w-8 md:h-12 md:w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-base md:text-lg font-medium text-ink mb-2">ไม่พบใบเสนอราคา</h3>
          <p className="text-sm md:text-base text-ink-muted">ลองเปลี่ยนคำค้นหาหรือตัวกรองของคุณ</p>
        </div>
      )}
      {pdfQuote && (
        <div aria-hidden className="fixed top-0 pointer-events-none" style={{ left: -10000 }}>
          <QuoteDocument
            ref={pdfRef}
            user={user}
            quote={{ ...pdfQuote, validUntil: pdfQuote.validUntil, items: pdfQuote.items }}
          />
        </div>
      )}
    </div>
  );
}