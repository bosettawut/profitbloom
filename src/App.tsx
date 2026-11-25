import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { 
  BarChart3, 
  FolderOpen, 
  Plus, 
  FileText, 
  TrendingUp, 
  Settings,
  DollarSign,
  TrendingDown,
  CheckCircle,
  Target,
  Clock,
  Calendar,
  Check,
  AlertCircle,
  Menu,
  X,
  Home,
  Sparkles,
  Eye,
  Crown,
  Trash2,
  Send,
  XCircle,
  Loader2,
  ClipboardCheck
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { StatsCard } from './components/StatsCard';
import { ActivityItem } from './components/ActivityItem';
import { ProjectItem } from './components/ProjectItem';
import { SalesChart } from './components/SalesChart';
import { Projects } from './components/Projects';
import { JobWorkspace } from './components/job/JobWorkspace';
import { NewProject } from './components/NewProject';
import { NewQuote } from './components/NewQuote';
import { AllQuotes } from './components/AllQuotes';
import { Packages } from './components/Packages';
import { AdminPage } from './components/AdminPage';
import { QuickCheck } from './components/QuickCheck';
import { LEVEL_STYLE, projectHealth, salePrice } from './lib/job';
import { AuthScreen, type AuthMode } from './components/AuthScreen';
import { ResetPassword } from './components/ResetPassword';
import { Reports } from './components/Reports';
import { CustomerPage, Customers } from './components/Customers';
import { setShopCategories } from './lib/decision';
import { AccountSettings } from './components/AccountSettings';
import { brandLogo, brandName } from './lib/brand';
import { trialDaysLeft } from './lib/plans';
import { parseView, viewPath, type View } from './lib/route';
import { api, Activity, baht, Dashboard, Project, ProjectInput, timeAgo, UNAUTHORIZED_EVENT, User } from './lib/api';

// Function to calculate progress based on status
export const getProgressFromStatus = (status: string): number => {
  switch (status) {
    case 'draft': return 0;
    case 'quote_created': return 25;
    case 'pending': return 25; // Same as quote_created since quote is sent
    case 'approved': return 60;
    case 'completed': return 100;
    case 'cancelled': return 0;
    default: return 0;
  }
};

const activityIcon = (kind: string) => {
  if (kind.startsWith('quote_deleted') || kind === 'project_deleted' || kind === 'customer_deleted') return { icon: Trash2, iconBg: 'bg-rose-50 text-rose-500' };
  if (kind === 'quote_sent') return { icon: Send, iconBg: 'bg-violet-50 text-[#673AB7]' };
  if (kind === 'quote_rejected' || kind === 'project_cancelled') return { icon: XCircle, iconBg: 'bg-rose-50 text-rose-500' };
  if (kind.startsWith('quote_')) return { icon: FileText, iconBg: 'bg-violet-50 text-[#673AB7]' };
  if (kind === 'plan_changed') return { icon: Crown, iconBg: 'bg-amber-50 text-amber-600' };
  if (kind === 'project_created' || kind === 'customer_created') return { icon: Plus, iconBg: 'bg-amber-50 text-amber-600' };
  if (kind === 'project_completed' || kind === 'project_approved') return { icon: CheckCircle, iconBg: 'bg-amber-50 text-amber-600' };
  return { icon: DollarSign, iconBg: 'bg-violet-50 text-[#673AB7]' };
};

const toActivityItem = (a: Activity) => ({ ...activityIcon(a.kind), title: a.title, time: `${a.detail ? a.detail + ' • ' : ''}${timeAgo(a.created_at)}` });

const formatChange = (pct: number, suffix = 'จากเดือนที่แล้ว') => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% ${suffix}`;

const formatEventDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : 'ยังไม่กำหนดวัน';

interface AppProps {
  /** which tab the sign-in screen opens on when nobody is logged in */
  authMode?: AuthMode;
  /** the current address (path + query); decides which app screen is showing */
  path: string;
  /** move to another address: landing, /login, /signup, or a screen under /app */
  go: (path: string, options?: { replace?: boolean }) => void;
}

export default function App({ authMode = 'login', path, go }: AppProps) {
  const [user, setUser] = useState<User | null>(null);
  // the category menus read this list; set while rendering so every screen below sees the signed-in shop's categories
  setShopCategories(user?.costCategories ?? []);
  const [authChecked, setAuthChecked] = useState(false);
  const [chartType, setChartType] = useState<'line' | 'bar'>('bar');
  const [chartRange, setChartRange] = useState<'6' | '12' | 'year'>('6');
  // the screen comes from the address, so the browser's back/forward buttons walk through the app
  const view = useMemo(() => parseView(path), [path]);
  /** the page a password reset email links to; it works whether or not someone is signed in here */
  const onResetPage = path.startsWith('/reset');
  const activeNav = view.nav;
  /** the job the address points at (open in the workspace, or the one a new quote is built from) */
  const neededProjectId = view.projectId ?? view.fromProjectId;
  /**
   * How much of the menu at the side a page gets, on a notebook or computer (a phone has the bar at the bottom).
   * Making something new takes the whole width: no menu, a small button to call it up. Looking at one job, quote or
   * customer folds it to a strip of icons. Everything else has the whole menu.
   */
  const menu: 'full' | 'icons' | 'none' =
    activeNav === 'new-project' || (activeNav === 'quotes-new' && !view.quoteId) ? 'none'
      : view.projectId || (activeNav === 'quotes-new' && view.quoteId) || (activeNav === 'customers' && view.customerId) ? 'icons'
        : 'full';
  /** the whole menu called up over a page that has it folded or hidden */
  const [menuShown, setMenuShown] = useState(false);
  useEffect(() => setMenuShown(false), [path]);
  useEffect(() => {
    if (!menuShown) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuShown(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuShown]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [openJobs, setOpenJobs] = useState<Project[]>([]);
  const [allActivities, setAllActivities] = useState<Activity[] | null>(null);

  useEffect(() => {
    api.me().then(({ user }) => setUser(user)).catch(() => setUser(null)).finally(() => setAuthChecked(true));
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const loadDashboard = useCallback(() => {
    api.dashboard(chartRange).then(setDashboard).catch(() => {});
    // jobs still waiting for a decision or under way — the dashboard leads with these
    api.projects()
      .then((ps) => setOpenJobs(ps.filter((p) => ['draft', 'quote_created', 'pending', 'approved'].includes(p.status))))
      .catch(() => {});
  }, [chartRange]);

  useEffect(() => {
    document.title = user ? brandName(user) : 'ProfitBloom';
  }, [user]);

  useEffect(() => {
    // a signed-in user never sees /login or /signup again, not even through the back button
    if (user && !path.startsWith('/app') && !onResetPage) go('/app', { replace: true });
  }, [user, path]);

  const show = (next: View, options?: { replace?: boolean }) => {
    setAllActivities(null);
    go(viewPath(next), options);
  };

  useEffect(() => {
    // arrived by back/forward, refresh or a link: the job isn't in memory yet
    if (!user || !neededProjectId || selectedProject?.id === neededProjectId) return;
    let stale = false;
    api.project(neededProjectId)
      .then((p) => !stale && setSelectedProject(p))
      .catch(() => !stale && show({ nav: 'projects' }, { replace: true }));
    return () => {
      stale = true;
    };
  }, [user, neededProjectId, selectedProject?.id]);

  useEffect(() => {
    if (user && activeNav === 'dashboard') loadDashboard();
  }, [user, activeNav, loadDashboard]);

  const navigate = (nav: string) => show({ nav });

  const handleLogout = async (everywhere = false) => {
    if (everywhere) await api.logoutAll();
    else await api.logout().catch(() => {});
    setUser(null);
    setDashboard(null);
    setSelectedProject(null);
    go('/');
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <Loader2 className="w-8 h-8 text-[#673AB7] animate-spin" />
      </div>
    );
  }

  if (onResetPage) {
    return (
      <ResetPassword
        token={new URLSearchParams(path.split('?')[1] ?? '').get('token') ?? ''}
        onDone={(u) => {
          // possibly a different account from the one that was signed in on this device
          setSelectedProject(null);
          setDashboard(null);
          setUser(u);
          go('/app', { replace: true });
        }}
        onRequestNew={() => go('/forgot', { replace: true })}
        onBack={() => go('/')}
      />
    );
  }

  if (!user) {
    return (
      <AuthScreen
        key={authMode}
        initialMode={authMode}
        onModeChange={(m) => go(m === 'register' ? '/signup' : m === 'forgot' ? '/forgot' : '/login')}
        onBack={() => go('/')}
        // signing in from /login lands on /app (see the effect above); a session that ran out
        // mid-work signs back in to the screen it was on
        onAuthenticated={setUser}
      />
    );
  }

  const stats = dashboard?.stats;
  const statsData = [
    {
      icon: DollarSign,
      iconBg: 'bg-violet-50 text-[#673AB7]',
      value: baht(stats?.salesThisMonth ?? 0),
      label: 'ยอดขายเดือนนี้',
      change: formatChange(stats?.salesChange ?? 0),
      positive: (stats?.salesChange ?? 0) >= 0
    },
    {
      icon: TrendingUp,
      iconBg: 'bg-amber-50 text-amber-500',
      value: baht(stats?.profitThisMonth ?? 0),
      label: 'กำไรสุทธิ',
      change: formatChange(stats?.profitChange ?? 0),
      positive: (stats?.profitChange ?? 0) >= 0
    },
    {
      icon: FileText,
      iconBg: 'bg-violet-50 text-[#673AB7]',
      value: String(stats?.activeProjects ?? 0),
      label: 'โปรเจ็กต์ที่ดำเนินการ',
      change: `+${stats?.newProjectsThisMonth ?? 0} โปรเจ็กต์ใหม่เดือนนี้`,
      positive: true
    },
    {
      icon: Target,
      iconBg: 'bg-amber-50 text-amber-500',
      value: `${Math.round(stats?.successRate ?? 0)}%`,
      label: 'อัตราความสำเร็จ',
      change: `จาก ${stats?.decidedProjects ?? 0} โปรเจ็กต์ที่ปิดแล้ว`,
      positive: true
    }
  ];

  const activityData = (allActivities ?? dashboard?.activities ?? []).map(toActivityItem);

  const toggleAllActivities = () => {
    if (allActivities) setAllActivities(null);
    else api.activities(50).then(setAllActivities).catch(() => {});
  };

  const mobileNav = [
    { id: 'dashboard', label: 'หน้าหลัก', icon: Home },
    { id: 'projects', label: 'โปรเจ็กต์', icon: FolderOpen },
    { id: 'new-project', label: 'สร้าง', icon: Plus },
    { id: 'quotes', label: 'ใบเสนอราคา', icon: FileText },
    { id: 'quick-check', label: 'เช็คงาน', icon: ClipboardCheck },
  ];
  const isNavActive = (id: string) =>
    activeNav === id || (id === 'quotes' && ['quotes-all', 'quotes-new'].includes(activeNav));

  const handleProjectSelect = (project: Project, edit = false) => {
    setSelectedProject(project);
    show({ nav: 'projects', projectId: project.id, edit });
  };

  const handleProjectUpdate = async (updatedProject: ProjectInput & { id: string }) => {
    const saved = await api.updateProject(updatedProject.id, updatedProject);
    // `quoteUpdated` says what this one save did; it is not part of the job
    const { quoteUpdated: _quoteUpdated, ...project } = saved;
    setSelectedProject(project);
    return saved;
  };

  const handleProjectDelete = async (projectId: string) => {
    await api.deleteProject(projectId);
    // the deleted job's address is replaced, so the back button can't land on it again
    setSelectedProject(null);
    show({ nav: 'projects' }, { replace: true });
  };

  const handleBackToProjects = () => show({ nav: 'projects' });

  const openQuote = (quoteId: string | null, preview = false) => show({ nav: 'quotes-new', quoteId: quoteId ?? undefined, preview });

  const createQuoteFromProject = (project: Project) => {
    // a job has one quote tied to it: when it is already there, that one opens
    if (project.quote) return openQuote(project.quote.id);
    setSelectedProject(project);
    show({ nav: 'quotes-new', fromProjectId: project.id });
  };

  const loadingScreen = (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#673AB7] animate-spin" />
    </div>
  );

  const renderContent = () => {
    // the address names a job that is still being fetched
    if (neededProjectId && selectedProject?.id !== neededProjectId) return loadingScreen;

    if (view.projectId && selectedProject) {
      return (
        <JobWorkspace
          key={`${selectedProject.id}-${!!view.edit}`}
          project={selectedProject}
          user={user}
          onBack={handleBackToProjects}
          onUpdate={handleProjectUpdate}
          onDelete={handleProjectDelete}
          onCreateQuote={createQuoteFromProject}
          onOpenQuote={(id) => openQuote(id)}
          startStage={view.edit ? 'quote' : undefined}
        />
      );
    }

    switch (activeNav) {
      case 'projects':
        return <Projects onProjectSelect={handleProjectSelect} onNavigate={navigate} user={user} />;
      case 'new-project':
        return <NewProject user={user} onCreated={(p) => handleProjectSelect(p)} onClose={() => navigate('projects')} />;
      case 'quotes':
      case 'quotes-all':
        return <AllQuotes onNavigate={navigate} onOpenQuote={openQuote} onOpenProjectCosts={(p) => handleProjectSelect(p, true)} user={user} />;
      case 'quotes-new':
        return (
          <NewQuote
            key={view.quoteId ?? view.fromProjectId ?? 'new'}
            user={user}
            quoteId={view.quoteId ?? null}
            fromProject={view.fromProjectId ? selectedProject : null}
            startInPreview={!!view.preview}
            onOpenProjectCosts={(p) => handleProjectSelect(p, true)}
            onOpenProject={(p) => handleProjectSelect(p)}
            // the job held here is the copy from before the quote was saved: read it again, so going back to it shows its quote
            onProjectChanged={(id) => { api.project(id).then((p) => setSelectedProject((held) => (held?.id === id ? p : held))).catch(() => {}); }}
            onDone={() => navigate('quotes-all')}
          />
        );
      case 'quick-check':
        return <QuickCheck user={user} onCreated={(p) => handleProjectSelect(p)} />;
      case 'customers':
        return view.customerId ? (
          <CustomerPage
            key={view.customerId}
            customerId={view.customerId}
            onBack={() => show({ nav: 'customers' })}
            // the deleted customer's address is replaced, so the back button can't land on it again
            onGone={() => show({ nav: 'customers' }, { replace: true })}
            onOpenProject={(p) => handleProjectSelect(p)}
            onOpenQuote={(id) => openQuote(id)}
          />
        ) : (
          <Customers onOpenCustomer={(id) => show({ nav: 'customers', customerId: id })} />
        );
      case 'reports':
        return <Reports user={user} onOpenProject={(p) => handleProjectSelect(p)} />;
      case 'settings':
        return <AccountSettings user={user} onUserUpdated={setUser} onLogout={() => handleLogout()} onLogoutAll={() => handleLogout(true)} onNavigate={navigate} />;
      case 'admin':
        return user.role === 'admin' ? <AdminPage user={user} /> : null;
      case 'subscription':
        return (
          <Packages user={user} />
        );
      case 'dashboard':
      default:
        return (
          <div className="p-5 md:p-10 pb-28 md:pb-10">
            {/* Trial reminder: only in the last week, and once it has run out */}
            {(() => {
              const left = trialDaysLeft(user);
              if (left === null || left > 7) return null;
              return (
                <div className={`mb-6 rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${left === 0 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>
                  <p className="text-sm font-medium">
                    {left === 0 ? 'ช่วงทดลองใช้ฟรีหมดแล้ว เลือกแพ็กเกจเพื่อใช้งานต่อ' : `ทดลองใช้ฟรีเหลืออีก ${left} วัน เลือกแพ็กเกจไว้ล่วงหน้าเพื่อใช้งานต่อเนื่อง`}
                  </p>
                  <button onClick={() => navigate('subscription')} className="pb-btn-primary !py-2 shrink-0">ดูแพ็กเกจ</button>
                </div>
              );
            })()}

            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-8">
              <div>
                <p className="text-sm text-ink-muted mb-1">
                  {new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                <h1 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight">สวัสดี คุณ{user.name}</h1>
              </div>
              {/* each button is as wide as its words need and never breaks them; on a phone too narrow for both, the second drops below */}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => navigate('new-project')} className="pb-btn-secondary flex-auto lg:flex-none whitespace-nowrap max-sm:!px-3">
                  <Plus className="w-4 h-4" /> สร้างโปรเจ็กต์
                </button>
                <button onClick={() => navigate('quick-check')} className="pb-btn-primary flex-auto lg:flex-none whitespace-nowrap max-sm:!px-3">
                  <ClipboardCheck className="w-4 h-4" /> เช็คก่อนรับงาน
                </button>
              </div>
            </div>

            {/* Jobs that need a decision come before sales and charts */}
            <div className="pb-card p-5 md:p-7 mb-4 md:mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-ink">งานที่ต้องตัดสินใจ</h3>
                  <p className="text-sm text-ink-muted">เรียงจากงานที่เสี่ยงที่สุด · คะแนนสุขภาพกำไร 0–100</p>
                </div>
              </div>
              {openJobs.length === 0 ? (
                <div className="rounded-2xl bg-[#F7F6FA] px-5 py-6 text-center">
                  <p className="text-sm text-ink-muted">ยังไม่มีงานที่กำลังดำเนินการ</p>
                  <button onClick={() => navigate('quick-check')} className="pb-btn-primary mt-3 !py-2">เช็คงานแรกก่อนรับ</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {openJobs
                    .map((p) => ({ p, h: projectHealth(p, user) }))
                    .sort((a, b) => a.h.score - b.h.score)
                    .slice(0, 6)
                    .map(({ p, h }) => (
                      <button key={p.id} onClick={() => handleProjectSelect(p)} className="text-left rounded-2xl border border-line hover:border-[#673AB7]/40 hover:bg-[#FBFAFD] p-4 flex gap-4 transition-colors">
                        <span className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center shrink-0 ${LEVEL_STYLE[h.level].chip}`}>
                          <span className="text-base font-bold leading-none">{h.score}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink truncate">{p.title}</span>
                          <span className="block text-xs text-ink-muted mt-0.5">Margin {h.margin.toFixed(1)}% · {p.statusText}</span>
                          <span className={`block text-xs mt-1 truncate ${h.risks.length ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {h.risks[0]?.title ?? 'ไม่มีจุดเสี่ยง'}
                          </span>
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
              {statsData.map((stat, index) => (
                <StatsCard key={index} {...stat} />
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 mb-4 md:mb-6">
              {/* Chart */}
              <div className="lg:col-span-2 pb-card p-5 md:p-7">
                <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-6">
                  <div>
                    <h3 className="text-base font-semibold text-ink">ยอดขายและกำไร</h3>
                    <p className="text-sm text-ink-muted">จากโปรเจ็กต์ที่อนุมัติหรือเสร็จสิ้น ตามเดือนที่จัดงาน</p>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex bg-canvas rounded-full p-1">
                      {(['bar', 'line'] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => setChartType(t)}
                          className={`px-3 py-1.5 text-xs rounded-full transition-colors ${chartType === t ? 'bg-white text-ink shadow-card font-medium' : 'text-ink-muted hover:text-ink'}`}
                        >
                          {t === 'bar' ? 'แท่ง' : 'เส้น'}
                        </button>
                      ))}
                    </div>
                    <select
                      value={chartRange}
                      onChange={(e) => setChartRange(e.target.value as '6' | '12' | 'year')}
                      className="bg-canvas rounded-full px-3 py-1.5 text-xs text-ink outline-none"
                    >
                      <option value="6">6 เดือน</option>
                      <option value="12">12 เดือน</option>
                      <option value="year">ปีนี้</option>
                    </select>
                  </div>
                </div>
                <SalesChart chartType={chartType} data={dashboard?.chart ?? []} />
                <div className="flex gap-5 mt-4 text-xs text-ink-muted">
                  <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-[#673AB7]" />ยอดขาย</span>
                  <span className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-gold" />กำไร</span>
                </div>
              </div>

              {/* Activity */}
              <div className="pb-card p-5 md:p-7 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold text-ink">กิจกรรมล่าสุด</h3>
                  <Clock className="w-4 h-4 text-ink-muted" />
                </div>
                <div className={`flex-1 -mx-2 ${allActivities ? 'max-h-[26rem] overflow-y-auto' : ''}`}>
                  {activityData.length === 0 && (
                    <p className="text-sm text-ink-muted px-2 py-6">ยังไม่มีกิจกรรม สร้างโปรเจ็กต์แรกเพื่อเริ่มต้น</p>
                  )}
                  {activityData.map((activity, index) => (
                    <ActivityItem key={index} {...activity} />
                  ))}
                </div>
                {activityData.length > 0 && (
                  <button onClick={toggleAllActivities} className="pb-btn-secondary w-full mt-4">
                    {allActivities ? 'แสดงน้อยลง' : 'ดูกิจกรรมทั้งหมด'}
                  </button>
                )}
              </div>
            </div>

            {/* Recent projects */}
            <div className="pb-card p-5 md:p-7">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-ink">โปรเจ็กต์ล่าสุด</h3>
                <button onClick={() => navigate('projects')} className="text-sm text-[#673AB7] hover:text-[#35235e] font-medium">
                  ดูทั้งหมด
                </button>
              </div>
              {dashboard && dashboard.recentProjects.length === 0 && (
                <div className="text-center py-10">
                  <p className="text-sm text-ink-muted mb-4">ยังไม่มีโปรเจ็กต์</p>
                  <button onClick={() => navigate('new-project')} className="pb-btn-primary">
                    <Plus className="w-4 h-4" /> สร้างโปรเจ็กต์แรก
                  </button>
                </div>
              )}
              <div className="divide-y divide-line">
                {dashboard?.recentProjects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    title={project.title}
                    date={formatEventDate(project.eventDate)}
                    budget={baht(salePrice(project))}
                    status={project.status}
                    statusText={project.statusText}
                    onClick={() => handleProjectSelect(project)}
                  />
                ))}
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    // --content-shift: how far the middle of the page is from the middle of the window, for things centred on the page
    <div className="min-h-screen bg-canvas text-ink" style={{ ['--content-shift' as string]: menu === 'full' ? '8rem' : menu === 'icons' ? '2.75rem' : '0rem' }}>
      {/* Desktop sidebar: floating purple panel, whole or folded to icons */}
      {menu === 'full' && (
        <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 py-4 pl-4">
          <Sidebar activeNav={activeNav} setActiveNav={navigate} user={user} onLogout={() => handleLogout()} />
        </aside>
      )}
      {menu === 'icons' && (
        <aside className="hidden md:flex fixed inset-y-0 left-0 w-[5.5rem] py-4 pl-4 z-30">
          <Sidebar compact activeNav={activeNav} setActiveNav={navigate} user={user} onLogout={() => handleLogout()} onExpand={() => setMenuShown(true)} />
        </aside>
      )}
      {menu === 'none' && (
        <button
          onClick={() => setMenuShown(true)}
          aria-label="แสดงเมนู"
          title="แสดงเมนู"
          className="hidden md:flex fixed left-0 top-6 z-30 w-9 h-11 items-center justify-center rounded-r-2xl bg-gradient-to-b from-[#7C4DDB] to-[#673AB7] text-white shadow-[0_6px_16px_-6px_rgba(103,58,183,0.6)] hover:w-10 transition-all"
        >
          <Menu className="w-[18px] h-[18px]" />
        </button>
      )}
      {/* the whole menu, called up for a moment over a page that has it folded or hidden */}
      {menuShown && menu !== 'full' && (
        <div className="hidden md:block fixed inset-0 z-50">
          <div className="absolute inset-0 bg-[#221A33]/30 backdrop-blur-[1px]" onClick={() => setMenuShown(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 py-4 pl-4" aria-label="เมนู">
            <Sidebar activeNav={activeNav} setActiveNav={navigate} user={user} onLogout={() => handleLogout()} />
          </aside>
          <button
            onClick={() => setMenuShown(false)}
            aria-label="ซ่อนเมนู"
            title="ซ่อนเมนู"
            className="absolute top-6 left-[16.75rem] w-10 h-10 flex items-center justify-center rounded-full bg-white text-ink shadow-soft-xl hover:bg-[#F1F0F5]"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>
      )}

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between px-5 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <img src={brandLogo(user)} alt="" className="w-8 h-8 object-contain rounded-lg" />
          <span className="font-semibold text-ink truncate max-w-[60vw]">{brandName(user)}</span>
        </div>
        <button
          onClick={() => navigate('settings')}
          aria-label="ตั้งค่าบัญชี"
          className="w-9 h-9 rounded-full bg-amber-400 text-white text-sm font-semibold flex items-center justify-center"
        >
          {user.name.charAt(0).toUpperCase()}
        </button>
      </header>

      {/* Content floats on one soft sheet */}
      <main className={`${menu === 'full' ? 'md:pl-[17rem]' : menu === 'icons' ? 'md:pl-[6.5rem]' : 'md:pl-4'} md:py-4 md:pr-4`}>
        <div className="pb-sheet min-h-[calc(100vh-5rem)] md:min-h-[calc(100vh-2rem)] mx-2 md:mx-0">
          {renderContent()}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-3 left-3 right-3 z-40 pb-card !rounded-full px-2 py-1.5 grid grid-cols-5">
        {mobileNav.map((item) => {
          const Icon = item.icon;
          if (item.id === 'new-project') {
            return (
              <button key={item.id} onClick={() => navigate(item.id)} aria-label="สร้างโปรเจ็กต์" className="flex items-center justify-center">
                <span className="w-11 h-11 rounded-full bg-[#673AB7] text-white flex items-center justify-center shadow-purple">
                  <Plus className="w-5 h-5" />
                </span>
              </button>
            );
          }
          const active = isNavActive(item.id);
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`flex flex-col items-center gap-0.5 py-1.5 rounded-full text-xs whitespace-nowrap ${active ? 'text-[#673AB7] font-medium' : 'text-ink-muted'}`}
            >
              <Icon className="w-5 h-5" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
