import React from 'react';
import { ClipboardCheck, Home, FolderOpen, Plus, FileText, BarChart3, Settings, Crown, LogOut, ShieldCheck, Users, ChevronsRight, Receipt } from 'lucide-react';
import type { User } from '../lib/api';
import { brandLogo, brandName } from '../lib/brand';
import { planName, trialDaysLeft } from '../lib/plans';

interface SidebarProps {
  activeNav: string;
  setActiveNav: (nav: string) => void;
  user: User;
  onLogout: () => void;
  /** folded to a strip of icons, each named on hover; `onExpand` shows the whole menu for a moment */
  compact?: boolean;
  onExpand?: () => void;
}

const mainItems = [
  { id: 'dashboard', label: 'หน้าหลัก', icon: Home },
  { id: 'quick-check', label: 'เช็คก่อนรับงาน', icon: ClipboardCheck },
  { id: 'projects', label: 'โปรเจ็กต์', icon: FolderOpen },
  { id: 'quotes', label: 'ใบเสนอราคา', icon: FileText },
  { id: 'receipts', label: 'ใบเสร็จ', icon: Receipt },
  { id: 'customers', label: 'ลูกค้า', icon: Users },
  { id: 'reports', label: 'รายงาน', icon: BarChart3 },
  { id: 'settings', label: 'ตั้งค่า', icon: Settings },
];

const extraItems = [{ id: 'subscription', label: 'แพ็กเกจ', icon: Crown }];
const adminItem = { id: 'admin', label: 'ผู้ดูแลระบบ', icon: ShieldCheck };

export function Sidebar({ activeNav, setActiveNav, user, onLogout, compact = false, onExpand }: SidebarProps) {
  const isActive = (id: string) =>
    activeNav === id || (id === 'quotes' && ['quotes-all', 'quotes-new'].includes(activeNav));

  // On a short window (most laptops, at this text size) the spacing closes up so more of the list shows without scrolling.
  const item = ({ id, label, icon: Icon }: (typeof mainItems)[number], subtle = false) => {
    const active = isActive(id);
    return (
      <li key={id}>
        <button
          onClick={() => setActiveNav(id)}
          aria-current={active ? 'page' : undefined}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 [@media(max-height:735px)]:py-2 rounded-2xl text-left transition-colors ${
            active ? 'bg-white shadow-card text-ink font-medium' : 'text-white/75 hover:text-white hover:bg-white/10'
          } ${subtle ? 'text-xs' : 'text-sm'}`}
        >
          <Icon className={`w-[18px] h-[18px] ${active ? 'text-[#673AB7]' : ''}`} />
          {label}
        </button>
      </li>
    );
  };

  if (compact) return compactMenu();

  function compactMenu() {
    const icon = ({ id, label, icon: Icon }: (typeof mainItems)[number]) => {
      const active = isActive(id);
      return (
        <li key={id}>
          <button
            onClick={() => setActiveNav(id)}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            title={label}
            className={`w-11 h-11 [@media(max-height:735px)]:h-10 mx-auto flex items-center justify-center rounded-2xl transition-colors ${
              active ? 'bg-white shadow-card text-[#673AB7]' : 'text-white/75 hover:text-white hover:bg-white/10'
            }`}
          >
            <Icon className="w-[18px] h-[18px]" />
          </button>
        </li>
      );
    };
    return (
      <div className="pb-sidebar relative flex flex-col items-center h-full w-full rounded-[28px] py-4 px-2 text-white overflow-hidden bg-gradient-to-b from-[#7C4DDB] via-[#673AB7] to-[#35235e] shadow-[0_1px_2px_rgba(53,35,94,0.25),0_20px_48px_-16px_rgba(103,58,183,0.55)]">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 w-56 h-56 rounded-full bg-white/15 blur-3xl" />
        <div className="relative w-10 h-10 rounded-xl bg-white/95 p-1 shadow-soft shrink-0 mb-4 [@media(max-height:735px)]:mb-3" title={brandName(user)}>
          <img src={brandLogo(user)} alt={brandName(user)} className="w-full h-full object-contain" />
        </div>
        <button
          onClick={() => setActiveNav('new-project')}
          aria-label="สร้างโปรเจ็กต์"
          title="สร้างโปรเจ็กต์"
          className="relative w-11 h-11 mb-4 [@media(max-height:735px)]:mb-3 shrink-0 inline-flex items-center justify-center rounded-full bg-[#eab308] text-[#35235e] hover:bg-[#f2c230] transition-colors shadow-[0_6px_16px_-6px_rgba(234,179,8,0.7)]"
        >
          <Plus className="w-5 h-5" />
        </button>
        <nav className="no-scrollbar relative flex-1 min-h-0 w-full overflow-y-auto mb-3" aria-label="เมนู">
          <ul className="space-y-1">{mainItems.map(icon)}</ul>
          <ul className="space-y-1 mt-4 pt-4 [@media(max-height:735px)]:mt-2 [@media(max-height:735px)]:pt-2 border-t border-white/15 mx-1">{[...extraItems, ...(user.role === 'admin' ? [adminItem] : [])].map(icon)}</ul>
        </nav>
        <div className="relative flex flex-col items-center gap-1 shrink-0">
          {onExpand && (
            <button onClick={onExpand} aria-label="แสดงเมนูเต็ม" title="แสดงเมนูเต็ม" className="w-10 h-10 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10">
              <ChevronsRight className="w-[18px] h-[18px]" />
            </button>
          )}
          <div className="w-9 h-9 rounded-full bg-[#eab308] text-[#35235e] text-sm font-semibold flex items-center justify-center" title={`${user.name} · ${user.email}`}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <button onClick={onLogout} title="ออกจากระบบ" aria-label="ออกจากระบบ" className="w-10 h-10 flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/10">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-sidebar relative flex flex-col h-full w-full rounded-[28px] p-4 text-white overflow-hidden bg-gradient-to-b from-[#7C4DDB] via-[#673AB7] to-[#35235e] shadow-[0_1px_2px_rgba(53,35,94,0.25),0_20px_48px_-16px_rgba(103,58,183,0.55)]">
      {/* soft light at the top edge for depth */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 w-56 h-56 rounded-full bg-white/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-[#eab308]/15 blur-3xl" />

      <div className="relative flex items-center gap-3 px-2 pt-2 mb-7 [@media(max-height:735px)]:mb-4">
        <div className="w-10 h-10 rounded-xl bg-white/95 p-1 shadow-soft shrink-0">
          <img src={brandLogo(user)} alt="" className="w-full h-full object-contain" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight truncate" title={brandName(user)}>{brandName(user)}</p>
          <p className="text-xs text-white/65 truncate">
            {planName(user.plan)}
            {trialDaysLeft(user) !== null && ` · เหลือ ${trialDaysLeft(user)} วัน`}
          </p>
        </div>
      </div>

      <button
        onClick={() => setActiveNav('new-project')}
        className="relative w-full mb-6 [@media(max-height:735px)]:mb-3 inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold bg-[#eab308] text-[#35235e] hover:bg-[#f2c230] transition-colors shadow-[0_6px_16px_-6px_rgba(234,179,8,0.7)]"
      >
        <Plus className="w-4 h-4" />
        สร้างโปรเจ็กต์
      </button>

      {/* on a short window the list scrolls inside itself, so the account and sign-out row below is never pushed off the screen */}
      <nav className="no-scrollbar relative flex-1 min-h-0 overflow-y-auto mb-3">
        <ul className="space-y-1">{mainItems.map((i) => item(i))}</ul>
        <ul className="space-y-1 mt-6 pt-6 [@media(max-height:735px)]:mt-3 [@media(max-height:735px)]:pt-3 border-t border-white/15">{[...extraItems, ...(user.role === 'admin' ? [adminItem] : [])].map((i) => item(i, true))}</ul>
      </nav>

      <div className="relative flex items-center gap-3 p-2 rounded-2xl bg-white/10">
        <div className="w-9 h-9 rounded-full bg-[#eab308] text-[#35235e] text-sm font-semibold flex items-center justify-center shrink-0">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{user.name}</p>
          <p className="text-xs text-white/60 truncate">{user.email}</p>
        </div>
        <button onClick={onLogout} title="ออกจากระบบ" aria-label="ออกจากระบบ" className="p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
