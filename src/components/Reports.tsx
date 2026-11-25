import React, { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, Wallet, FolderOpen, Download } from 'lucide-react';
import { PROFIT_COLOR, SALES_COLOR, SalesChart } from './SalesChart';
import { StatsCard } from './StatsCard';
import { api, baht, type Project, Reports as ReportsData, type SalesSum, type User } from '../lib/api';
import { review } from '../lib/decision';
import { rulesOf, toJob } from '../lib/job';
import { brandName } from '../lib/brand';
import { downloadXlsx } from '../lib/xlsx';
import { DateRange, Pagination, usePaged } from './ListTools';

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const thaiDay = (iso: string) => new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
/** Margin = profit ÷ sales */
const marginOf = (x: { sales: number; profit: number }) => (x.sales > 0 ? (x.profit / x.sales) * 100 : 0);

/** the date ranges offered as one-tap shortcuts */
const presets = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { id: 'month', label: 'เดือนนี้', from: isoDay(new Date(y, m, 1)), to: isoDay(new Date(y, m + 1, 0)) },
    { id: 'last-month', label: 'เดือนที่แล้ว', from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) },
    { id: 'year', label: 'ปีนี้', from: `${y}-01-01`, to: `${y}-12-31` },
    { id: 'all', label: 'ทั้งหมด', from: '', to: '' },
  ];
};

interface ReportsProps {
  user: User;
  onOpenProject: (p: Project) => void;
}

export function Reports({ user, onOpenProject }: ReportsProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<ReportsData | null>(null);
  const [error, setError] = useState('');
  const [chartType, setChartType] = useState<'line' | 'bar'>('bar');
  // the sales report opens on the current year
  const [range, setRange] = useState(() => {
    const year = presets().find((p) => p.id === 'year')!;
    return { from: year.from, to: year.to };
  });
  // the chart's year: the current one until another is picked
  const [chartYear, setChartYear] = useState<number | undefined>(undefined);
  const [salesView, setSalesView] = useState<'month' | 'customer'>('month');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.projects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    let stale = false;
    api.reports(range.from, range.to, chartYear)
      .then((d) => !stale && setData(d))
      .catch((err) => !stale && setError(err.message));
    return () => {
      stale = true;
    };
  }, [range.from, range.to, chartYear]);

  const rules = rulesOf(user);
  const actuals = projects
    .map((p) => ({ p, r: review(toJob(p), rules) }))
    .filter(({ r }) => r.recorded);
  const report = data?.sales;
  const salesRows: Array<SalesSum & { key: string; label: string }> = !report
    ? []
    : salesView === 'month'
      ? report.byMonth.map((m) => ({ ...m, label: m.month }))
      : report.byCustomer.map((c, i) => ({ ...c, key: c.customerId ?? `n${i}`, label: c.name || 'ไม่ระบุลูกค้า' }));
  // 10 rows a page; a new date range or view starts again on page 1
  const salesPaged = usePaged(salesRows, [range.from, range.to, salesView].join('|'));
  const actualsPaged = usePaged(actuals, '');

  if (error) return <div className="p-8 text-red-600">{error}</div>;
  if (!data) return <div className="p-8 text-center text-ink">กำลังโหลด...</div>;

  // Margin = profit ÷ sales (not ÷ cost, which would be the markup)
  const margin = data.totals.sales > 0 ? (data.totals.profit / data.totals.sales) * 100 : 0;
  const lostTotal = actuals.reduce((s, { r }) => s + r.lost, 0);
  const maxStatus = Math.max(1, ...data.byStatus.map((s) => s.count));

  const sales = data.sales;
  const rangeText = range.from && range.to ? `${thaiDay(range.from)} – ${thaiDay(range.to)}` : range.from ? `ตั้งแต่ ${thaiDay(range.from)}` : range.to ? `ถึง ${thaiDay(range.to)}` : 'ทุกช่วงเวลา';

  const exportExcel = async () => {
    setExporting(true);
    try {
      const head = ['จำนวนงาน', 'ยอดขาย (บาท)', 'ต้นทุน (บาท)', 'กำไร (บาท)', 'Margin (%)'];
      const figures = (x: { jobs: number; sales: number; cost: number; profit: number }) => [x.jobs, x.sales, x.cost, x.profit, Math.round(marginOf(x) * 10) / 10];
      await downloadXlsx(`รายงานยอดขาย-${range.from || 'เริ่มต้น'}-ถึง-${range.to || 'ล่าสุด'}`, [
        {
          name: 'รายเดือน',
          widths: [18, 12, 16, 16, 16, 12],
          boldLastRow: true,
          rows: [['เดือน', ...head], ...sales.byMonth.map((m) => [m.month, ...figures(m)]), ['รวม', ...figures(sales.totals)]],
        },
        {
          name: 'รายลูกค้า',
          widths: [30, 12, 16, 16, 16, 12],
          boldLastRow: true,
          rows: [['ลูกค้า', ...head], ...sales.byCustomer.map((c) => [c.name || 'ไม่ระบุลูกค้า', ...figures(c)]), ['รวม', ...figures(sales.totals)]],
        },
        {
          name: 'รายการงาน',
          widths: [14, 16, 34, 26, 14, 16, 16, 16, 12],
          boldLastRow: true,
          rows: [
            ['วันที่จัดงาน', 'รหัส', 'โปรเจ็กต์', 'ลูกค้า', 'สถานะ', 'ยอดขาย (บาท)', 'ต้นทุน (บาท)', 'กำไร (บาท)', 'Margin (%)'],
            ...sales.jobs.map((j) => [j.date, j.code, j.title, j.customer || 'ไม่ระบุลูกค้า', j.statusText, j.sales, j.cost, j.profit, Math.round(marginOf(j) * 10) / 10]),
            ['รวม', '', '', '', '', sales.totals.sales, sales.totals.cost, sales.totals.profit, Math.round(marginOf(sales.totals) * 10) / 10],
          ],
        },
        { name: 'ข้อมูลรายงาน', widths: [22, 44], rows: [['รายการ', 'ค่า'], ['ร้าน', brandName(user)], ['ช่วงวันที่', rangeText], ['นับยอดจาก', 'โปรเจ็กต์ที่อนุมัติแล้วหรือเสร็จสิ้น ตามวันที่จัดงาน'], ['ออกรายงานเมื่อ', new Date().toLocaleString('th-TH')]] },
      ]);
    } catch {
      setError('สร้างไฟล์ Excel ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="p-5 md:p-10 pb-28 md:pb-10">
        <div className="mb-8">
          <h1 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight">รายงาน</h1>
          <p className="text-sm text-ink-muted mt-1">สรุปยอดขายและกำไรจากโปรเจ็กต์ที่อนุมัติ/เสร็จสิ้นแล้วทั้งหมด</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
          <StatsCard icon={DollarSign} iconBg="bg-violet-50 text-[#673AB7]" value={baht(data.totals.sales)} label="ยอดขายรวม" change="ทุกช่วงเวลา" positive />
          <StatsCard icon={TrendingUp} iconBg="bg-amber-50 text-amber-500" value={baht(data.totals.profit)} label="กำไรรวม" change={`Margin เฉลี่ย ${margin.toFixed(1)}%`} positive />
          <StatsCard icon={Wallet} iconBg="bg-violet-50 text-[#673AB7]" value={baht(data.totals.cost)} label="ต้นทุนรวม" change="จากรายการต้นทุน" positive />
          <StatsCard icon={FolderOpen} iconBg="bg-amber-50 text-amber-500" value={String(data.totals.projects)} label="โปรเจ็กต์ทั้งหมด" change="ทุกสถานะ" positive />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8 mb-8">
          <div className="pb-card lg:col-span-2 p-6 md:p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
              <div>
                <h3 className="text-base md:text-lg text-ink mb-1 font-semibold">ยอดขายและกำไรรายเดือน</h3>
                <p className="text-sm text-ink-muted">นับตามวันที่จัดงาน</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="ปีของกราฟ"
                  className="pb-input pb-input-sm w-auto"
                  value={data.chartYear}
                  onChange={(e) => setChartYear(Number(e.target.value))}
                >
                  {data.chartYears.map((y) => (
                    <option key={y} value={y}>ปี {y + 543}</option>
                  ))}
                </select>
                <div className="flex bg-canvas rounded-full p-1">
                  {(['line', 'bar'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setChartType(t)}
                      className={`px-3 py-1.5 text-xs rounded-full transition-colors ${chartType === t ? 'bg-white text-ink shadow-card font-medium' : 'text-ink-muted hover:text-ink'}`}
                    >
                      {t === 'line' ? 'เส้น' : 'แท่ง'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: SALES_COLOR }} />
                {chartType === 'bar' ? 'ยอดขาย (ความสูงทั้งแท่ง)' : 'ยอดขาย'}
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: PROFIT_COLOR }} />
                {chartType === 'bar' ? 'กำไร (ส่วนหนึ่งของยอดขาย)' : 'กำไร'}
              </span>
            </div>
            <SalesChart chartType={chartType} data={data.chart} stacked />
          </div>

          <div className="pb-card p-6 md:p-8">
            <h3 className="text-base md:text-lg text-ink mb-6 font-semibold">โปรเจ็กต์ตามสถานะ</h3>
            <div className="space-y-4">
              {data.byStatus.map((s) => (
                <div key={s.status}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-ink-muted">{s.statusText}</span>
                    <span className="text-ink font-medium">{s.count}</span>
                  </div>
                  <div className="w-full bg-[#F1F0F5] rounded-full h-1.5">
                    <div className="bg-[#673AB7] h-1.5 rounded-full" style={{ width: `${(s.count / maxStatus) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sales report: by month or by customer, for a chosen date range */}
        <div className="pb-card p-6 md:p-8 mb-8">
          <div className="flex flex-col lg:flex-row justify-between items-start gap-4 mb-5">
            <div>
              <h3 className="text-base md:text-lg font-semibold text-ink">รายงานยอดขาย</h3>
              <p className="text-sm text-ink-muted">ยอดขาย ต้นทุน และกำไร จากโปรเจ็กต์ที่อนุมัติ/เสร็จสิ้น นับตามวันที่จัดงาน</p>
            </div>
            <button onClick={exportExcel} disabled={exporting} className="pb-btn-secondary shrink-0 disabled:opacity-60">
              <Download className="w-4 h-4" />
              {exporting ? 'กำลังสร้างไฟล์...' : 'ส่งออก Excel'}
            </button>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-5">
            <DateRange label="วันที่จัดงาน" from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
            <div className="no-scrollbar flex gap-1 overflow-x-auto">
              {presets().map((p) => {
                const active = p.from === range.from && p.to === range.to;
                return (
                  <button
                    key={p.id}
                    onClick={() => setRange({ from: p.from, to: p.to })}
                    aria-pressed={active}
                    className={`shrink-0 px-3 py-1.5 text-xs rounded-full transition-colors ${active ? 'bg-violet-50 text-[#673AB7] font-medium' : 'text-ink-muted hover:text-ink hover:bg-[#F1F0F5]'}`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-5 text-sm">
            {([
              ['ยอดขาย', baht(sales.totals.sales)],
              ['ต้นทุน', baht(sales.totals.cost)],
              ['กำไร', baht(sales.totals.profit)],
              ['Margin', `${marginOf(sales.totals).toFixed(1)}%`],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-[#F7F6FA] px-3 py-2">
                <p className="text-xs text-ink-muted">{label}</p>
                <p className="font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
            <div className="flex bg-canvas rounded-full p-1 shrink-0">
              {(['month', 'customer'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setSalesView(v)}
                  className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-colors ${salesView === v ? 'bg-white text-ink shadow-card font-medium' : 'text-ink-muted hover:text-ink'}`}
                >
                  {v === 'month' ? 'รายเดือน' : 'รายลูกค้า'}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-muted text-right">{rangeText} · {sales.totals.jobs} งาน</p>
          </div>

          {data.uncosted.count > 0 && (
            <p className="mb-4 px-4 py-3 rounded-2xl bg-amber-50 text-amber-700 text-sm">
              มี {data.uncosted.count} งานที่ลูกค้าตกลงแล้วแต่ยังไม่ได้ใส่ต้นทุน (ราคารวม {baht(data.uncosted.sales)}) ยังไม่นับในรายงาน จนกว่าจะใส่ต้นทุน
            </p>
          )}

          {salesRows.length === 0 ? (
            <p className="text-sm text-ink-muted py-4">ไม่มีงานที่อนุมัติหรือเสร็จสิ้นในช่วงวันที่นี้</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-canvas/60 border-b border-line text-ink">
                    <th className="text-left p-3 font-medium">{salesView === 'month' ? 'เดือน' : 'ลูกค้า'}</th>
                    <th className="text-right p-3 font-medium">งาน</th>
                    <th className="text-right p-3 font-medium">ยอดขาย</th>
                    <th className="text-right p-3 font-medium">ต้นทุน</th>
                    <th className="text-right p-3 font-medium">กำไร</th>
                    <th className="text-right p-3 font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {salesPaged.rows.map((r) => (
                    <tr key={r.key} className="border-b border-line">
                      <td className="p-3 text-ink-muted whitespace-nowrap">{r.label}</td>
                      <td className="p-3 text-right">{r.jobs}</td>
                      <td className="p-3 text-right text-ink font-medium whitespace-nowrap">{baht(r.sales)}</td>
                      <td className="p-3 text-right whitespace-nowrap">{baht(r.cost)}</td>
                      <td className="p-3 text-right text-emerald-600 font-medium whitespace-nowrap">{baht(r.profit)}</td>
                      <td className="p-3 text-right">{marginOf(r).toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr className="font-semibold text-ink">
                    <td className="p-3">รวม</td>
                    <td className="p-3 text-right">{sales.totals.jobs}</td>
                    <td className="p-3 text-right whitespace-nowrap">{baht(sales.totals.sales)}</td>
                    <td className="p-3 text-right whitespace-nowrap">{baht(sales.totals.cost)}</td>
                    <td className="p-3 text-right text-emerald-600 whitespace-nowrap">{baht(sales.totals.profit)}</td>
                    <td className="p-3 text-right">{marginOf(sales.totals).toFixed(1)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <Pagination paged={salesPaged} unit={salesView === 'month' ? 'เดือน' : 'ลูกค้า'} className="mt-4" />
        </div>

        <div className="pb-card p-6 md:p-8 mb-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-2 mb-5">
            <div>
              <h3 className="text-base md:text-lg font-semibold text-ink">ประมาณการ vs เกิดขึ้นจริง</h3>
              <p className="text-sm text-ink-muted">งานที่กรอกต้นทุนจริงแล้ว — ดูว่ากำไรหายไปตรงไหน</p>
            </div>
            {actuals.length > 0 && (
              <p className={`text-sm font-semibold ${lostTotal > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {lostTotal > 0 ? `กำไรหายไปรวม ${baht(lostTotal)}` : `กำไรเกินคาดรวม ${baht(-lostTotal)}`}
              </p>
            )}
          </div>
          {actuals.length === 0 ? (
            <p className="text-sm text-ink-muted">ยังไม่มีงานที่กรอกต้นทุนจริง — กรอกได้ในงานแต่ละงาน ขั้น "ติดตามต้นทุนจริง"</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-ink-muted border-b border-line">
                    <th className="py-2.5 pr-3 font-medium">งาน</th>
                    <th className="py-2.5 px-3 font-medium text-right">ราคาเสนอ</th>
                    <th className="py-2.5 px-3 font-medium text-right">กำไรที่คาด</th>
                    <th className="py-2.5 px-3 font-medium text-right">กำไรจริง</th>
                    <th className="py-2.5 pl-3 font-medium">สาเหตุหลัก</th>
                  </tr>
                </thead>
                <tbody>
                  {actualsPaged.rows.map(({ p, r }) => (
                    <tr key={p.id} className="border-b border-line last:border-0 hover:bg-[#FBFAFD] cursor-pointer" onClick={() => onOpenProject(p)}>
                      <td className="py-3 pr-3 text-ink font-medium">{p.title}</td>
                      <td className="py-3 px-3 text-right">{baht(r.quoted)}</td>
                      <td className="py-3 px-3 text-right">{baht(r.expectedProfit)}</td>
                      <td className={`py-3 px-3 text-right font-semibold ${r.actualProfit < r.expectedProfit ? 'text-rose-600' : 'text-emerald-600'}`}>{baht(r.actualProfit)}</td>
                      <td className="py-3 pl-3 text-ink-muted">{r.overruns[0] ? `${r.overruns[0].name} +${baht(r.overruns[0].diff)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination paged={actualsPaged} unit="งาน" className="mt-4" />
        </div>

        <div className="pb-card p-6 md:p-8">
          <h3 className="text-base md:text-lg text-ink mb-6 font-semibold">แยกตามประเภทงาน</h3>
          {data.byType.length === 0 ? (
            <p className="text-sm text-ink-muted">ยังไม่มีข้อมูล</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-canvas/60 border-b border-line text-ink">
                    <th className="text-left p-3 font-medium">ประเภท</th>
                    <th className="text-right p-3 font-medium">โปรเจ็กต์</th>
                    <th className="text-right p-3 font-medium">ปิดการขาย</th>
                    <th className="text-right p-3 font-medium">ยอดขาย</th>
                    <th className="text-right p-3 font-medium">กำไร</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byType.map((t) => (
                    <tr key={t.type} className="border-b border-line">
                      <td className="p-3 text-ink-muted">{t.type}</td>
                      <td className="p-3 text-right">{t.projects}</td>
                      <td className="p-3 text-right">{t.sold}</td>
                      <td className="p-3 text-right text-ink font-medium">{baht(t.sales)}</td>
                      <td className="p-3 text-right text-emerald-600 font-medium">{baht(t.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
