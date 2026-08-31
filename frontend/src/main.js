import { renderDashboard } from './pages/Dashboard.js';
import { renderExceptionQueue } from './pages/ExceptionQueue.js';
import { renderAnalytics } from './pages/Analytics.js';

// ── Application State ─────────────────────────────────────────────────────────
export const state = {
  currentRoute: 'dashboard',
  isNavExpanded: false,
};

// ── DOM Elements ──────────────────────────────────────────────────────────────
const appContainer = document.getElementById('app');
const sideNav      = document.getElementById('side-nav');
const navMenuBtn   = document.getElementById('nav-menu-btn');
const navItems     = document.querySelectorAll('.nav-item');
const shellTitle   = document.getElementById('shell-title');

// ── Route Configuration ───────────────────────────────────────────────────────
const routes = {
  dashboard:  { title: 'Executive Dashboard', render: renderDashboard },
  exceptions: { title: 'Exception Queue',     render: renderExceptionQueue },
  analytics:  { title: 'Financial Analytics', render: renderAnalytics },
};

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  setupEventListeners();
  navigate(state.currentRoute);
}

function setupEventListeners() {
  navMenuBtn.addEventListener('click', () => {
    state.isNavExpanded = !state.isNavExpanded;
    sideNav.classList.toggle('expanded', state.isNavExpanded);
  });

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      const route = e.currentTarget.getAttribute('data-route');
      if (route && route !== state.currentRoute) navigate(route);
    });
  });
}

export function navigate(route) {
  if (!routes[route]) return;
  state.currentRoute = route;
  shellTitle.textContent = routes[route].title;

  navItems.forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-route') === route);
  });

  appContainer.innerHTML = '';
  const pageEl = routes[route].render(navigate);
  pageEl.classList.add('page-view');
  appContainer.appendChild(pageEl);
}

document.addEventListener('DOMContentLoaded', init);
