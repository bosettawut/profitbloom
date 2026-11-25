import React, { useRef, useState } from 'react';
import { BarChart3, ChevronRight, Crown, ImagePlus, LogOut, MonitorSmartphone, Plus, Receipt, Save, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api, User, type ShopCategory, type VatMode } from '../lib/api';
import { brandLogo, resizeLogo } from '../lib/brand';
import { COST_CATEGORIES, DEFAULT_RULES, withDefaults, type Rules } from '../lib/decision';

interface AccountSettingsProps {
  user: User;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
  /** signs out every device, this one included */
  onLogoutAll: () => Promise<void>;
  onNavigate: (page: string) => void;
}

const inputClass = 'pb-input';

interface CostCategoriesCardProps {
  className?: string;
  categories: ShopCategory[];
  onChange: (categories: ShopCategory[]) => void;
}

/** The shop's own cost categories. Each change is saved straight away, separately from the form around it. */
function CostCategoriesCard({ className = '', categories, onChange }: CostCategoriesCardProps) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const builtIn = COST_CATEGORIES.filter((c) => !categories.some((own) => own.id === c.id));

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote({ ok: true, text: await work() });
    } catch (err) {
      setNote({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    if (!newName.trim()) return setNote({ ok: false, text: 'กรุณากรอกชื่อหมวด' });
    return run(async () => {
      const made = await api.createCostCategory(newName);
      onChange([...categories, made]);
      setNewName('');
      return `เพิ่มหมวด "${made.name}" แล้ว`;
    });
  };
  const rename = (c: ShopCategory) => {
    const typed = (names[c.id] ?? c.name).trim();
    const reset = () => setNames(({ [c.id]: _, ...rest }) => rest);
    if (!typed || typed === c.name) return reset();
    return run(async () => {
      try {
        const saved = await api.renameCostCategory(c.id, typed);
        onChange(categories.map((x) => (x.id === c.id ? saved : x)));
        return `เปลี่ยนชื่อหมวดเป็น "${saved.name}" แล้ว`;
      } finally {
        reset();
      }
    });
  };
  const remove = (c: ShopCategory) => {
    if (!window.confirm(`ลบหมวด "${c.name}" ใช่หรือไม่?\nรายการต้นทุนที่ใช้หมวดนี้จะย้ายไปอยู่หมวด "อื่น ๆ"`)) return;
    return run(async () => {
      const { moved } = await api.deleteCostCategory(c.id);
      onChange(categories.filter((x) => x.id !== c.id));
      return moved ? `ลบหมวด "${c.name}" แล้ว ย้าย ${moved} รายการไปหมวด "อื่น ๆ"` : `ลบหมวด "${c.name}" แล้ว`;
    });
  };
  /** Enter saves this box only; it must not submit the settings form around it */
  const onEnter = (action: () => void) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    action();
  };

  return (
    <div className={`pb-card p-6 md:p-8 space-y-4 ${className}`}>
      <div>
        <h3 className="text-base md:text-lg text-ink font-semibold">หมวดต้นทุน</h3>
        <p className="text-sm text-ink-muted">หมวดที่เลือกได้ตอนใส่รายการต้นทุนของงาน เพิ่มหมวดของร้านเองได้ การเปลี่ยนแปลงตรงนี้บันทึกทันที</p>
      </div>
      <div>
        <p className="pb-label">หมวดมาตรฐาน (แก้ไขไม่ได้)</p>
        <div className="flex flex-wrap gap-2">
          {builtIn.map((c) => (
            <span key={c.id} className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#F1F0F5] text-ink-muted">{c.label}</span>
          ))}
        </div>
      </div>
      <div>
        <p className="pb-label">หมวดของร้าน</p>
        {categories.length === 0 && <p className="text-sm text-ink-muted">ยังไม่มีหมวดที่เพิ่มเอง</p>}
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <input
                className={inputClass}
                aria-label={`ชื่อหมวด ${c.name}`}
                maxLength={50}
                value={names[c.id] ?? c.name}
                onChange={(e) => setNames({ ...names, [c.id]: e.target.value })}
                onBlur={() => rename(c)}
                onKeyDown={onEnter(() => rename(c))}
              />
              <button type="button" onClick={() => remove(c)} disabled={busy} aria-label={`ลบหมวด ${c.name}`} title="ลบหมวด" className="p-2 rounded-full text-ink-muted hover:text-rose-600 hover:bg-rose-50 shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input className={inputClass} aria-label="ชื่อหมวดใหม่" placeholder="เช่น ค่าสถานที่" maxLength={50} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={onEnter(add)} />
        <button type="button" onClick={add} disabled={busy} className="pb-btn-secondary shrink-0 whitespace-nowrap">
          <Plus className="w-4 h-4" />
          เพิ่มหมวด
        </button>
      </div>
      {note && <p className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{note.text}</p>}
    </div>
  );
}

export function AccountSettings({ user, onUserUpdated, onLogout, onLogoutAll, onNavigate }: AccountSettingsProps) {
  const [form, setForm] = useState({
    name: user.name,
    businessName: user.businessName,
    businessAddress: user.businessAddress,
    businessPhone: user.businessPhone,
    businessTaxId: user.businessTaxId,
    businessLogo: user.businessLogo,
    vatMode: user.vatMode,
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [rules, setRules] = useState<Rules>(withDefaults(user.rules));

  const handleLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const businessLogo = await resizeLogo(file);
      setForm((f) => ({ ...f, businessLogo }));
      setMessage(null);
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  };
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [field]: e.target.value });

  const handleLogoutAll = async () => {
    if (!window.confirm('ออกจากระบบทุกเครื่อง รวมถึงเครื่องนี้ ใช่หรือไม่?')) return;
    try {
      await onLogoutAll();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const { user: updated } = await api.updateAccount({ ...form, rules, ...(newPassword ? { currentPassword, newPassword } : {}) });
      onUserUpdated(updated);
      setCurrentPassword('');
      setNewPassword('');
      setMessage({ ok: true, text: 'บันทึกการตั้งค่าเรียบร้อยแล้ว' });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="p-5 md:p-10 pb-28 md:pb-10">
        <h1 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight mb-1">ตั้งค่า</h1>
        <p className="text-sm text-ink-muted mt-1 mb-8">ข้อมูลร้าน โลโก้ และบัญชีของคุณ</p>

        {/* on phones these pages aren't in the bottom bar, so reach them from here */}
        <div className="md:hidden pb-card mb-6 divide-y divide-line overflow-hidden">
          {[
            { id: 'receipts', label: 'ใบเสร็จ', icon: Receipt },
            { id: 'customers', label: 'ลูกค้า', icon: Users },
            { id: 'reports', label: 'รายงาน', icon: BarChart3 },
            { id: 'subscription', label: 'แพ็กเกจของร้าน', icon: Crown },
            ...(user.role === 'admin' ? [{ id: 'admin', label: 'ผู้ดูแลระบบ', icon: ShieldCheck }] : []),
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => onNavigate(id)} className="w-full flex items-center gap-3 px-5 py-4 text-left text-ink">
              <Icon className="w-5 h-5 text-[#673AB7]" />
              <span className="flex-1 font-medium">{label}</span>
              <ChevronRight className="w-4 h-4 text-ink-muted" />
            </button>
          ))}
        </div>

        {/* one column on small screens, in the order-N sequence; two columns on wide ones */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-6 xl:grid xl:grid-cols-2 xl:items-start">
          <div className="contents xl:flex xl:flex-col xl:gap-6">
            <div className="pb-card p-6 md:p-8 space-y-4 order-1">
              <div>
                <h3 className="text-base md:text-lg text-ink font-semibold">ร้าน / บริษัท</h3>
                <p className="text-sm text-ink-muted">ชื่อและโลโก้นี้จะแสดงแทน ProfitBloom ในเมนู และบนใบเสนอราคาที่ส่งให้ลูกค้า</p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center xl:flex-col xl:items-start 2xl:flex-row 2xl:items-center gap-5 py-2">
                {/* live preview of how the sidebar header will look */}
                <div className="flex items-center gap-3 rounded-2xl px-4 py-3 bg-gradient-to-br from-[#7C4DDB] to-[#35235e] text-white sm:w-64 shrink-0">
                  <div className="w-11 h-11 rounded-xl bg-white/95 p-1 shrink-0">
                    <img src={form.businessLogo || brandLogo({ ...user, businessLogo: '' })} alt="" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{form.businessName.trim() || 'ProfitBloom'}</p>
                    <p className="text-xs text-white/65">ตัวอย่างในเมนู</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoFile} />
                  <button type="button" onClick={() => fileInput.current?.click()} className="pb-btn-secondary">
                    <ImagePlus className="w-4 h-4" />
                    {form.businessLogo ? 'เปลี่ยนโลโก้' : 'อัปโหลดโลโก้'}
                  </button>
                  {form.businessLogo && (
                    <button type="button" onClick={() => setForm((f) => ({ ...f, businessLogo: '' }))} className="pb-btn-secondary !text-rose-600">
                      <Trash2 className="w-4 h-4" />
                      ใช้โลโก้ ProfitBloom
                    </button>
                  )}
                  <p className="w-full text-xs text-ink-muted">PNG, JPG หรือ WebP ภาพสี่เหลี่ยมจัตุรัสพื้นใสจะดูดีที่สุด</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="pb-label">ชื่อร้าน / บริษัท (แสดงแทน ProfitBloom)</label>
                  <input className={inputClass} value={form.businessName} onChange={set('businessName')} placeholder="เช่น ร้านดอกไม้บลูม" />
                </div>
                <div className="md:col-span-2">
                  <label className="pb-label">ที่อยู่</label>
                  <textarea className={inputClass} rows={2} value={form.businessAddress} onChange={set('businessAddress')} />
                </div>
                <div>
                  <label className="pb-label">เบอร์โทรศัพท์</label>
                  <input className={inputClass} value={form.businessPhone} onChange={set('businessPhone')} />
                </div>
                <div>
                  <label className="pb-label">เลขประจำตัวผู้เสียภาษี</label>
                  <input className={inputClass} value={form.businessTaxId} onChange={set('businessTaxId')} />
                </div>
              </div>
            </div>

            <div className="pb-card p-6 md:p-8 space-y-4 order-4">
              <h3 className="text-base md:text-lg text-ink font-semibold">บัญชีผู้ใช้</h3>
              <div>
                <label className="pb-label">ชื่อ</label>
                <input className={inputClass} value={form.name} onChange={set('name')} required />
              </div>
              <div>
                <label className="pb-label">อีเมล</label>
                <input className={`${inputClass} bg-[#F7F6FA] text-ink-muted`} value={user.email} disabled />
              </div>
            </div>

            <div className="pb-card p-6 md:p-8 space-y-4 order-5">
              <h3 className="text-base md:text-lg text-ink font-semibold">เปลี่ยนรหัสผ่าน</h3>
              <p className="text-sm text-ink-muted">เว้นว่างไว้หากไม่ต้องการเปลี่ยน</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="pb-label">รหัสผ่านปัจจุบัน</label>
                  <input className={inputClass} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
                </div>
                <div>
                  <label className="pb-label">รหัสผ่านใหม่</label>
                  <input className={inputClass} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} autoComplete="new-password" />
                </div>
              </div>
              <p className="text-xs text-ink-muted">เมื่อเปลี่ยนรหัสผ่าน เครื่องอื่นที่เข้าสู่ระบบค้างไว้จะถูกออกจากระบบ</p>
              <div className="pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center xl:flex-col xl:items-start 2xl:flex-row 2xl:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">ออกจากระบบทุกเครื่อง</p>
                  <p className="text-sm text-ink-muted">ใช้เมื่อเคยเข้าสู่ระบบไว้บนเครื่องอื่น หรือสงสัยว่ามีคนอื่นเข้าบัญชี</p>
                </div>
                <button type="button" onClick={handleLogoutAll} className="pb-btn-secondary shrink-0 whitespace-nowrap">
                  <MonitorSmartphone className="w-4 h-4" />
                  ออกจากระบบทุกเครื่อง
                </button>
              </div>
            </div>
          </div>

          <div className="contents xl:flex xl:flex-col xl:gap-6">
            <div className="pb-card p-6 md:p-8 space-y-4 order-2">
              <div>
                <h3 className="text-base md:text-lg text-ink font-semibold">กติกาธุรกิจ</h3>
                <p className="text-sm text-ink-muted">เกณฑ์ที่ระบบใช้ตัดสินว่างานไหนปลอดภัยหรือเสี่ยง — ปรับให้ตรงกับร้านของคุณ</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {([
                  ['highRiskMargin', 'เสี่ยงสูง เมื่อ Margin ต่ำกว่า (%)', 'งานจะถูกจัดเป็น High Risk'],
                  ['minMargin', 'Margin ขั้นต่ำที่รับได้ (%)', 'ใช้เป็นราคาต่ำสุดที่แนะนำ'],
                  ['goodMargin', 'Margin ที่ดี (%)', 'ใช้เป็นราคาสูงสุดที่แนะนำ'],
                  ['depositPct', 'มัดจำมาตรฐาน (%)', 'ค่าเริ่มต้นของงานใหม่'],
                  ['dailyWage', 'ค่าแรงต่อคนต่อวัน (บาท)', 'ใช้ในเช็คก่อนรับงานและการจำลอง'],
                  ['vehicleCost', 'ค่ารถต่อคัน (บาท)', 'ใช้ในการจำลองสถานการณ์'],
                  ['laborOverrunPct', 'เตือนค่าแรงเกินงบ เมื่อเกิน (%)', 'Labor Overrun หลังจบงาน'],
                ] as Array<[keyof Rules, string, string]>).map(([k, label, hint]) => (
                  <div key={k}>
                    <label className="pb-label">{label}</label>
                    <input
                      className={inputClass}
                      type="number"
                      min="0"
                      inputMode="decimal"
                      value={rules[k]}
                      onChange={(e) => setRules({ ...rules, [k]: e.target.value === '' ? 0 : Number(e.target.value) })}
                    />
                    <p className="text-xs text-ink-muted mt-1">{hint}</p>
                  </div>
                ))}
                <div className="xl:col-span-2 2xl:col-span-1">
                  <label className="pb-label">VAT ในใบเสนอราคา</label>
                  <select className={inputClass} value={form.vatMode} onChange={(e) => setForm({ ...form, vatMode: e.target.value as VatMode })}>
                    <option value="exclusive">บวก VAT เพิ่มจากราคา</option>
                    <option value="inclusive">ราคารวม VAT แล้ว (ถอด VAT)</option>
                    <option value="none">ไม่มี VAT</option>
                  </select>
                  <p className="text-xs text-ink-muted mt-1">ค่าเริ่มต้นของใบเสนอราคาใหม่ เปลี่ยนเป็นรายใบได้</p>
                </div>
              </div>
              <button type="button" onClick={() => setRules(DEFAULT_RULES)} className="text-sm text-[#5A42C6] font-medium hover:underline">
                ใช้ค่าเริ่มต้นของ ProfitBloom
              </button>
            </div>

            <CostCategoriesCard className="order-3" categories={user.costCategories} onChange={(costCategories) => onUserUpdated({ ...user, costCategories })} />
          </div>

          {message && (
            <div className={`order-6 xl:col-span-2 p-3 rounded-lg border text-sm ${message.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {message.text}
            </div>
          )}

          <div className="order-7 xl:col-span-2 flex flex-col md:flex-row md:justify-end gap-3">
            <button
              type="submit"
              disabled={saving}
              className="pb-btn-primary md:order-2 md:min-w-[14rem] disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center justify-center gap-2 px-5 py-[9px] rounded-full border border-red-200 text-[0.9rem] font-semibold text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              ออกจากระบบ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
