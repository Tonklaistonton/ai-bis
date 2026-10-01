'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';

// Secrets are write-only: the server sends back a mask, never the real value.
// An untouched field submits the mask unchanged and the server keeps the original.
const MASK_PREFIX = '<set>';

function SecretField({ id, label, value, onChange, hint }) {
  const masked = typeof value === 'string' && value.startsWith(MASK_PREFIX);
  const [draft, setDraft] = useState('');
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="field"
        type="password"
        autoComplete="off"
        placeholder={masked ? 'ตั้งค่าแล้ว — พิมพ์ใหม่เพื่อเปลี่ยน' : 'ยังไม่ได้ตั้งค่า'}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(e.target.value);
        }}
      />
      <p className="hint">{masked ? `✓ ตั้งค่าแล้ว (${value})` : '✗ ยังไม่ได้ตั้งค่า'}</p>
      {hint}
    </>
  );
}

export default function SettingsView() {
  const { user, config, saveConfig, showToast } = useApp();
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState({}); // key: {running, ok, message}
  const [pwForm, setPwForm] = useState({ oldPassword: '', newPassword: '' });
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'staff' });
  const [userBusy, setUserBusy] = useState(false);
  const initedRef = useRef(false);

  useEffect(() => {
    if (initedRef.current || !config) return;
    setForm({ ...config });
    initedRef.current = true;
  }, [config]);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/auth/users')
      .then((r) => r.json())
      .then((d) => d.success && setUsers(d.users))
      .catch(() => {});
  }, [isAdmin]);

  if (user && user.role !== 'admin') {
    return (
      <div className="gate-card">
        <h2>ส่วนตั้งค่าสำหรับผู้ดูแลระบบ</h2>
        <p>
          บัญชี <strong>{user.username}</strong> เป็นสิทธิ์เจ้าหน้าที่ จึงเข้าถึงการตั้งค่าและข้อมูลร้านไม่ได้
          หากต้องการสิทธิ์ผู้ดูแลระบบ ให้สอบถามผู้ดูแลร้านเพื่อเพิ่มสิทธิ์ให้บัญชีนี้
        </p>
      </div>
    );
  }

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const ok = await saveConfig(form);
      if (ok) setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (key, path, body) => {
    setTests((t) => ({ ...t, [key]: { running: true } }));
    try {
      // Never send a mask as a real credential - omit it so the server falls
      // back to the stored key instead.
      const payload = Object.fromEntries(
        Object.entries(body || {}).filter(([, v]) => !String(v).startsWith(MASK_PREFIX))
      );
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      setTests((t) => ({
        ...t,
        [key]: {
          running: false,
          ok: Boolean(data.success),
          message: data.message || data.error || (res.ok ? 'สำเร็จ' : `HTTP ${res.status}`)
        }
      }));
    } catch (e) {
      setTests((t) => ({ ...t, [key]: { running: false, ok: false, message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' } }));
    }
  };

  const flag = (key) => {
    const t = tests[key];
    if (!t) return null;
    if (t.running) return <span className="test-flag">กำลังทดสอบ…</span>;
    return <span className={`test-flag ${t.ok ? 'ok' : 'fail'}`}>{t.ok ? '✓ ' : '✗ '}{t.message}</span>;
  };

  const webhookUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhook/line`;

  return (
    <div className="settings-view">
      <div className="card">
        <div className="card-head">
          <h2 className="card-title">การตั้งค่า AI</h2>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? 'กำลังบันทึก…' : 'บันทึกทั้งหมด'}
          </button>
        </div>
        {dirty && <p className="card-note warn">มีการแก้ไขที่ยังไม่ได้บันทึก</p>}

        <label htmlFor="set-provider">ผู้ให้บริการ AI สำหรับตอบแชท</label>
        <select
          id="set-provider"
          className="field"
          value={form.aiProvider || 'gemini'}
          onChange={(e) => set('aiProvider', e.target.value)}
        >
          <option value="gemini">Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="smart_nlp">NLP ในตัว (ไม่ใช้คีย์ภายนอก)</option>
        </select>

        <div className="settings-grid">
          <div className="settings-col">
            <h3>Gemini</h3>
            <SecretField
              id="set-gemini-key"
              label="API Key"
              value={form.geminiApiKey || ''}
              onChange={(v) => set('geminiApiKey', v)}
            />
            <label htmlFor="set-gemini-model">โมเดล</label>
            <input
              id="set-gemini-model"
              className="field"
              type="text"
              value={form.geminiModel || ''}
              onChange={(e) => set('geminiModel', e.target.value)}
            />
            <p className="hint">
              {form.geminiApiKey ? 'ตั้งค่าคีย์แล้ว (ยังไม่ได้ทดสอบการเชื่อมต่อในหน้านี้)' : 'ยังไม่ได้ตั้งค่าคีย์'}
            </p>
          </div>

          <div className="settings-col">
            <h3>OpenAI</h3>
            <SecretField
              id="set-openai-key"
              label="API Key"
              value={form.openaiApiKey || ''}
              onChange={(v) => set('openaiApiKey', v)}
            />
            <label htmlFor="set-openai-model">โมเดล</label>
            <input
              id="set-openai-model"
              className="field"
              type="text"
              value={form.openaiModel || ''}
              onChange={(e) => set('openaiModel', e.target.value)}
            />
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => runTest('openai', '/api/openai/test', { apiKey: form.openaiApiKey, model: form.openaiModel })}
                disabled={tests.openai?.running}
              >
                ทดสอบ OpenAI
              </button>
              {flag('openai')}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">LINE Official Account</h2>
        <p className="card-note">
          มี Access Token = ตั้งค่าแล้ว ยังไม่ยืนยันว่าบอทใช้งานได้จริง — ทดสอบจริงโดยส่งข้อความเข้า LINE OA
        </p>
        <SecretField
          id="set-line-secret"
          label="Channel Secret"
          value={form.lineChannelSecret || ''}
          onChange={(v) => set('lineChannelSecret', v)}
        />
        <SecretField
          id="set-line-token"
          label="Channel Access Token"
          value={form.lineAccessToken || ''}
          onChange={(v) => set('lineAccessToken', v)}
        />
        <label htmlFor="set-webhook">Webhook URL (ตั้งใน LINE Developers)</label>
        <input id="set-webhook" className="field mono" type="text" readOnly value={webhookUrl} />
        <p className="hint">ส่งข้อความทดสอบเข้า LINE OA จริงเพื่อยืนยันว่าบอททำงาน</p>
      </div>

      <div className="card">
        <h2 className="card-title">Gmail SMTP (ส่งอีเมลออก)</h2>
        <p className="card-note">ระบบมีเฉพาะการส่งออก SMTP ไม่มีการดึงอีเมลเข้า (ไม่มี IMAP/inbox sync)</p>
        <label htmlFor="set-gmail-user">บัญชี Gmail</label>
        <input
          id="set-gmail-user"
          className="field"
          type="email"
          autoComplete="off"
          value={form.gmailUser || ''}
          onChange={(e) => set('gmailUser', e.target.value)}
        />
        <SecretField
          id="set-gmail-pass"
          label="App Password"
          value={form.gmailAppPassword || ''}
          onChange={(v) => set('gmailAppPassword', v)}
        />
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => runTest('smtp', '/api/emails/test-connection', {})}
            disabled={tests.smtp?.running}
          >
            ทดสอบ SMTP
          </button>
          {flag('smtp')}
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">ฐานข้อมูลสินค้า</h2>
        <label htmlFor="set-db-source">แหล่งข้อมูลที่ใช้</label>
        <select
          id="set-db-source"
          className="field"
          value={form.activeDatabase || 'airtable'}
          onChange={(e) => set('activeDatabase', e.target.value)}
        >
          <option value="airtable">Airtable</option>
          <option value="sheets">Google Sheets</option>
          <option value="both">ทั้งสองแหล่ง</option>
        </select>
        <label className="checkbox-row" htmlFor="set-autosync">
          <input
            id="set-autosync"
            type="checkbox"
            checked={Boolean(form.autoSyncEnabled)}
            onChange={(e) => set('autoSyncEnabled', e.target.checked)}
          />
          <span>ซิงก์อัตโนมัติทุก 2 นาที (ตรวจเฉพาะเมื่อมีค่าที่ตั้งไว้)</span>
        </label>

        <div className="settings-grid">
          <div className="settings-col">
            <h3>Airtable</h3>
            <label htmlFor="set-at-token">Personal Access Token</label>
            <input
              id="set-at-token"
              className="field"
              type="password"
              autoComplete="off"
              value={form.airtableApiKey || ''}
              onChange={(e) => set('airtableApiKey', e.target.value)}
            />
            <label htmlFor="set-at-base">Base ID</label>
            <input id="set-at-base" className="field mono" type="text" value={form.airtableBaseId || ''} onChange={(e) => set('airtableBaseId', e.target.value)} />
            <label htmlFor="set-at-prod">ตารางสินค้า</label>
            <input id="set-at-prod" className="field mono" type="text" value={form.airtableProductTable || ''} onChange={(e) => set('airtableProductTable', e.target.value)} />
            <label htmlFor="set-at-faq">ตาราง FAQ</label>
            <input id="set-at-faq" className="field mono" type="text" value={form.airtableFaqTable || ''} onChange={(e) => set('airtableFaqTable', e.target.value)} />
            <label htmlFor="set-at-order">ตารางคู่มือสั่งซื้อ</label>
            <input id="set-at-order" className="field mono" type="text" value={form.airtableOrderTable || ''} onChange={(e) => set('airtableOrderTable', e.target.value)} />
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  runTest('airtable', '/api/airtable/test', {
                    token: form.airtableApiKey,
                    baseId: form.airtableBaseId,
                    tableId: form.airtableProductTable
                  })
                }
                disabled={tests.airtable?.running}
              >
                ทดสอบ Airtable
              </button>
              {flag('airtable')}
            </div>
          </div>

          <div className="settings-col">
            <h3>Google Sheets</h3>
            <label htmlFor="set-sheet-url">ลิงก์ชีต</label>
            <input
              id="set-sheet-url"
              className="field"
              type="url"
              value={form.googleSheetUrl || ''}
              onChange={(e) => set('googleSheetUrl', e.target.value)}
            />
            <label htmlFor="set-sheet-prod-gid">GID ชีตสินค้า</label>
            <input id="set-sheet-prod-gid" className="field mono" type="text" value={form.googleSheetProductsGid || ''} onChange={(e) => set('googleSheetProductsGid', e.target.value)} />
            <label htmlFor="set-sheet-faq-gid">GID ชีต FAQ</label>
            <input id="set-sheet-faq-gid" className="field mono" type="text" value={form.googleSheetFaqsGid || ''} onChange={(e) => set('googleSheetFaqsGid', e.target.value)} />
            <label htmlFor="set-sheet-order-gid">GID ชีตคู่มือสั่งซื้อ</label>
            <input id="set-sheet-order-gid" className="field mono" type="text" value={form.googleSheetOrdersGid || ''} onChange={(e) => set('googleSheetOrdersGid', e.target.value)} />
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => runTest('sheets', '/api/sheets/test', { url: form.googleSheetUrl, gid: form.googleSheetProductsGid })}
                disabled={tests.sheets?.running}
              >
                ทดสอบ Sheets
              </button>
              {flag('sheets')}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Webhook</h2>
        <label htmlFor="set-webhook-domain">โดเมนที่ใช้รับ webhook (LINE / Sheets)</label>
        <input
          id="set-webhook-domain"
          className="field"
          type="text"
          placeholder="https://your-domain.com"
          value={form.webhookDomain || ''}
          onChange={(e) => set('webhookDomain', e.target.value)}
        />
      </div>

      <div className="card">
        <h2 className="card-title">บัญชีผู้ใช้</h2>
        <p className="card-note">
          บัญชีทุกคนต้องเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านที่เซิร์ฟเวอร์ตรวจสอบ —
          รหัสผ่านถูกเก็บแบบเข้ารหัส (scrypt) ไม่ใช่ข้อความธรรมดา
        </p>

        <form
          className="pin-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await fetch('/api/auth/change-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(pwForm)
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
              showToast(data.message || 'เปลี่ยนรหัสผ่านสำเร็จ', 'success');
              setPwForm({ oldPassword: '', newPassword: '' });
              setTimeout(() => window.location.reload(), 1200);
            } else {
              showToast(data.error || 'เปลี่ยนรหัสผ่านไม่สำเร็จ', 'error');
            }
          }}
        >
          <h3>เปลี่ยนรหัสผ่านของคุณ</h3>
          <div className="settings-grid">
            <div className="settings-col">
              <label htmlFor="pw-old">รหัสผ่านเดิม</label>
              <input
                id="pw-old"
                className="field"
                type="password"
                autoComplete="current-password"
                value={pwForm.oldPassword}
                onChange={(e) => setPwForm((p) => ({ ...p, oldPassword: e.target.value }))}
              />
            </div>
            <div className="settings-col">
              <label htmlFor="pw-new">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</label>
              <input
                id="pw-new"
                className="field"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={pwForm.newPassword}
                onChange={(e) => setPwForm((p) => ({ ...p, newPassword: e.target.value }))}
              />
            </div>
          </div>
          <div className="btn-row">
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={!pwForm.oldPassword || pwForm.newPassword.length < 8}
            >
              เปลี่ยนรหัสผ่าน
            </button>
          </div>
          <p className="hint">การเปลี่ยนรหัสผ่านจะออกจากระบบทุกเครื่อง</p>
        </form>

        <h3>สมาชิกทั้งหมด</h3>
        <ul className="user-list">
          {users.map((u) => (
            <li key={u.id} className="user-list-row">
              <span>
                <strong>{u.username}</strong> · {u.role === 'admin' ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่'}
                {u.id === user.id ? ' (คุณ)' : ''}
              </span>
              {u.id !== user.id && (
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={async () => {
                    const res = await fetch(`/api/auth/users/${u.id}`, { method: 'DELETE' });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok && data.success) {
                      setUsers((list) => list.filter((x) => x.id !== u.id));
                      showToast('ลบบัญชีแล้ว', 'success');
                    } else {
                      showToast(data.error || 'ลบบัญชีไม่สำเร็จ', 'error');
                    }
                  }}
                >
                  ลบ
                </button>
              )}
            </li>
          ))}
        </ul>

        <form
          className="pin-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setUserBusy(true);
            try {
              const res = await fetch('/api/auth/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newUser)
              });
              const data = await res.json().catch(() => ({}));
              if (res.ok && data.success) {
                setUsers((list) => [...list, data.user]);
                setNewUser({ username: '', password: '', role: 'staff' });
                showToast('เพิ่มสมาชิกแล้ว', 'success');
              } else {
                showToast(data.error || 'เพิ่มสมาชิกไม่สำเร็จ', 'error');
              }
            } finally {
              setUserBusy(false);
            }
          }}
        >
          <h3>เพิ่มสมาชิกใหม่</h3>
          <div className="settings-grid">
            <div className="settings-col">
              <label htmlFor="new-username">ชื่อผู้ใช้</label>
              <input
                id="new-username"
                className="field"
                type="text"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={newUser.username}
                onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))}
              />
            </div>
            <div className="settings-col">
              <label htmlFor="new-password">รหัสผ่าน (อย่างน้อย 8 ตัว)</label>
              <input
                id="new-password"
                className="field"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={newUser.password}
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
              />
            </div>
            <div className="settings-col">
              <label htmlFor="new-role">สิทธิ์</label>
              <select
                id="new-role"
                className="field"
                value={newUser.role}
                onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}
              >
                <option value="staff">เจ้าหน้าที่</option>
                <option value="admin">ผู้ดูแลระบบ</option>
              </select>
            </div>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-secondary" disabled={userBusy}>
              เพิ่มสมาชิก
            </button>
          </div>
        </form>
      </div>

      <div className="save-bar">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่า'}
        </button>
      </div>
    </div>
  );
}
