'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './AppProvider';

const NAV = [
  { href: '/inbox', label: 'กล่องข้อความรวม', key: 'inbox' },
  { href: '/line', label: 'แชท LINE', key: 'line' },
  { href: '/email', label: 'ส่งอีเมล', key: 'email' },
  { href: '/knowledge', label: 'ข้อมูลร้าน', key: 'knowledge' },
  { href: '/settings', label: 'ตั้งค่า', key: 'settings' }
];

const MODE_LABELS = {
  autopilot: 'ตอบอัตโนมัติ',
  copilot: 'ช่วยร่าง',
  assist: 'ช่วยแนะ'
};

export default function AppShell({ children }) {
  const pathname = usePathname();
  const { user, authState, logout, config, setMode, wsStatus, toasts, dismissToast, soundOn, setSoundOn } =
    useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Login and first-run setup must render before any session exists.
  const isAuthRoute = pathname === '/login' || pathname === '/setup';

  const isAdmin = user?.role === 'admin';
  const visibleNav = NAV.filter((n) => isAdmin || n.key === 'inbox' || n.key === 'line' || n.key === 'email');
  const current = NAV.find((n) => pathname.startsWith(n.href));
  const mode = config?.mode || 'copilot';

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle('role-staff', !isAdmin);
    document.body.classList.toggle('role-admin', isAdmin);
  }, [isAdmin]);

  const wsLabel = {
    connected: 'ออนไลน์',
    connecting: 'กำลังเชื่อมต่อ…',
    reconnecting: 'กำลังเชื่อมต่อใหม่…',
    offline: 'ออฟไลน์'
  }[wsStatus];

  if (isAuthRoute) {
    return (
      <>
        {children}
        <div className="toast-container" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-item ${t.type}`} role="status">
              <span className="toast-msg">{t.message}</span>
              <button type="button" className="toast-close" aria-label="ปิดข้อความ" onClick={() => dismissToast(t.id)}>
                ×
              </button>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (authState !== 'authenticated') {
    return (
      <div className="auth-screen">
        <div style={{ textAlign: 'center', color: 'var(--muted, #8b93a3)' }}>
          <p style={{ marginBottom: 12 }}>{authState === 'checking' ? 'กำลังตรวจสอบสิทธิ์…' : 'ยังไม่ได้เข้าสู่ระบบ'}</p>
          <Link href="/login" className="btn btn-primary" style={{ display: 'inline-flex' }}>
            ไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="เมนูหลัก">
        <div className="sidebar-brand">
          <span className="brand-symbol" aria-hidden="true">
            <span className="symbol-inner">AI</span>
          </span>
          <span className="brand-info">
            <span className="brand-name">AIZEN</span>
            <span className="brand-sub">RESPONDER</span>
          </span>
        </div>
        <div className="sidebar-scroll-area">
          <nav className="sidebar-nav">
            {visibleNav.map((n) => (
              <Link key={n.href} href={n.href} className={`nav-item ${pathname.startsWith(n.href) ? 'active' : ''}`}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="sidebar-foot">
          <span className={`ws-dot ws-${wsStatus}`} aria-hidden="true" />
          <span className="ws-label">{wsLabel}</span>
        </div>
      </aside>

      {sidebarOpen && (
        <button type="button" className="sidebar-backdrop" aria-label="ปิดเมนู" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="app-main-canvas">
        <header className="app-topbar">
          <button
            type="button"
            className="topbar-icon-btn hamburger-btn"
            aria-label={sidebarOpen ? 'ปิดเมนู' : 'เปิดเมนู'}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="topbar-breadcrumb">
            <span className="crumb-root">AIZEN</span>
            <span className="crumb-separator">/</span>
            <span className="crumb-active">{current?.label || ''}</span>
          </div>

          <div className="mode-switcher-bar" role="group" aria-label="โหมดการทำงาน">
            <span className="mode-lead-label">โหมด</span>
            {Object.entries(MODE_LABELS).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`mode-tab ${mode === key ? 'active' : ''}`}
                aria-pressed={mode === key}
                onClick={() => setMode(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="topbar-right">
            <button
              type="button"
              className="topbar-icon-btn"
              aria-pressed={soundOn}
              aria-label={soundOn ? 'ปิดเสียงแจ้งเตือนข้อความใหม่' : 'เปิดเสียงแจ้งเตือนข้อความใหม่'}
              title={soundOn ? 'ปิดเสียงแจ้งเตือน' : 'เปิดเสียงแจ้งเตือน'}
              onClick={() => setSoundOn(!soundOn)}
            >
              {soundOn ? '🔔' : '🔕'}
            </button>
            <div className="user-menu">
              <span className="user-chip" title={`${user.username} — ${isAdmin ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่'}`}>
                <span className={`role-dot ${isAdmin ? 'dot-admin' : 'dot-staff'}`} aria-hidden="true" />
                {user.username}
              </span>
              <button type="button" className="topbar-icon-btn" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={logout}>
                ⏻
              </button>
            </div>
          </div>
        </header>

        <main className="main-content-scroll">{children}</main>
      </div>

      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-item ${t.type}`} role="status">
            <span className="toast-msg">{t.message}</span>
            <button type="button" className="toast-close" aria-label="ปิดข้อความ" onClick={() => dismissToast(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}