import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Save } from 'lucide-react';
import { api, type Project, type User } from '../lib/api';
import { health, learnings, marginToMarkup, type CostCategory } from '../lib/decision';
import { rulesOf, toJob } from '../lib/job';
import { emailError, phoneError } from '../../shared/contact.js';
import { blankGroup, blankItem, CostsStage } from './job/CostsStage';
import { HealthPanel } from './job/HealthPanel';
import { CustomerPicker } from './CustomerPicker';
import { useCustomerContactPrompt } from './CustomerContactPrompt';

interface NewProjectProps {
  user: User;
  onCreated: (project: Project) => void;
}

const PROJECT_TYPES = ['งานแต่งงาน', 'งานหมั้น', 'งานวันเกิด', 'งานบวช', 'งานเปิดร้าน', 'อื่นๆ'];

const steps = [
  { id: 1, title: 'ข้อมูลงาน' },
  { id: 2, title: 'ต้นทุนและราคา' },
  { id: 3, title: 'เช็คสุขภาพงาน' },
];

/** A new job opens with two headings of these four empty rows; the name box of each shows a typical item in grey. */
const STARTER_ROWS: Array<{ hint: string; category: CostCategory }> = [
  { hint: 'เช่น โอเอซิส', category: 'material' },
  { hint: 'เช่น ค่าแรง', category: 'labor' },
  { hint: 'เช่น ค่าขนส่ง', category: 'transport' },
  { hint: 'เช่น กุหลาบขาว', category: 'material' },
];

/** The step the browser's current history entry stands for: "ถัดไป" adds an entry per step, so the browser's back button goes one step back. */
const stepOfEntry = (): number => {
  const s = window.history.state?.wizardStep;
  return s === 2 || s === 3 ? s : 1;
};

/** New job: the same building blocks as the job workspace, so nothing has to be typed twice later. */
export function NewProject({ user, onCreated }: NewProjectProps) {
  const rules = useMemo(() => rulesOf(user), [user]);
  const [step, setStep] = useState(1);

  useEffect(() => {
    // a refresh, or coming back from another page, lands on a later step's entry with an empty form: rewind to the first step
    const stale = stepOfEntry();
    if (stale > 1) {
      window.history.replaceState({ ...window.history.state, wizardStep: 1 }, '');
      window.history.go(1 - stale);
    }
    const onPop = () => {
      // a number still being typed is kept on blur, so keep it before its box goes away
      (document.activeElement as HTMLElement | null)?.blur?.();
      setStep(stepOfEntry());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [history, setHistory] = useState<Project[]>([]);
  const [starter] = useState(() => {
    const markup = marginToMarkup(rules.goodMargin);
    const costGroups = [blankGroup(markup), blankGroup(markup)];
    const hints: Record<number, string> = {};
    const costItems = costGroups.flatMap((g) =>
      STARTER_ROWS.map((row) => {
        const item = blankItem(row.category, g.id);
        hints[item.id] = row.hint;
        return item;
      }),
    );
    return { costGroups, costItems, hints };
  });
  const [draft, setDraft] = useState<Project>(() => {
    return {
    id: 'new',
    customerId: null,
    code: '',
    title: '',
    projectType: 'งานแต่งงาน',
    client: '',
    phone: '',
    email: '',
    eventDate: '',
    budget: 0,
    notes: '',
    status: 'draft',
    statusText: 'ร่าง',
    createdDate: '',
    profitMargin: marginToMarkup(rules.goodMargin),
    agreedPrice: null,
    depositPct: rules.depositPct,
    setupDays: 1,
    eventDays: 1,
    laborDays: null,
    teamSize: null,
    ownerLabor: null,
    teardown: null,
    reviewApplied: false,
    reviewedAt: null,
    costGroups: starter.costGroups,
    costItems: starter.costItems,
    };
  });

  useEffect(() => {
    api.projects().then(setHistory).catch(() => {});
  }, []);

  const patch = (p: Partial<Project>) => setDraft((d) => ({ ...d, ...p }));
  const job = useMemo(() => toJob(draft), [draft]);
  const h = useMemo(() => health(job, rules), [job, rules]);
  const lessons = useMemo(() => learnings(history.filter((p) => p.reviewApplied).map(toJob)), [history]);
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(''), 3000);
  };

  const contactPrompt = useCustomerContactPrompt();

  const missing = () => {
    if (!draft.title.trim()) return 'กรุณากรอกชื่องาน';
    if (!draft.eventDate) return 'กรุณาเลือกวันที่จัดงาน';
    return phoneError(draft.phone) || emailError(draft.email);
  };
  const next = () => {
    const m = step === 1 ? missing() : '';
    if (m) return flash(m);
    window.history.pushState({ wizardStep: step + 1 }, '');
    setStep(step + 1);
    window.scrollTo(0, 0);
  };
  /** back through the browser's own history, so its back and forward buttons stay in step with the page */
  const back = (steps = 1) => window.history.go(-steps);

  const save = async () => {
    const m = missing();
    if (m) {
      if (step > 1) back(step - 1);
      return flash(m);
    }
    const updateCustomer = await contactPrompt.ask({ customerId: draft.customerId, name: draft.client, phone: draft.phone, email: draft.email });
    if (updateCustomer === null) return;
    setSaving(true);
    try {
      const { id, code, statusText, createdDate, ...body } = draft;
      // rows left empty are not saved, and neither is a heading with no name and nothing in it
      const costItems = draft.costItems.filter((i) => i.name.trim() || i.quantity * i.price > 0);
      const created = await api.createProject({
        ...body,
        updateCustomer,
        costGroups: draft.costGroups.filter((g) => g.name.trim() || costItems.some((i) => i.groupId === g.id)),
        costItems,
      });
      onCreated(created);
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, key: keyof Project, type = 'text', placeholder = '') => (
    <div>
      <label className="pb-label">{label}</label>
      <input className="pb-input" type={type} placeholder={placeholder} value={(draft[key] as string) ?? ''} onChange={(e) => patch({ [key]: e.target.value } as Partial<Project>)} />
    </div>
  );

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      <div className="mb-6 md:mb-8">
        <h2 className="text-2xl md:text-[28px] font-semibold text-ink tracking-tight mb-1">สร้างโปรเจ็กต์ใหม่</h2>
        <p className="text-sm text-ink-muted">ใส่ข้อมูลงานและต้นทุน ระบบจะเช็คสุขภาพกำไรให้ก่อนบันทึก</p>
      </div>

      <div className="mb-6 md:mb-8 px-1 flex items-center">
        {steps.map((s, index) => (
          <div key={s.id} className={`flex items-center ${index < steps.length - 1 ? 'flex-1' : ''}`}>
            <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-medium ${step >= s.id ? 'bg-[#673AB7] text-white' : 'bg-[#F1F0F5] text-ink-muted'}`}>{s.id}</div>
            <span className={`ml-2.5 text-sm font-medium whitespace-nowrap ${step >= s.id ? 'text-ink' : 'text-ink-muted'}`}>{s.title}</span>
            {index < steps.length - 1 && <div className={`hidden sm:block flex-1 h-px mx-3 ${step > s.id ? 'bg-[#673AB7]' : 'bg-line'}`} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="pb-card p-5 md:p-8 grid md:grid-cols-2 gap-4">
          {field('ชื่องาน *', 'title', 'text', 'เช่น งานแต่งงาน - คุณสมชาย & คุณมาลี')}
          <div>
            <label className="pb-label">ประเภทงาน *</label>
            <select className="pb-input" value={draft.projectType} onChange={(e) => patch({ projectType: e.target.value })}>
              {PROJECT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="pb-label">ชื่อลูกค้า</label>
            <CustomerPicker
              value={draft.client}
              placeholder="เช่น คุณสมชาย"
              onChange={(client) => patch({ client, customerId: null })}
              onPick={(c) => patch({ customerId: c.id, client: c.name, phone: c.phone, email: c.email })}
            />
          </div>
          {field('เบอร์โทรศัพท์', 'phone', 'tel', 'เช่น 081-234-5678')}
          {field('อีเมล', 'email', 'email', 'เช่น customer@email.com')}
          {field('วันที่จัดงาน *', 'eventDate', 'date')}
          <div className="md:col-span-2">
            <label className="pb-label">หมายเหตุ</label>
            <textarea className="pb-input" rows={3} value={draft.notes} placeholder="เช่น สีธีมม่วง-ทอง, งานแต่งงานแบบไทยประยุกต์" onChange={(e) => patch({ notes: e.target.value })} />
          </div>
        </div>
      )}
      {step === 2 && <CostsStage draft={draft} patch={patch} rules={rules} h={h} lessons={lessons} nameHints={starter.hints} />}
      {step === 3 && <HealthPanel h={h} budget={draft.budget} />}

      <div className="mt-6 flex flex-col-reverse md:flex-row md:justify-end gap-3">
        {step > 1 && (
          <button onClick={() => back()} className="pb-btn-secondary">
            <ArrowLeft className="w-4 h-4" /> ย้อนกลับ
          </button>
        )}
        {step < 3 ? (
          <button onClick={next} className="pb-btn-primary md:min-w-[14rem]">
            ถัดไป <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={save} disabled={saving} className="pb-btn-primary md:min-w-[14rem] disabled:opacity-60">
            <Save className="w-4 h-4" /> {saving ? 'กำลังบันทึก...' : 'บันทึกโปรเจ็กต์'}
          </button>
        )}
      </div>

      {contactPrompt.node}
      {toast && <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-ink text-white px-5 py-3 rounded-full shadow-soft-xl z-50 animate-toast text-sm">{toast}</div>}
    </div>
  );
}
