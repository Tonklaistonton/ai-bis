'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppProvider';
import { buildSessions, filterMessages, findPendingDraft, canSendMessage, formatTime } from '../lib/chatUtils';

const AVATAR_OK = /^https:\/\//;
const MODE_TEXT = { autopilot: 'ตอบอัตโนมัติ', copilot: 'ช่วยร่าง', assist: 'ช่วยแนะ' };
const PROVIDER_TEXT = { gemini: 'Gemini', openai: 'OpenAI', smart_nlp: 'NLP ในตัว' };

export default function LineWorkspace() {
  const { config, knowledge, soundOn, wsEvent, showToast, wsStatus } = useApp();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeUserId, setActiveUserId] = useState(null);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState({});
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectedIds, setRejectedIds] = useState(() => new Set());
  const [showChatMobile, setShowChatMobile] = useState(false);
  const reqSeq = useRef(0);
  const composingRef = useRef(false);
  const listEndRef = useRef(null);

  const load = useCallback(async (opts = {}) => {
    const seq = ++reqSeq.current;
    if (!opts.silent) {
      setLoading(true);
      setLoadError('');
    }
    try {
      const res = await fetch('/api/line/messages?limit=200', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== reqSeq.current) return;
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setLoadError('');
    } catch (e) {
      if (seq !== reqSeq.current) return;
      setLoadError('โหลดข้อความไม่สำเร็จ');
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // WebSocket events only trigger an HTTP refresh; HTTP stays the source of truth.
  useEffect(() => {
    if (!wsEvent.seq) return;
    if (
      wsEvent.type === 'line_message_delivered' ||
      wsEvent.type === 'line_message_pending' ||
      wsEvent.type === 'line_message_received'
    ) {
      load({ silent: true });
      if (wsEvent.type === 'line_message_received' && soundOn) playChime();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsEvent.seq]);

  const sessions = useMemo(() => buildSessions(messages), [messages]);
  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.userName.toLowerCase().includes(q) ||
        s.userId.toLowerCase().includes(q) ||
        s.lastText.toLowerCase().includes(q)
    );
  }, [sessions, search]);

  // Keep the selected room inside the real session list.
  useEffect(() => {
    if (!sessions.length) {
      if (activeUserId !== null) setActiveUserId(null);
      return;
    }
    if (!activeUserId || !sessions.some((s) => s.userId === activeUserId)) {
      setActiveUserId(sessions[0].userId);
    }
  }, [sessions, activeUserId]);

  const activeSession = sessions.find((s) => s.userId === activeUserId) || null;
  const activeMessages = useMemo(() => filterMessages(messages, activeUserId), [messages, activeUserId]);
  const pendingDraft = useMemo(() => findPendingDraft(messages, activeUserId), [messages, activeUserId]);
  const pendingVisible = Boolean(pendingDraft) && !rejectedIds.has(pendingDraft.messageId || pendingDraft.id);

  const draft = activeUserId ? drafts[activeUserId] || '' : '';

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end' });
  }, [activeMessages.length, activeUserId]);

  const setDraft = (text) => {
    if (!activeUserId) return;
    setDrafts((d) => ({ ...d, [activeUserId]: text }));
  };

  const handleSend = async () => {
    if (!canSendMessage({ text: draft, activeUserId, sending })) return;
    const targetUser = activeUserId;
    const text = drafts[targetUser];
    setSending(true);
    try {
      const res = await fetch('/api/line/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: targetUser, text })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // Clear only this customer's draft after backend confirmation.
        setDrafts((d) => ({ ...d, [targetUser]: '' }));
        if (data.delivered) {
          showToast('ส่งข้อความแล้ว', 'success');
        } else {
          showToast('บันทึกข้อความแล้ว — ระบบยืนยันการส่งถึงลูกค้าไม่ได้', 'info');
        }
        await load({ silent: true });
      } else {
        showToast(data.error || 'ส่งข้อความไม่สำเร็จ — ข้อความยังอยู่ในช่องพิมพ์', 'error');
      }
    } catch (e) {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ข้อความยังอยู่ในช่องพิมพ์', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleApprove = async () => {
    if (approving || !pendingDraft) return;
    const targetUser = pendingDraft.userId || activeUserId;
    setApproving(true);
    try {
      const res = await fetch('/api/line/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: pendingDraft.messageId || pendingDraft.id,
          replyToken: pendingDraft.replyToken,
          userId: targetUser,
          text: pendingDraft.reply
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        if (data.delivered) {
          showToast('ส่งคำตอบแล้ว', 'success');
        } else {
          showToast('บันทึกคำตอบแล้ว — ระบบยืนยันการส่งถึงลูกค้าไม่ได้', 'info');
        }
        await load({ silent: true });
      } else {
        showToast(data.error || 'ส่งคำตอบไม่สำเร็จ — ร่างยังคงอยู่', 'error');
      }
    } catch (e) {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ร่างยังคงอยู่', 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleReject = () => {
    if (!pendingDraft) return;
    const id = pendingDraft.messageId || pendingDraft.id;
    setRejectedIds((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
    showToast('ซ่อนร่างนี้ในหน้านี้ (ยังไม่ถูกลบออกจากเซิร์ฟเวอร์)', 'info');
  };

  const onComposerKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (composingRef.current || e.nativeEvent.isComposing) return; // IME guard
    e.preventDefault();
    handleSend();
  };

  const selectSession = (userId) => {
    setActiveUserId(userId);
    setShowChatMobile(true);
  };

  return (
    <div className={`chat-workspace-container ${showChatMobile ? 'mobile-show-chat' : ''}`}>
      <aside className="chat-sessions-sidebar" aria-label="รายชื่อลูกค้า">
        <div className="session-search-box">
          <span aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder="ค้นหาลูกค้า…"
            aria-label="ค้นหาลูกค้า"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="sessions-list" role="listbox" aria-label="ห้องสนทนา">
          {loading && !sessions.length && <div className="pane-state">กำลังโหลด…</div>}
          {!loading && loadError && (
            <div className="pane-state pane-error">
              <span>{loadError}</span>
              <button type="button" className="btn btn-small" onClick={() => load()}>
                ลองใหม่
              </button>
            </div>
          )}
          {!loading && !loadError && !filteredSessions.length && (
            <div className="pane-state">
              {sessions.length ? 'ไม่พบลูกค้าที่ค้นหา' : 'ยังไม่มีข้อความจากลูกค้า'}
            </div>
          )}
          {filteredSessions.map((s) => (
            <button
              key={s.userId}
              type="button"
              role="option"
              aria-selected={s.userId === activeUserId}
              className={`session-item session-row ${s.userId === activeUserId ? 'active' : ''}`}
              onClick={() => selectSession(s.userId)}
            >
              <span className="session-avatar line-av" aria-hidden="true">
                {s.userAvatar && AVATAR_OK.test(s.userAvatar) ? (
                  <img src={s.userAvatar} alt="" />
                ) : (
                  (s.userName || 'L').charAt(0).toUpperCase()
                )}
              </span>
              <span className="session-body">
                <span className="session-name-row">
                  <span className="session-user-name">{s.userName}</span>
                  <span className="session-time">{formatTime(s.lastTs)}</span>
                </span>
                <span className="session-preview">{s.lastText}</span>
              </span>
              {s.pending && (
                <span className="pending-dot" title="มีร่างรอตรวจ">
                  ●
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-main-window" aria-label="ห้องสนทนา">
        <header className="chat-top-header">
          <button
            type="button"
            className="topbar-icon-btn back-btn"
            aria-label="กลับไปรายชื่อลูกค้า"
            onClick={() => setShowChatMobile(false)}
          >
            ←
          </button>
          <div className="chat-header-user">
            <div className="chat-head-info">
              <span className="session-user-name chat-head-name">
                {activeSession ? activeSession.userName : 'ไม่มีห้องสนทนา'}
              </span>
              <span className="msg-time-label chat-head-sub">{activeUserId || ''}</span>
            </div>
          </div>
          <span className="copilot-badge mode-chip">โหมด: {MODE_TEXT[config?.mode] || MODE_TEXT.copilot}</span>
          <button
            type="button"
            className="topbar-icon-btn"
            aria-label="โหลดข้อความใหม่"
            title="โหลดข้อความใหม่"
            onClick={() => load()}
          >
            ↻
          </button>
        </header>

        {!activeUserId ? (
          <div className="chat-empty">
            {loadError ? (
              <>
                <p>{loadError}</p>
                <button type="button" className="btn btn-small" onClick={() => load()}>
                  ลองใหม่
                </button>
              </>
            ) : (
              <p>{loading ? 'กำลังโหลด…' : 'เลือกลูกค้าจากรายการทางซ้ายเพื่อเริ่มสนทนา'}</p>
            )}
          </div>
        ) : (
          <>
            <div className="chat-messages-area" role="log" aria-label="ข้อความในห้อง">
              {loading && !activeMessages.length && <div className="pane-state">กำลังโหลดข้อความ…</div>}
              {loadError && !activeMessages.length && (
                <div className="pane-state pane-error">
                  <span>{loadError}</span>
                  <button type="button" className="btn btn-small" onClick={() => load()}>
                    ลองใหม่
                  </button>
                </div>
              )}
              {!loading && !loadError && !activeMessages.length && (
                <div className="pane-state">ยังไม่มีข้อความในห้องนี้</div>
              )}
              {activeMessages.map((m) => (
                <div
                  key={m.id || `${m.timestamp}-${m.text}`}
                  className={`chat-bubble-row ${m.isBot ? 'user-row' : 'customer-row'}`}
                >
                  <div className={m.isBot ? 'msg-bubble-user' : 'msg-bubble-customer'}>
                    <div className="msg-text">{m.text}</div>
                    <div className="msg-meta">
                      <span className="msg-time-label">{formatTime(m.timestamp)}</span>
                      {m.isBot && <span className="msg-tag">บอท/แอดมิน</span>}
                      {m.status === 'pending_approval' && <span className="msg-tag tag-pending">รอตรวจ</span>}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={listEndRef} />
            </div>

            {pendingVisible && (
              <div className="copilot-active-card" role="region" aria-label="ร่างคำตอบโหมดช่วยร่าง">
                <div className="copilot-card-head">
                  <span className="copilot-badge">ร่างคำตอบ (ช่วยร่าง)</span>
                </div>
                <div className="copilot-context">ตอบ: “{pendingDraft.text}”</div>
                <div className="copilot-draft-body">{pendingDraft.reply}</div>
                <div className="copilot-btn-row">
                  <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={approving}>
                    {approving ? 'กำลังส่ง…' : 'อนุมัติและส่ง'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={handleReject} disabled={approving}>
                    ซ่อนร่าง
                  </button>
                </div>
              </div>
            )}

            <div className="chat-input-row">
              <label className="sr-only" htmlFor="line-composer">
                พิมพ์ข้อความถึงลูกค้า
              </label>
              <textarea
                id="line-composer"
                className="composer-textarea"
                rows={2}
                placeholder="พิมพ์ข้อความ… (Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่)"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKeyDown}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                disabled={sending}
              />
              <button
                type="button"
                className="chat-send-btn"
                aria-label="ส่งข้อความ"
                onClick={handleSend}
                disabled={!canSendMessage({ text: draft, activeUserId, sending })}
              >
                {sending ? '…' : 'ส่ง'}
              </button>
            </div>
          </>
        )}
      </section>

      <aside className="chat-intel-sidebar" aria-label="ข้อมูลห้องสนทนา">
        <div className="intel-card">
          <h4>สถานะระบบ</h4>
          <div className="intel-data-list">
            <div className="intel-item">
              <span className="i-label">โหมด</span>
              <span className="i-val">{MODE_TEXT[config?.mode] || MODE_TEXT.copilot}</span>
            </div>
            <div className="intel-item">
              <span className="i-label">เครื่องมือตอบ</span>
              <span className="i-val">{PROVIDER_TEXT[config?.aiProvider] || config?.aiProvider || 'smart_nlp'}</span>
            </div>
            <div className="intel-item">
              <span className="i-label">ร้าน</span>
              <span className="i-val">{knowledge?.shopName || '-'}</span>
            </div>
            <div className="intel-item">
              <span className="i-label">การเชื่อมต่อ</span>
              <span className="i-val">{wsStatus === 'connected' ? 'WebSocket ออนไลน์' : 'ใช้ HTTP โหลดข้อมูล'}</span>
            </div>
          </div>
        </div>
        <div className="intel-card">
          <h4>ห้องนี้</h4>
          <div className="intel-data-list">
            <div className="intel-item">
              <span className="i-label">ลูกค้า</span>
              <span className="i-val">{activeSession?.userName || '-'}</span>
            </div>
            <div className="intel-item">
              <span className="i-label">userId</span>
              <span className="i-val mono">{activeUserId || '-'}</span>
            </div>
            <div className="intel-item">
              <span className="i-label">ข้อความ</span>
              <span className="i-val">{activeMessages.length}</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch (e) {
    /* audio is best-effort */
  }
}
