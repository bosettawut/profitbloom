/**
 * Where the user is inside the app, kept in the address bar so the browser's back/forward
 * buttons (and refresh) move between app screens instead of leaving the app.
 *
 *   /app                      dashboard
 *   /app/projects             project list        /app/projects/new   new project
 *   /app/projects/12          one job             ?edit=1 opens it on the cost step
 *   /app/quotes               quote list          /app/quotes/new     new quote (?project=12 builds it from a job)
 *   /app/quotes/7             one quote           ?preview=1 opens the preview
 *   /app/receipts             receipt list        /app/receipts/3     one receipt (made from a quote's page)
 *   /app/customers            customer list       /app/customers/5    one customer
 *   /app/quick-check · /app/reports · /app/settings · /app/packages · /app/admin
 *
 * The new-project form keeps one address for its three steps and adds a history entry per step
 * itself (see NewProject), so the back button goes one step back there too.
 */
export interface View {
  /** same ids the sidebar uses */
  nav: string;
  projectId?: string;
  edit?: boolean;
  quoteId?: string;
  preview?: boolean;
  fromProjectId?: string;
  customerId?: string;
  receiptId?: string;
}

const PAGE_TO_NAV: Record<string, string> = {
  'quick-check': 'quick-check',
  reports: 'reports',
  settings: 'settings',
  packages: 'subscription',
  admin: 'admin',
};
const NAV_TO_PAGE = Object.fromEntries(Object.entries(PAGE_TO_NAV).map(([page, nav]) => [nav, page]));

const isId = (s: string | undefined | null): s is string => !!s && /^\d+$/.test(s);

export function parseView(path: string): View {
  const url = new URL(path, 'http://x');
  const [root, page, sub] = url.pathname.split('/').filter(Boolean);
  if (root !== 'app' || !page) return { nav: 'dashboard' };
  if (page === 'projects') {
    if (sub === 'new') return { nav: 'new-project' };
    if (isId(sub)) return { nav: 'projects', projectId: sub, edit: url.searchParams.get('edit') === '1' };
    return { nav: 'projects' };
  }
  if (page === 'quotes') {
    if (sub === 'new') {
      const from = url.searchParams.get('project');
      return { nav: 'quotes-new', fromProjectId: isId(from) ? from : undefined };
    }
    if (isId(sub)) return { nav: 'quotes-new', quoteId: sub, preview: url.searchParams.get('preview') === '1' };
    return { nav: 'quotes' };
  }
  if (page === 'customers') return { nav: 'customers', customerId: isId(sub) ? sub : undefined };
  if (page === 'receipts') return { nav: 'receipts', receiptId: isId(sub) ? sub : undefined };
  return { nav: PAGE_TO_NAV[page] ?? 'dashboard' };
}

export function viewPath(v: View): string {
  switch (v.nav) {
    case 'projects':
      return v.projectId ? `/app/projects/${v.projectId}${v.edit ? '?edit=1' : ''}` : '/app/projects';
    case 'new-project':
      return '/app/projects/new';
    case 'quotes':
    case 'quotes-all':
      return '/app/quotes';
    case 'quotes-new':
      if (v.quoteId) return `/app/quotes/${v.quoteId}${v.preview ? '?preview=1' : ''}`;
      return `/app/quotes/new${v.fromProjectId ? `?project=${v.fromProjectId}` : ''}`;
    case 'customers':
      return v.customerId ? `/app/customers/${v.customerId}` : '/app/customers';
    case 'receipts':
      return v.receiptId ? `/app/receipts/${v.receiptId}` : '/app/receipts';
    default:
      return NAV_TO_PAGE[v.nav] ? `/app/${NAV_TO_PAGE[v.nav]}` : '/app';
  }
}
