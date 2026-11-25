import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Save, X } from 'lucide-react';
import { api, type Project, type User } from '../lib/api';
import { health, learnings, marginToMarkup } from '../lib/decision';
import { rulesOf, toJob } from '../lib/job';
import { emailError, phoneError } from '../../shared/contact.js';
import { useCategoryPrompt } from './job/CategoryPrompt';
import { blankGroup, blankItem, CostsStage, reserveTempIds } from './job/CostsStage';
import { HealthPanel } from './job/HealthPanel';
import { CustomerPicker } from './CustomerPicker';
import { DateField } from './DateField';
import { useCustomerContactPrompt } from './CustomerContactPrompt';

interface NewProjectProps {
  user: User;
  onCreated: (project: Project) => void;
  /** leaves the form without saving */
  onClose: () => void;
}

const PROJECT_TYPES = ['งานแต่งงาน', 'งานหมั้น', 'งานวันเกิด', 'งานบวช', 'งานเปิดร้าน', 'อื่นๆ'];

const steps = [
  { id: 1, title: 'ข้อมูลงาน' },
  { id: 2, title: 'ต้นทุนและราคา' },
  { id: 3, title: 'เช็คสุขภาพงาน' },
];

/** A new job opens with two headings of two empty rows; the name box of each shows one of these typical items in grey. */
const STARTER_HINTS = ['เช่น กุหลาบขาว', 'เช่น ค่าแรง'];

/** The step the browser's current history entry stands for: "ถัดไป" adds an entry per step, so the browser's back button goes one step back. */
const stepOfEntry = (): number => {
  const s = window.history.state?.wizardStep;
  return s === 2 || s === 3 ? s : 1;
};

/** an empty job, with the shop's usual margin and deposit */
function blankDraft(rules: ReturnType<typeof rulesOf>, costGroups: Project['costGroups'], costItems: Project['costItems']): Project {
  return {
    id: 'new',
    customerId: null,
    internalNote: '',
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
    costGroups,
    costItems,
  };
}

/**
 * What has been typed is kept in this tab while the form is open, so a refresh brings it back.
 * The copy belongs to the history entries of this visit to the form (they carry its id): opening the
 * form again from the menu starts empty, and leaving the form, saving or signing out removes the copy.
 */
const DRAFT_KEY = 'pb:new-project-draft';
const FORM_PATH = '/app/projects/new';
interface SavedDraft {
  v: 1;
  id: string;
  userId: number;
  draft: Project;
  hints: Record<number, string>;
}

function savedDraft(userId: number): SavedDraft | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) ?? 'null') as SavedDraft | null;
    const mine = saved?.v === 1 && saved.userId === userId && !!saved.id && saved.id === window.history.state?.wizardDraft;
    return mine && Array.isArray(saved.draft?.costGroups) && Array.isArray(saved.draft?.costItems) ? saved : null;
  } catch {
    return null;
  }
}

const forgetDraft = () => {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage is switched off in this browser: nothing was kept
  }
};

/** marks the browser's current history entry as part of this visit to the form, keeping its step */
const tagEntry = (id: string) => {
  if (window.location.pathname === FORM_PATH && window.history.state?.wizardDraft !== id) window.history.replaceState({ ...window.history.state, wizardDraft: id }, '');
};

/** New job: the same building blocks as the job workspace, so nothing has to be typed twice later. */
export function NewProject({ user, onCreated, onClose }: NewProjectProps) {
  const rules = useMemo(() => rulesOf(user), [user]);
  const [initial] = useState(() => {
    const saved = savedDraft(user.id);
    if (saved) {
      reserveTempIds([...saved.draft.costGroups.map((g) => g.id), ...saved.draft.costItems.map((i) => i.id)]);
      return { id: saved.id, draft: saved.draft, hints: saved.hints ?? {}, restored: true };
    }
    forgetDraft();
    const markup = marginToMarkup(rules.goodMargin);
    const costGroups = [blankGroup(markup), blankGroup(markup)];
    const hints: Record<number, string> = {};
    const costItems = costGroups.flatMap((g) =>
      STARTER_HINTS.map((hint) => {
        const item = blankItem('', g.id);
        hints[item.id] = hint;
        return item;
      }),
    );
    return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, draft: blankDraft(rules, costGroups, costItems), hints, restored: false };
  });
  const [step, setStep] = useState(() => (initial.restored ? stepOfEntry() : 1));

  useEffect(() => {
    // with nothing to bring back, a later step's entry (coming back from another page) would show an empty form: rewind to the first step
    const stale = initial.restored ? 1 : stepOfEntry();
    if (stale > 1) {
      window.history.replaceState({ ...window.history.state, wizardStep: 1 }, '');
      window.history.go(1 - stale);
    } else {
      tagEntry(initial.id);
    }
    const onPop = () => {
      // a number still being typed is kept on blur, so keep it before its box goes away
      (document.activeElement as HTMLElement | null)?.blur?.();
      setStep(stepOfEntry());
      tagEntry(initial.id);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // leaving the form inside the app (another screen, saved, signed out): the copy is not needed any more
      forgetDraft();
    };
  }, []);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [history, setHistory] = useState<Project[]>([]);
  const [draft, setDraft] = useState<Project>(initial.draft);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, id: initial.id, userId: user.id, draft, hints: initial.hints } satisfies SavedDraft));
    } catch {
      // storage is full or switched off: the form still works, it just won't survive a refresh
    }
  }, [draft]);

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
  const categoryPrompt = useCategoryPrompt();

  const missing = () => {
    if (!draft.title.trim()) return 'กรุณากรอกชื่องาน';
    if (!draft.eventDate) return 'กรุณาเลือกวันที่จัดงาน';
    return phoneError(draft.phone) || emailError(draft.email);
  };
  const next = async () => {
    const m = step === 1 ? missing() : '';
    if (m) return flash(m);
    // filled-in cost rows with no category: a dialog asks whether to go back and choose, or to carry on
    if (step === 2 && !(await categoryPrompt.ask(draft.costItems))) return;
    // the browser's back button was used while the dialog was open: this is no longer the step that was left
    if (stepOfEntry() !== step) return;
    window.history.pushState({ wizardStep: step + 1, wizardDraft: initial.id }, '');
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
      {type === 'date' ? (
        // the event date is required: no "clear" button
        <DateField label={label.replace(/\s*\*$/, '')} value={(draft[key] as string) ?? ''} onChange={(v) => patch({ [key]: v } as Partial<Project>)} clearable={false} />
      ) : (
        <input className="pb-input" type={type} placeholder={placeholder} value={(draft[key] as string) ?? ''} onChange={(e) => patch({ [key]: e.target.value } as Partial<Project>)} />
      )}
    </div>
  );

  /** anything typed or chosen in the form, so leaving it is asked about first */
  const hasInput =
    (['title', 'client', 'phone', 'email', 'notes', 'eventDate'] as const).some((k) => String(draft[k] ?? '').trim() !== '') ||
    draft.costItems.some((i) => i.name.trim() !== '' || i.price > 0 || i.quantity !== 1) ||
    draft.costGroups.some((g) => g.name.trim() !== '');
  const close = () => {
    if (hasInput && !window.confirm('มีข้อมูลที่ยังไม่บันทึก ออกจากหน้านี้เลยหรือไม่?')) return;
    onClose();
  };

  return (
    <div className="p-5 md:p-10 pb-28 md:pb-10">
      <div className="mb-6 md:mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl md:text-[1.75rem] font-semibold text-ink tracking-tight mb-1">สร้างโปรเจ็กต์ใหม่</h2>
          <p className="text-sm text-ink-muted">ใส่ข้อมูลงานและต้นทุน ระบบจะเช็คสุขภาพกำไรให้ก่อนบันทึก</p>
        </div>
        {/* the menu is put away on this page, so the way out is here, as on a new quote */}
        <button type="button" onClick={close} className="pb-btn-secondary shrink-0">
          <X className="w-4 h-4" />
          ปิดหน้าต่าง
        </button>
      </div>

      {/* on a phone the three steps share the width equally, each name under its number, so the bar fits any screen */}
      <div className="mb-6 md:mb-8 px-1 flex items-start sm:items-center">
        {steps.map((s, index) => (
          <div key={s.id} className={`flex flex-col sm:flex-row items-center gap-1.5 sm:gap-0 flex-1 min-w-0 ${index < steps.length - 1 ? '' : 'sm:flex-none'}`}>
            <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm font-medium ${step >= s.id ? 'bg-[#673AB7] text-white' : 'bg-[#F1F0F5] text-ink-muted'}`}>{s.id}</div>
            <span className={`sm:ml-2.5 text-xs sm:text-sm font-medium text-center sm:whitespace-nowrap ${step >= s.id ? 'text-ink' : 'text-ink-muted'}`}>{s.title}</span>
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
      {step === 2 && <CostsStage draft={draft} patch={patch} rules={rules} h={h} lessons={lessons} nameHints={initial.hints} />}
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
      {categoryPrompt.node}
      {toast && <div className="fixed top-5 left-1/2 -translate-x-1/2 bg-ink text-white px-5 py-3 rounded-full shadow-soft-xl z-50 animate-toast text-sm">{toast}</div>}
    </div>
  );
}
