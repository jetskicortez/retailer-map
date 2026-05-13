const fs = require('fs');
let src = fs.readFileSync('client/src/App.jsx', 'utf8');

const checks = [];

// 1. Wrap mobile hamburger button with embedMode guard
const oldHamburger = `      {/* ─── Mobile hamburger ─── */}
      <button
        className="mobile-menu-btn"
        onClick={() => setSidebarOpen((v) => !v)}
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? '\\u2715' : '\\u2630'}
      </button>`;
const newHamburger = `      {/* ─── Mobile hamburger ─── */}
      {!embedMode && (
        <button
          className="mobile-menu-btn"
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? '\\u2715' : '\\u2630'}
        </button>
      )}`;

// 2. Wrap mobile overlay with embedMode guard
const oldOverlay = `      {/* ─── Mobile overlay ─── */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}`;
const newOverlay = `      {/* ─── Mobile overlay ─── */}
      {!embedMode && sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}`;

// 3. Wrap sidebar aside open tag
const oldSidebarOpen = `      {/* ─── Sidebar ─── */}
      <aside className={\`sidebar\${sidebarOpen ? ' open' : ' collapsed'}\`}>`;
const newSidebarOpen = `      {/* ─── Sidebar ─── */}
      {!embedMode && <aside className={\`sidebar\${sidebarOpen ? ' open' : ' collapsed'}\`}>`;

// 4. Close the conditional after </aside>
const oldSidebarClose = `      </aside>

      {/* ─── Map Panel ─── */}`;
const newSidebarClose = `      </aside>}

      {/* ─── Map Panel ─── */}`;

// 5. Wrap mobile export bar with embedMode guard
const oldMobileExport = `        {/* Mobile export bar */}
        {data && (
          <div className="mobile-export-bar">`;
const newMobileExport = `        {/* Mobile export bar */}
        {!embedMode && data && (
          <div className="mobile-export-bar">`;

const pairs = [
  ['hamburger', oldHamburger, newHamburger],
  ['overlay', oldOverlay, newOverlay],
  ['sidebar open', oldSidebarOpen, newSidebarOpen],
  ['sidebar close', oldSidebarClose, newSidebarClose],
  ['mobile export', oldMobileExport, newMobileExport],
];

let ok = true;
pairs.forEach(([name, old]) => {
  if (!src.includes(old)) { console.error('MISS:', name); ok = false; }
});
if (!ok) process.exit(1);

pairs.forEach(([, old, neu]) => { src = src.replace(old, neu); });

fs.writeFileSync('client/src/App.jsx', src);
console.log('patch applied');
