'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginView() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  // A fresh install has no accounts yet - send the operator to the wizard.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/setup-status')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.needsSetup) router.replace('/setup');
      })
      .catch(() => {})
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        window.location.href = '/line';
      } else {
        setError(data.error || 'เข้าสู่ระบบไม่สำเร็จ');
      }
    } catch (err) {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>เข้าสู่ระบบ AIZEN</h1>
        <p className="auth-sub">กรอกบัญชีที่ตั้งค่าไว้กับร้านของคุณ</p>

        <label htmlFor="login-username">ชื่อผู้ใช้</label>
        <input
          id="login-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <label htmlFor="login-password">รหัสผ่าน</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--muted, #8b93a3)' }}>
          บัญชีเดโม: <strong>demo</strong> / <strong>demo1234</strong>
        </div>

        <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy || checking}>
          {busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </main>
  );
}