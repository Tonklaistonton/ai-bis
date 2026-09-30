'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { isEmail, validateCompose, formatTime } from '../lib/chatUtils';

export default function EmailWorkspace() {
  const { wsEvent, showToast, knowledge } = useApp();
  const [emails, setEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');

  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const reqSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/emails', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== reqSeq.current) return;
      setEmails(Array.isArray(data.emails) ? data.emails : []);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setLoadError('โหลดประวัติอีเมลไม่สำเร็จ');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime refresh of history only — never touches the compose form.
  useEffect(() => {
    if (wsEvent.seq && wsEvent.type === 'email_sent') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsEvent.seq]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return emails;
    return emails.filter(
      (e) =>
        (e.senderEmail || e.to || '').toLowerCase().includes(q) ||
        (e.subject || '').toLowerCase().includes(q) ||
        (e.body || '').toLowerCase().includes(q)
    );
  }, [emails, search]);

  const selected = emails.find((e) => e.id === selectedId) || null;

  const handleSend = async (e) => {
    e.preventDefault();
    if (sending) return;
    const err = validateCompose({ to, text: body });
    if (err) {
      setFormError(err);
      return;
    }
    if (!isEmail(to)) {
      setFormError('รูปแบบอีเมลไม่ถูกต้อง');
      return;
    }
    setFormError('');
    setSending(true);
    try {
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim() || '(ไม่มีหัวข้อ)', text: body })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        showToast(`ส่งอีเมลผ่าน SMTP ไปยัง ${to.trim()} แล้ว`, 'success');
        setTo('');
        setSubject('');
        setBody('');
        await load();
      } else {
        setFormError(data.error || 'ส่งอีเมลไม่สำเร็จ — ข้อความยังอยู่ในฟอร์ม');
      }
    } catch (e2) {
      setFormError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ข้อความยังอยู่ในฟอร์ม');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="gmail-workspace-container">
      <aside className="email-threads-column" aria-label="ประวัติอีเมลที่ส่งแล้ว">
        <div className="threads-top-bar">
          <div className="threads-search">
            <span aria-hidden="true">🔍</span>
            <input
              type="search"
              placeholder="ค้นหาในประวัติ…"
              aria-label="ค้นหาประวัติอีเมล"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="threads-list">
          {loading && !emails.length && <div className="pane-state">กำลังโหลด…</div>}
          {!loading && loadError && (
            <div className="pane-state pane-error">
              <span>{loadError}</span>
              <button type="button" className="btn btn-small" onClick={load}>
                ลองใหม่
              </button>
            </div>
          )}
          {!loading && !loadError && !filtered.length && (
            <div className="pane-state">{emails.length ? 'ไม่พบอีเมลที่ค้นหา' : 'ยังไม่มีประวัติการส่ง'}</div>
          )}
          {filtered.map((em) => (
            <button
              key={em.id}
              type="button"
              className={`thread-item ${em.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(em.id)}
            >
              <div className="thread-header-row">
                <span className="thread-sender-name">{em.senderEmail || em.to || 'ผู้รับ'}</span>
                <span className="thread-time">{formatTime(em.timestamp)}</span>
              </div>
              <div className="thread-subject">{em.subject || '(ไม่มีหัวข้อ)'}</div>
              <div className="thread-preview">{(em.body || '').slice(0, 90)}</div>
              <span className="status-chip-email">✓ ส่งแล้ว (SMTP)</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="email-reading-column">
        {selected && (
          <div className="history-detail-card">
            <div className="history-detail-head">
              <div>
                <div className="history-detail-subject">{selected.subject || '(ไม่มีหัวข้อ)'}</div>
                <div className="history-detail-meta">
                  ผู้รับ: {selected.senderEmail || selected.to || '-'} ·{' '}
                  {selected.timestamp ? new Date(selected.timestamp).toLocaleString('th-TH') : '-'}
                </div>
              </div>
              <button type="button" className="topbar-icon-btn" aria-label="ปิดรายละเอียด" onClick={() => setSelectedId(null)}>
                ×
              </button>
            </div>
            <pre className="history-detail-body">{selected.body || ''}</pre>
          </div>
        )}

        <form className="card compose-card" onSubmit={handleSend} noValidate>
          <div className="card-head">
            <h2 className="card-title">เขียนอีเมลใหม่</h2>
          </div>
          <p className="card-note">
            ส่งผ่าน Gmail SMTP ของร้าน{knowledge?.shopName ? ` (${knowledge.shopName})` : ''} · ระบบมีเฉพาะการส่งออก
            ไม่มีการดึงอีเมลเข้า
          </p>

          <label htmlFor="compose-to">ผู้รับ</label>
          <input
            id="compose-to"
            type="email"
            className="field"
            placeholder="example@mail.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            disabled={sending}
            autoComplete="email"
          />

          <label htmlFor="compose-subject">หัวข้อ</label>
          <input
            id="compose-subject"
            type="text"
            className="field"
            placeholder="หัวข้ออีเมล"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
          />

          <label htmlFor="compose-body">เนื้อหา</label>
          <textarea
            id="compose-body"
            className="field compose-body"
            rows={8}
            placeholder="พิมพ์เนื้อหาอีเมล…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={sending}
          />

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}

          <div className="compose-actions">
            <button type="submit" className="btn btn-primary" disabled={sending || !to.trim() || !body.trim()}>
              {sending ? 'กำลังส่งผ่าน SMTP…' : 'ส่งอีเมล'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
