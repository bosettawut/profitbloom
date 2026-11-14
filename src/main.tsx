import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LandingPage } from './landing/LandingPage';
import { api } from './lib/api';
import './index.css';

/**
 * Tiny path router:
 *   /          public landing page
 *   /login     sign-in   (the app shows it when nobody is logged in)
 *   /signup    sign-up
 *   /forgot    ask for a password reset link      /reset?token=…   the page that link opens
 *   /app/...   the ProfitBloom app itself (its own screens are in src/lib/route.ts)
 */
const here = () => window.location.pathname + window.location.search;

function Root() {
  const [path, setPath] = useState(here);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const onPop = () => setPath(here());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (path === '/') api.me().then(({ user }) => setLoggedIn(!!user)).catch(() => setLoggedIn(false));
  }, [path]);

  /** replace: swap the current history entry, so the back button doesn't return to it */
  const go = (to: string, { replace = false } = {}) => {
    if (to === here()) return;
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  };

  if (path === '/') return <LandingPage isLoggedIn={loggedIn} onNavigate={go} />;
  return <App authMode={path === '/signup' ? 'register' : path === '/forgot' ? 'forgot' : 'login'} path={path} go={go} />;
}

createRoot(document.getElementById('root')!).render(<Root />);
