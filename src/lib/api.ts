import type { CostCategory, Rules } from './decision';
import type { Rounding, VatMode } from '../../shared/quote-math.js';

export type { Rounding, VatMode };

export type ProjectStatus = 'draft' | 'quote_created' | 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';
export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'cancelled' | 'expired';
/** a receipt in force, or cancelled (it stays, with its number) */
export type ReceiptStatus = 'issued' | 'cancelled';
export type PaymentMethod = 'transfer' | 'cash' | 'cheque';

export interface User {
  id: number;
  name: string;
  email: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  businessTaxId: string;
  /** data URL of the shop logo, empty when not set */
  businessLogo: string;
  /** ProfitBloom subscription plan (same plans as the public website) */
  plan: 'trial' | 'starter' | 'pro';
  /** ISO date the free trial ends, for shops that signed up on the trial */
  trialEndsAt: string | null;
  role: 'shop' | 'admin';
  /** the shop's own business rules; missing keys use the defaults */
  rules: Partial<Rules>;
  /** how new quotes treat VAT unless changed on the quote */
  vatMode: VatMode;
  /** cost categories the shop added to the built-in ones */
  costCategories: ShopCategory[];
}

/** A cost category the shop added; cost items refer to it by id ('c12'). */
export interface ShopCategory {
  id: string;
  name: string;
}

export interface AdminShop {
  id: number;
  name: string;
  email: string;
  businessName: string;
  businessPhone: string;
  hasLogo: boolean;
  plan: User['plan'];
  trialEndsAt: string | null;
  role: User['role'];
  disabled: boolean;
  createdAt: string;
  projects: number;
  quotes: number;
  lastActiveAt: string | null;
}

/** a heading of cost items with its own markup on cost in % (margin = markup ÷ (100 + markup)) */
export interface CostGroup {
  id: number;
  name: string;
  markup: number;
  /** how the heading's discount is given; nothing (or 0) = no discount */
  discountType?: 'percent' | 'baht';
  /** taken off the price the markup gives: a share of it in %, or an amount in baht */
  discount?: number;
}

export interface CostItem {
  id: number;
  /** the heading it sits under; unplanned extras have none */
  groupId: number | null;
  name: string;
  /** '' until one is chosen */
  category: CostCategory | '';
  quantity: number;
  /** what it is counted in (ดอก, กำ, คน, เที่ยว): free text, not used in any sum */
  unit: string;
  price: number;
  total: number;
  /** what it really cost, filled in during/after the event */
  actual: number | null;
  /** unplanned cost that appeared during the event (estimate 0) */
  isExtra: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  lineId: string;
  address: string;
  notes: string;
  /** days of credit this customer is given after the event (0 = none): a new quote for them starts with it */
  creditDays: number;
  /** for the customer's quotes: their tax id and office/branch (a new quote for them starts with these and the address) */
  taxId: string;
  branch: string;
  createdDate: string;
}

/** a customer as the picker hands one over: with what their latest quote carried, for a new quote to start from */
export interface PickedCustomer extends Customer {
  quoteAddress?: string;
  quoteTaxId?: string;
  quoteBranch?: string;
}

/** a customer with what they have bought; sales count jobs that are approved or completed */
export interface CustomerSummary extends Customer {
  /** the address, tax id and branch written on this customer's latest quote that had any ('' when none did) */
  quoteAddress: string;
  quoteTaxId: string;
  quoteBranch: string;
  projectCount: number;
  quoteCount: number;
  soldCount: number;
  totalSales: number;
  lastEventDate: string;
}

export interface CustomerDetail extends CustomerSummary {
  projects: Project[];
  quotes: Quote[];
}

export type CustomerInput = Partial<Omit<Customer, 'id' | 'createdDate'>>;

export interface Project {
  id: string;
  /** the customer in the shop's customer list this job belongs to */
  customerId: string | null;
  title: string;
  code: string;
  eventDate: string;
  budget: number;
  status: ProjectStatus;
  statusText: string;
  client: string;
  phone: string;
  email: string;
  notes: string;
  createdDate: string;
  projectType: string;
  costGroups: CostGroup[];
  costItems: CostItem[];
  /** the whole job's markup on cost in %, worked out from its headings when saved */
  profitMargin: number;
  /** set when the job was made from an accepted quote: its price is fixed at this amount */
  agreedPrice: number | null;
  /**
   * The quote the job's page opens, instead of offering to make one (null while there is none). For an ordinary job
   * it is the quote tied to it: its lines and price are the job's, are changed here, and follow when the job is saved.
   * For a job made from a quote it is that quote (the newest for the job): its price settled the job's, it is not tied.
   */
  quote?: { id: string; code: string; status: QuoteStatus; statusText: string; /** tied to the job: saving the job's prices changes it */ follows?: boolean } | null;
  /** the receipt in force for the job's quote: while there is one the job is finished, and its quote cannot change */
  receipt?: { id: string; code: string } | null;
  depositPct: number;
  setupDays: number;
  eventDays: number;
  laborDays: number | null;
  teamSize: number | null;
  ownerLabor: boolean | null;
  teardown: boolean | null;
  reviewApplied: boolean;
  reviewedAt: string | null;
}

export interface QuoteItem {
  id: number;
  description: string;
  quantity: number;
  /** what the line is counted in (ดอก, กำ, คน); free text, not used in any sum */
  unit: string;
  unitPrice: number;
  total: number;
  /** on a 'line' quote: this line's amount rounds up to a whole baht as soon as it has a fraction */
  roundUp: boolean;
}

export interface Quote {
  id: string;
  code: string;
  projectId: string | null;
  customerId: string | null;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  /** printed under the customer's name, for customers who need the quote for their own paperwork */
  clientAddress: string;
  clientTaxId: string;
  clientBranch: string;
  projectTitle: string;
  /** the customer's own reference, such as a purchase order number */
  referenceNo: string;
  eventDate: string;
  validUntil: string;
  validUntilText: string;
  /** days the customer has to pay after the event (0 = not stated), and the day that comes to ('' without an event date) */
  creditDays: number;
  dueDate: string;
  dueDateText: string;
  notes: string;
  /** for the shop only: never printed on the quote */
  internalNote: string;
  taxRate: number;
  discountRate: number;
  vatMode: VatMode;
  /** 'line': each line chooses to round up to a whole baht and sums keep the satang; 'baht': an older quote, whole baht throughout */
  rounding: Rounding;
  /** the job's price when the quote was made; the lines must come to this after the discount */
  lockedPrice: number | null;
  /** tied to its job: its lines and price are the job's, are changed there, and follow the job when it is saved */
  followsProject?: boolean;
  /** the number of the job this quote belonged to, when that job was deleted (the quote was cancelled with it) */
  deletedProjectCode?: string | null;
  /** on a quote read by itself: the job it follows, the job's price now, and whether the quote still holds what the job gives it */
  job?: { id: string; code: string; title: string; price: number | null; inStep: boolean };
  /**
   * On a quote read by itself: the job whose page opens it. The customer's name, phone and email and the job's name
   * are the same on both, changed on either; the event date is the job's (`eventDate`) and is changed there.
   * `priceFromQuote`: a job made from a quote, whose price follows this quote's lines.
   */
  linkedJob?: { id: string; code: string; eventDate: string; priceFromQuote: boolean };
  /** on the answer to a save: the save changed the job too (the details they share, or its price) */
  jobUpdated?: boolean;
  /**
   * Its latest receipt: in force ('issued': the quote cannot change until it is cancelled), or cancelled (the quote
   * was cancelled with it and left its job, `projectCode`, which takes a new quote).
   */
  receipt?: { id: string; code: string; status: ReceiptStatus; statusText: string; projectId: string | null; projectCode: string } | null;
  status: QuoteStatus;
  statusText: string;
  createdDate: string;
  /** UTC timestamp `YYYY-MM-DD HH:MM:SS` */
  createdAt: string;
  itemCount: number;
  totalAmount: number;
  /** withholding tax: the % the customer holds back from the price without VAT (0 = none) */
  whtRate: number;
  withholding: number;
  /** what the customer actually transfers: totalAmount less withholding */
  payableAmount: number;
  items: QuoteItem[];
}

/** a receipt: a copy of everything its quote printed when it was issued, with the day the money came in and how */
export interface Receipt {
  id: string;
  code: string;
  status: ReceiptStatus;
  statusText: string;
  /** "ใบเสร็จรับเงิน/ใบกำกับภาษี" for a quote with VAT, "ใบเสร็จรับเงิน" without */
  title: string;
  quoteId: string | null;
  quoteCode: string;
  projectId: string | null;
  projectCode: string;
  customerId: string | null;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientAddress: string;
  clientTaxId: string;
  clientBranch: string;
  projectTitle: string;
  referenceNo: string;
  eventDate: string;
  notes: string;
  taxRate: number;
  discountRate: number;
  whtRate: number;
  vatMode: VatMode;
  rounding: Rounding;
  paidDate: string;
  paidDateText: string;
  paymentMethod: PaymentMethod;
  paymentMethodText: string;
  createdDate: string;
  /** UTC timestamp `YYYY-MM-DD HH:MM:SS` */
  createdAt: string;
  cancelledDate: string;
  itemCount: number;
  totalAmount: number;
  withholding: number;
  payableAmount: number;
  items: QuoteItem[];
}

export interface Activity {
  id: number;
  kind: string;
  title: string;
  detail: string;
  created_at: string;
}

export interface ChartPoint {
  month: string;
  sales: number;
  profit: number;
}

export interface Dashboard {
  stats: {
    salesThisMonth: number;
    salesChange: number;
    profitThisMonth: number;
    profitChange: number;
    activeProjects: number;
    newProjectsThisMonth: number;
    successRate: number;
    decidedProjects: number;
  };
  chart: ChartPoint[];
  activities: Activity[];
  recentProjects: Project[];
}

export interface Reports {
  totals: { projects: number; sales: number; profit: number; cost: number };
  /** January to December of `chartYear` */
  chart: ChartPoint[];
  chartYear: number;
  /** the years the chart can show, newest first: those with sales, and this year */
  chartYears: number[];
  byType: Array<{ type: string; projects: number; sold: number; sales: number; profit: number }>;
  byStatus: Array<{ status: ProjectStatus; statusText: string; count: number }>;
  sales: SalesReport;
  /** accepted jobs left out of the figures because their costs are not in yet */
  uncosted: { count: number; sales: number };
}

export interface SalesSum {
  jobs: number;
  sales: number;
  cost: number;
  profit: number;
}

/** sold jobs (approved or completed) inside a date range, counted on the event date */
export interface SalesReport {
  from: string | null;
  to: string | null;
  totals: SalesSum;
  byMonth: Array<SalesSum & { key: string; month: string }>;
  byCustomer: Array<SalesSum & { customerId: string | null; name: string }>;
  jobs: Array<{ id: string; code: string; title: string; date: string; customerId: string | null; customer: string; statusText: string; sales: number; cost: number; profit: number }>;
}

/** set on a save to also store the typed phone number and email on the customer's own record */
interface CustomerUpdate {
  updateCustomer?: boolean;
}
export type ProjectInput = Partial<Omit<Project, 'costItems'>> & CustomerUpdate & {
  costItems?: Array<Pick<CostItem, 'name' | 'quantity' | 'price'> & Partial<Pick<CostItem, 'category' | 'unit' | 'groupId' | 'actual' | 'isExtra'>>>;
  /** the job's quote is already sent or approved and this save would change it: the user has said to go ahead */
  confirmQuoteChange?: boolean;
};
/** a saved job, and whether the save changed the quote tied to it */
export type SavedProject = Project & { quoteUpdated?: boolean };
/** what a refused save says about the quote it would have changed (status 409, `code: 'quote_change'`) */
export interface QuoteChange {
  id: string;
  code: string;
  status: QuoteStatus;
  statusText: string;
  /** the quote's price before VAT as it stands, and what the save would make it */
  price: number;
  newPrice: number;
  /** the save changes the quote's lines (a tied quote: its prices or headings) */
  lines?: boolean;
  /** the details the save changes on the quote (its customer, the job's name, the event date), as they read */
  details?: Array<{ label: string; from: string; to: string }>;
}
export type QuoteInput = Partial<Omit<Quote, 'items'>> & CustomerUpdate & {
  items?: Array<Pick<QuoteItem, 'description' | 'quantity' | 'unitPrice'> & { unit?: string; roundUp?: boolean }>;
};

export class ApiError extends Error {
  /** `data`: whatever else the server sent with the refusal, for the caller to act on */
  constructor(public status: number, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
}

/** the quote a refused job save would have changed, when that is why it was refused */
export const quoteChangeOf = (err: unknown): QuoteChange | null =>
  err instanceof ApiError && err.status === 409 && err.data.code === 'quote_change' ? (err.data.quote as QuoteChange) : null;

/** Fired when any request comes back 401 so the app can drop back to the login screen. */
export const UNAUTHORIZED_EVENT = 'pb:unauthorized';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, data.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่', data);
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: User | null }>('GET', '/auth/me'),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/auth/login', { email, password }),
  register: (name: string, email: string, password: string) => request<{ user: User }>('POST', '/auth/register', { name, email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  /** signs out every device, this one included */
  logoutAll: () => request<{ ok: true }>('POST', '/auth/logout-all'),
  forgotPassword: (email: string) => request<{ ok: true }>('POST', '/auth/forgot', { email }),
  resetCheck: (token: string) => request<{ valid: boolean }>('POST', '/auth/reset/check', { token }),
  resetPassword: (token: string, password: string) => request<{ user: User }>('POST', '/auth/reset', { token, password }),
  updateAccount: (body: Partial<Omit<User, 'id' | 'email' | 'plan' | 'role' | 'trialEndsAt'>> & { name: string; currentPassword?: string; newPassword?: string }) => request<{ user: User }>('PUT', '/account', body),

  dashboard: (range: '6' | '12' | 'year') => request<Dashboard>('GET', `/dashboard?range=${range}`),
  activities: (limit = 50) => request<Activity[]>('GET', `/activities?limit=${limit}`),
  reports: (from = '', to = '', year?: number) => request<Reports>('GET', `/reports?from=${from}&to=${to}${year ? `&year=${year}` : ''}`),

  projects: () => request<Project[]>('GET', '/projects'),
  project: (id: string) => request<Project>('GET', `/projects/${id}`),
  createProject: (body: ProjectInput) => request<Project>('POST', '/projects', body),
  updateProject: (id: string, body: ProjectInput) => request<SavedProject>('PUT', `/projects/${id}`, body),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', `/projects/${id}`),

  customers: () => request<CustomerSummary[]>('GET', '/customers'),
  customer: (id: string) => request<CustomerDetail>('GET', `/customers/${id}`),
  createCustomer: (body: CustomerInput) => request<Customer>('POST', '/customers', body),
  updateCustomer: (id: string, body: CustomerInput) => request<Customer>('PUT', `/customers/${id}`, body),
  deleteCustomer: (id: string) => request<{ ok: true }>('DELETE', `/customers/${id}`),

  createCostCategory: (name: string) => request<ShopCategory>('POST', '/cost-categories', { name }),
  renameCostCategory: (id: string, name: string) => request<ShopCategory>('PUT', `/cost-categories/${id}`, { name }),
  /** moved: how many cost items were refiled under "อื่น ๆ" */
  deleteCostCategory: (id: string) => request<{ ok: true; moved: number }>('DELETE', `/cost-categories/${id}`),

  adminShops: () => request<AdminShop[]>('GET', '/admin/shops'),
  adminUpdateShop: (id: number, body: { plan?: User['plan']; disabled?: boolean }) => request<AdminShop>('PUT', `/admin/shops/${id}`, body),

  quotes: () => request<Quote[]>('GET', '/quotes'),
  quote: (id: string) => request<Quote>('GET', `/quotes/${id}`),
  /** makes a job out of a quote written on its own; the job's price is the quote's */
  createProjectFromQuote: (quoteId: string) => request<Project>('POST', `/quotes/${quoteId}/project`),
  createReceipt: (quoteId: string, body: { paidDate?: string; paymentMethod?: PaymentMethod }) => request<Receipt>('POST', `/quotes/${quoteId}/receipt`, body),
  receipts: () => request<Receipt[]>('GET', '/receipts'),
  receipt: (id: string) => request<Receipt>('GET', `/receipts/${id}`),
  cancelReceipt: (id: string) => request<Receipt>('POST', `/receipts/${id}/cancel`),
  createQuote: (body: QuoteInput) => request<Quote>('POST', '/quotes', body),
  updateQuote: (id: string, body: QuoteInput) => request<Quote>('PUT', `/quotes/${id}`, body),
  /** brings a quote tied to a job into line with the job as it stands (for one made before the two were tied) */
  syncQuote: (id: string, confirmQuoteChange = false) => request<Quote>('POST', `/quotes/${id}/sync`, { confirmQuoteChange }),
  deleteQuote: (id: string) => request<{ ok: true }>('DELETE', `/quotes/${id}`),
};

export const baht = (n: number, decimals = 0) =>
  `฿${n.toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;

export function timeAgo(sqliteUtc: string) {
  const then = new Date(sqliteUtc.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'เมื่อสักครู่';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'เมื่อวาน';
  if (days < 30) return `${days} วันที่แล้ว`;
  return new Date(then).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}
