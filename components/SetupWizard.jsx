'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const EMPTY = {
  shopName: '',
  openingHours: '',
  contactInfo: '',
  persona: '',
  username: '',
  password: '',
  confirmPassword: ''
};

export default function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  // Once an account exists this wizard is closed for good.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/setup-status')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && !data.needsSetup) router.replace('/login');
      })
      .catch(() => {})
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [router]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const nextStep = (e) => {
    e.preventDefault();
    setError('');
    if (!form.shopName.trim()) {
      setError('กรุณากรอกชื่อร้าน/องค์กร');
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopName: form.shopName,
          openingHours: form.openingHours,
          contactInfo: form.contactInfo,
          persona: form.persona,
          username: form.username,
          password: form.password
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        router.replace('/settings');
        router.refresh();
      } else {
        setError(data.error || 'ตั้งค่าไม่สำเร็จ');
      }
    } catch (err) {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <p>กำลังตรวจสอบสถานะระบบ…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={step === 1 ? nextStep : handleSubmit}>
        <h1>ตั้งค่าระบบครั้งแรก</h1>
        <p className="auth-sub">
          ขั้นที่ {step} จาก 2 — {step === 1 ? 'ข้อมูลร้าน/องค์กร' : 'บัญชีผู้ดูแลระบบ'}
        </p>

        {step === 1 ? (
          <>
            <label htmlFor="setup-shop">ชื่อร้าน / องค์กร *</label>
            <input id="setup-shop" type="text" required value={form.shopName} onChange={set('shopName')} />

            <label htmlFor="setup-hours">เวลาทำการการ</label>
            <input
              id="setup-hours"
              type="text"
              placeholder="เปิดทุกวัน 09:00 - 21:00 น."
              value={form.openingHours}
              onChange={set('openingHours')}
            />

            <label htmlFor="setup-contact">ช่องทางติดต่อ</label>
            <input
              id="setup-contact"
              type="text"
              placeholder="โทร 02-xxx-xxxx, LINE @ร้าน, อีเมล"
              value={form.contactInfo}
              onChange={set('contactInfo')}
            />

            <label htmlFor="setup-persona">โทนการตอบแชท</label>
            <textarea
              id="setup-persona"
              rows={3}
              placeholder="สุภาพ เป็นมิตร ใช้ครับ/ค่ะ ให้ข้อมูลครบถ้วน"
              value={form.persona}
              onChange={set('persona')}
            />
          </>
        ) : (
          <>
            <label htmlFor="setup-username">ชื่อผู้ใช้ผู้ดูแล *</label>
            <input
              id="setup-username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="3-32 ตัว: ตัวอักษร ตัวเลข . _ -"
              required
              value={form.username}
              onChange={set('username')}
            />

            <label htmlFor="setup-password">รหัสผ่าน *</label>
            <input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={set('password')}
            />

            <label htmlFor="setup-confirm">ยืนยันรหัสผ่าน *</label>
            <input
              id="setup-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
            />
            <p className="auth-hint">อย่างน้อย 8 ตัวอักษร · บัญชีนี้จะเป็นผู้ดูแลระบบ</p>
          </>
        )}

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <div className="auth-actions">
          {step === 2 && (
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)} disabled={busy}>
              ย้อนกลับ
            </button>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'กำลังบันทึก…' : step === 1 ? 'ถัดไป' : 'สร้างระบบและเข้าสู่ระบบ'}
          </button>
        </div>
      </form>
    </main>
  );
}