import type { Project, User } from './api';
import { health, numbers, withDefaults, type Job, type Rules } from './decision';

/** The decision engine's view of a saved project. */
export function toJob(p: Project): Job {
  return {
    costItems: p.costItems.map((i) => ({
      name: i.name,
      // a row with no category chosen counts as "อื่น ๆ" in every check
      category: i.category || 'other',
      quantity: i.quantity,
      price: i.price,
      groupId: i.groupId,
      actual: i.actual,
      isExtra: i.isExtra,
    })),
    groups: p.costGroups,
    profitMargin: p.profitMargin,
    budget: p.budget,
    depositPct: p.depositPct,
    setupDays: p.setupDays,
    eventDays: p.eventDays,
    laborDays: p.laborDays,
    teamSize: p.teamSize,
    ownerLabor: p.ownerLabor,
    teardown: p.teardown,
    agreedPrice: p.agreedPrice,
  };
}

/** what the job sells for: the sum of its headings */
export const salePrice = (p: Project) => numbers(toJob(p)).price;

/** the kinds of job a shop picks from (the job's code starts with the kind's letters, see TYPE_PREFIX on the server) */
export const PROJECT_TYPES = ['งานแต่งงาน', 'งานหมั้น', 'งานวันเกิด', 'งานบวช', 'งานเปิดร้าน', 'อื่นๆ'];

export const rulesOf = (user: User): Rules => withDefaults(user.rules);

export const projectHealth = (p: Project, user: User) => health(toJob(p), rulesOf(user));

export const LEVEL_STYLE = {
  good: { ring: '#16a34a', chip: 'bg-emerald-50 text-emerald-700' },
  watch: { ring: '#d97706', chip: 'bg-amber-50 text-amber-700' },
  risk: { ring: '#e11d48', chip: 'bg-rose-50 text-rose-600' },
} as const;
