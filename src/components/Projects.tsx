import { statusPill, struck } from './ProjectItem';
import React, { useEffect, useMemo, useState } from 'react';
import { Search, Filter, Plus, Eye, Edit, Trash2, Download, FileBarChart, Archive } from 'lucide-react';
import { getProgressFromStatus } from '../App';
import { api, Project, ProjectStatus, type User } from '../lib/api';
import { LEVEL_STYLE, PROJECT_TYPES, projectHealth } from '../lib/job';
import { DateRange, inDateRange, nextSort, Pagination, SortHeader, sortRows, usePaged, type Sort } from './ListTools';
import { PROJECT_STATUS_OPTIONS, projectStatusBlock, StatusDialog } from './StatusDialog';

interface ProjectsProps {
  onProjectSelect: (project: Project, edit?: boolean) => void;
  onNavigate: (page: string) => void;
  user: User;
}

export function Projects({ onProjectSelect, onNavigate, user }: ProjectsProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState<Sort>({ key: 'eventDate', dir: 'desc' });
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [notification, setNotification] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.projects()
      .then(setProjects)
      .catch((err) => showNotification(err.message))
      .finally(() => setLoading(false));
  }, []);

  const statusOrder: ProjectStatus[] = PROJECT_STATUS_OPTIONS.map((o) => o.id);

  const healthOf = useMemo(() => new Map(projects.map((p) => [p.id, projectHealth(p, user)])), [projects, user]);

  /** what each sortable column orders by */
  const sortValue: Record<string, (p: Project) => string | number> = {
    code: (p) => p.code,
    title: (p) => p.title,
    client: (p) => p.client,
    eventDate: (p) => p.eventDate,
    budget: (p) => p.budget,
    price: (p) => healthOf.get(p.id)?.price ?? 0,
    margin: (p) => healthOf.get(p.id)?.margin ?? 0,
    score: (p) => healthOf.get(p.id)?.score ?? 0,
    status: (p) => statusOrder.indexOf(p.status),
  };
  /** numbers and dates start biggest/newest first, text starts A→Z */
  const firstDir = (key: string): Sort['dir'] => (['eventDate', 'budget', 'price', 'margin', 'score'].includes(key) ? 'desc' : 'asc');
  const sortBy = (key: string, dir = firstDir(key)) => setSort((cur) => nextSort(cur, key, dir));

  const term = searchTerm.trim().toLowerCase();
  const filteredProjects = sortRows(
    projects.filter((project) => {
      const matchesSearch = [project.title, project.code, project.client].some((v) => v.toLowerCase().includes(term));
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const matchesType = typeFilter === 'all' || project.projectType === typeFilter;
      return matchesSearch && matchesStatus && matchesType && inDateRange(project.eventDate, dateFrom, dateTo);
    }),
    sortValue[sort.key] ?? sortValue.eventDate,
    sort.dir,
  );
  const paged = usePaged(filteredProjects, [term, statusFilter, typeFilter, dateFrom, dateTo, sort.key, sort.dir].join('|'));
  /** the kinds to filter by: the usual ones, and any other a job of the shop has */
  const typeOptions = [...PROJECT_TYPES, ...[...new Set(projects.map((p) => p.projectType))].filter((t) => t && !PROJECT_TYPES.includes(t))];

  const getStatusStyles = (status: string) => statusPill(status);

  const getStatsByStatus = (status: string) => {
    return projects.filter(p => p.status === status).length;
  };

  const openStatusModal = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedProject(project);
    setIsStatusModalOpen(true);
  };

  const closeStatusModal = () => {
    setIsStatusModalOpen(false);
    setSelectedProject(null);
  };

  const updateProjectStatus = async (newStatus: string) => {
    if (!selectedProject) return;
    try {
      const saved = await api.updateProject(selectedProject.id, { status: newStatus as ProjectStatus });
      setProjects(list => list.map(p => (p.id === saved.id ? saved : p)));
      // the job's quote goes with it
      showNotification(`อัปเดตสถานะโปรเจ็กต์ ${saved.code} เรียบร้อยแล้ว${saved.quote && newStatus !== 'completed' ? ` ใบเสนอราคา ${saved.quote.code} เป็น "${saved.quote.statusText}"` : ''}`);
    } catch (err) {
      showNotification((err as Error).message);
    }
    closeStatusModal();
  };

  const deleteProject = async (project: Project) => {
    if (!window.confirm(`ลบโปรเจ็กต์ "${project.title}" ใช่หรือไม่?`)) return;
    try {
      await api.deleteProject(project.id);
      setProjects(list => list.filter(p => p.id !== project.id));
      showNotification(`ลบโปรเจ็กต์ ${project.code} เรียบร้อยแล้ว`);
    } catch (err) {
      showNotification((err as Error).message);
    }
  };

  const exportCsv = () => {
    const header = ['รหัส', 'ชื่อโปรเจ็กต์', 'ประเภท', 'ลูกค้า', 'เบอร์โทร', 'อีเมล', 'วันที่จัดงาน', 'งบลูกค้า', 'ต้นทุน', 'ราคาขาย', 'กำไร', 'Margin (%)', 'คะแนนสุขภาพ', 'สถานะ'];
    const rows = filteredProjects.map(p => {
      const h = projectHealth(p, user);
      return [p.code, p.title, p.projectType, p.client, p.phone, p.email, p.eventDate, p.budget, Math.round(h.cost), Math.round(h.price), Math.round(h.profit), h.margin.toFixed(1), h.score, p.statusText];
    });
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `projects-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleProjectClick = (project: Project) => {
    onProjectSelect(project);
  };

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(''), 3000);
  };

  const formatEventDate = (dateString: string) => {
    if (!dateString) return "ยังไม่กำหนด";
    const date = new Date(dateString);
    return date.toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  };

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 md:mb-8 gap-4">
        <div><h1 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight">โปรเจ็กต์</h1><p className="text-sm text-ink-muted mt-1">งานทั้งหมดของคุณ แตะรายการเพื่อดูรายละเอียด</p></div>
        <div className="flex gap-2 w-full lg:w-auto">
          <button onClick={exportCsv} aria-label="ส่งออก CSV" className="pb-btn-secondary shrink-0">
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">ส่งออก CSV</span>
          </button>
          <button onClick={() => onNavigate('new-project')} className="pb-btn-primary flex-1 lg:flex-none whitespace-nowrap">
            <Plus className="w-4 h-4" />
            สร้างโปรเจ็กต์ใหม่
          </button>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1 mb-4 -mx-1 px-1">
        {[{ id: 'all', label: 'ทั้งหมด', count: projects.length }, { id: 'draft', label: 'ร่าง', count: getStatsByStatus('draft') }, { id: 'quote_created', label: 'มีใบเสนอราคา', count: getStatsByStatus('quote_created') }, { id: 'pending', label: 'รออนุมัติ', count: getStatsByStatus('pending') }, { id: 'approved', label: 'อนุมัติแล้ว', count: getStatsByStatus('approved') }, { id: 'rejected', label: 'ลูกค้าปฏิเสธ', count: getStatsByStatus('rejected') }, { id: 'completed', label: 'เสร็จสิ้น', count: getStatsByStatus('completed') }, { id: 'cancelled', label: 'ยกเลิก', count: getStatsByStatus('cancelled') }].map(chip => (
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
              placeholder="ค้นหาโปรเจ็กต์, ลูกค้า, หรือรหัสงาน..."
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
            
            {(statusFilter !== 'all' || typeFilter !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setStatusFilter('all');
                  setTypeFilter('all');
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
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_auto_1fr] gap-4 pt-4 border-t border-line">
              <select 
                className="pb-input text-ink-muted"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">สถานะทั้งหมด</option>
                <option value="draft">ร่าง</option>
                <option value="quote_created">สร้างใบเสนอราคาแล้ว</option>
                <option value="pending">รอการอนุมัติ</option>
                <option value="approved">อนุมัติแล้ว</option>
                <option value="rejected">ลูกค้าปฏิเสธ</option>
                <option value="completed">เสร็จสิ้น</option>
                <option value="cancelled">ยกเลิก</option>
              </select>
              <select className="pb-input text-ink-muted" aria-label="ประเภทงาน" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="all">ประเภทงานทั้งหมด</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <DateRange label="วันที่จัดงาน" from={dateFrom} to={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); }} />
              <select 
                className="pb-input text-ink-muted"
                value={sort.key}
                onChange={(e) => setSort({ key: e.target.value, dir: firstDir(e.target.value) })}
              >
                <option value="eventDate">เรียงตามวันที่</option>
                <option value="title">เรียงตามชื่อ</option>
                <option value="budget">เรียงตามงบประมาณ</option>
                <option value="status">เรียงตามสถานะ</option>
                <option value="price">เรียงตามราคา</option>
                <option value="margin">เรียงตาม Margin</option>
                <option value="score">เรียงตามคะแนนสุขภาพ</option>
                <option value="code">เรียงตามรหัส</option>
                <option value="client">เรียงตามลูกค้า</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {loading && <div className="text-center text-ink py-12">กำลังโหลด...</div>}
      {!loading && filteredProjects.length === 0 && (
        <div className="pb-card p-10 text-center mb-8">
          <p className="text-ink-muted mb-4">{projects.length === 0 ? 'ยังไม่มีโปรเจ็กต์' : 'ไม่พบโปรเจ็กต์ที่ตรงกับเงื่อนไข'}</p>
          {projects.length === 0 && (
            <button onClick={() => onNavigate('new-project')} className="pb-btn-primary">
              สร้างโปรเจ็กต์แรก
            </button>
          )}
        </div>
      )}

      {/* Table (desktop) */}
      {paged.rows.length > 0 && (
        <div className="hidden rows:block pb-card overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              {/* Until the screen is wide (2xl) the table has no column for the code or the customer: both sit under the name, so the name keeps a readable width at this text size. */}
              <thead>
                <tr className="bg-canvas/60 border-b border-line">
                  <SortHeader label="รหัส" sortKey="code" sort={sort} onSort={sortBy} className="hidden 2xl:table-cell" />
                  <SortHeader label="โปรเจ็กต์" sortKey="title" sort={sort} onSort={sortBy} />
                  <SortHeader label="ลูกค้า" sortKey="client" sort={sort} onSort={sortBy} className="hidden 2xl:table-cell" />
                  <SortHeader label="วันที่จัดงาน" sortKey="eventDate" sort={sort} onSort={sortBy} firstDir="desc" />
                  <SortHeader label="ราคา" sortKey="price" sort={sort} onSort={sortBy} align="right" firstDir="desc" />
                  <SortHeader label="Margin" sortKey="margin" sort={sort} onSort={sortBy} align="right" firstDir="desc" />
                  <SortHeader label="สุขภาพ" sortKey="score" sort={sort} onSort={sortBy} firstDir="desc" />
                  <SortHeader label="สถานะ" sortKey="status" sort={sort} onSort={sortBy} />
                  <th className="px-2 py-3 text-center text-ink font-medium">การจัดการ</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((project) => {
                  const h = healthOf.get(project.id)!;
                  return (
                    <tr key={project.id} onClick={() => handleProjectClick(project)} className="border-b border-line last:border-b-0 hover:bg-canvas/60 cursor-pointer">
                      <td className="hidden 2xl:table-cell px-3 py-3 text-ink-muted whitespace-nowrap">{project.code}</td>
                      <td className="px-2 2xl:px-3 py-3 font-medium text-ink max-w-[16rem]">
                        <span className={`line-clamp-2 ${struck(project.status)}`}>{project.title}</span>
                        {project.client && <span className="2xl:hidden block mt-0.5 font-normal text-ink truncate">{project.client}</span>}
                        <span className="2xl:hidden block mt-0.5 text-xs font-normal text-ink-muted whitespace-nowrap">{project.code}</span>
                      </td>
                      <td className="hidden 2xl:table-cell px-3 py-3 text-ink max-w-[10rem] truncate">{project.client || '-'}</td>
                      <td className="px-2 2xl:px-3 py-3 text-ink whitespace-nowrap">{formatEventDate(project.eventDate)}</td>
                      <td className="px-2 2xl:px-3 py-3 text-right font-medium text-ink whitespace-nowrap">฿{Math.round(h.price).toLocaleString('th-TH')}</td>
                      <td className="px-2 2xl:px-3 py-3 text-right text-ink whitespace-nowrap">{h.margin.toFixed(0)}%</td>
                      <td className="px-2 2xl:px-3 py-3">
                        <span title="คะแนนสุขภาพกำไร" className={`inline-flex w-9 h-9 rounded-xl items-center justify-center text-xs font-bold ${LEVEL_STYLE[h.level].chip}`}>{h.score}</span>
                      </td>
                      <td className="px-2 2xl:px-3 py-3">
                        <button
                          onClick={(e) => openStatusModal(project, e)}
                          title="เปลี่ยนสถานะ"
                          className={`px-3 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${getStatusStyles(project.status)}`}
                        >
                          {project.statusText}
                        </button>
                      </td>
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => handleProjectClick(project)} aria-label="ดูโปรเจ็กต์" title="ดู" className="flex items-center justify-center w-8 h-8 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => onProjectSelect(project, true)} aria-label="แก้ไขโปรเจ็กต์" title="แก้ไข" className="flex items-center justify-center w-8 h-8 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors">
                            <Edit className="w-4 h-4" />
                          </button>
                          {project.status === 'completed' ? (
                            <button onClick={() => handleProjectClick(project)} aria-label="ดูรายงาน" title="รายงาน" className="flex items-center justify-center w-8 h-8 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors">
                              <FileBarChart className="w-4 h-4" />
                            </button>
                          ) : (
                            <button onClick={() => deleteProject(project)} aria-label="ลบโปรเจ็กต์" title="ลบ" className="flex items-center justify-center w-8 h-8 bg-rose-50 text-rose-600 rounded-full hover:bg-rose-100 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cards (phones) */}
      <div className="rows:hidden grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {paged.rows.map((project) => {
          const progress = getProgressFromStatus(project.status);
          
          return (
            <div
              key={project.id}
              onClick={() => handleProjectClick(project)}
              className="pb-card cursor-pointer transition-all duration-300 overflow-hidden"
            >
              {/* Project Header */}
              <div className="p-4 md:p-6 border-b border-line">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className={`text-base md:text-lg text-ink mb-2 line-clamp-2 font-semibold ${struck(project.status)}`}>{project.title}</h3>
                    <p className="text-sm text-ink-muted">รหัส: {project.code}</p>
                  </div>
                  <button
                    onClick={(e) => openStatusModal(project, e)}
                    className={`px-2 md:px-3 py-1 rounded-full text-xs md:text-sm font-medium border transition-all hover:scale-105 ml-2 whitespace-nowrap whitespace-nowrap ${getStatusStyles(project.status)}`}
                  >
                    {project.statusText}
                  </button>
                </div>
              </div>

              {/* Project Body */}
              <div className="p-4 md:p-6">
                {(() => {
                  const h = projectHealth(project, user);
                  return (
                    <div className="grid grid-cols-[auto_1fr_1fr] gap-4 mb-6 items-center">
                      <span title="คะแนนสุขภาพกำไร" className={`w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-bold ${LEVEL_STYLE[h.level].chip}`}>{h.score}</span>
                      <div>
                        <div className="text-xs text-ink-muted mb-1">วันที่จัดงาน</div>
                        <div className="font-medium text-ink text-sm">{formatEventDate(project.eventDate)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-ink-muted mb-1">ราคา · Margin</div>
                        <div className="font-medium text-ink text-sm whitespace-nowrap">฿{Math.round(h.price).toLocaleString('th-TH')} · {h.margin.toFixed(0)}%</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Progress based on status */}
                <div className="mb-6">
                  <div className="w-full bg-[#F1F0F5] rounded-full h-1.5 mb-2">
                    <div 
                      className="bg-gold h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <div className="text-xs md:text-sm text-ink-muted">{progress}% เสร็จสิ้น</div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-3 gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleProjectClick(project)}
                    className="flex items-center justify-center gap-1 py-2 px-2 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors text-xs md:text-sm"
                  >
                    <Eye className="w-3 h-3 md:w-4 md:h-4" />
                    <span className="hidden md:inline">ดู</span>
                  </button>
                  <button
                    onClick={() => onProjectSelect(project, true)}
                    className="flex items-center justify-center gap-1 py-2 px-2 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors text-xs md:text-sm"
                  >
                    <Edit className="w-3 h-3 md:w-4 md:h-4" />
                    <span className="hidden md:inline">แก้ไข</span>
                  </button>
                  {project.status === 'completed' ? (
                    <button
                      onClick={() => handleProjectClick(project)}
                      className="flex items-center justify-center gap-1 py-2 px-2 bg-[#F1F0F5] text-ink rounded-full hover:bg-[#E8E6EF] transition-colors text-xs md:text-sm"
                    >
                      <FileBarChart className="w-3 h-3 md:w-4 md:h-4" />
                      <span className="hidden md:inline">รายงาน</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => deleteProject(project)}
                      className="flex items-center justify-center gap-1 py-2 px-2 bg-rose-50 text-rose-600 rounded-full hover:bg-rose-100 transition-colors text-xs md:text-sm"
                    >
                      <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
                      <span className="hidden md:inline">ลบ</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Pagination paged={paged} unit="โปรเจ็กต์" />

      {/* Status Update Modal */}
      {isStatusModalOpen && selectedProject && (
        <StatusDialog
          title="เปลี่ยนสถานะโปรเจ็กต์"
          subject={selectedProject.title}
          options={PROJECT_STATUS_OPTIONS}
          current={selectedProject.status}
          blocked={projectStatusBlock(selectedProject)}
          onPick={updateProjectStatus}
          onClose={closeStatusModal}
        />
      )}

      {/* Notification */}
      {notification && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-ink text-white px-5 py-3 rounded-full shadow-soft-xl z-50 animate-toast text-sm">
          {notification}
        </div>
      )}

      {/* Empty State */}
      {filteredProjects.length === 0 && (
        <div className="text-center py-12 md:py-16">
          <div className="text-ink-muted mb-4">
            <svg className="mx-auto h-8 w-8 md:h-12 md:w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-base md:text-lg font-medium text-ink mb-2">ไม่พบโปรเจ็กต์</h3>
          <p className="text-sm md:text-base text-ink-muted">ลองเปลี่ยนคำค้นหาหรือตัวกรองของคุณ</p>
        </div>
      )}
    </div>
  );
}