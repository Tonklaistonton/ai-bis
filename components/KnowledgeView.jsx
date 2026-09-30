'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './AppProvider';

const KB_FIELDS = [
  { key: 'shopName', label: 'ชื่อร้าน', type: 'input' },
  { key: 'openingHours', label: 'เวลาเปิด-ปิด', type: 'input' },
  { key: 'contactInfo', label: 'ช่องทางติดต่อ', type: 'input' },
  { key: 'products', label: 'รายการสินค้า', type: 'textarea' },
  { key: 'promotions', label: 'โปรโมชั่น', type: 'textarea' },
  { key: 'payment', label: 'การชำระเงิน', type: 'textarea' },
  { key: 'delivery', label: 'การจัดส่ง', type: 'textarea' },
  { key: 'persona', label: 'บุคลิกการตอบ', type: 'textarea' }
];

export default function KnowledgeView() {
  const { role, knowledge, saveKnowledge, setPinModalOpen, wsEvent, showToast } = useApp();
  const [tab, setTab] = useState('kb'); // kb | data
  const [form, setForm] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const initedRef = useRef(false);

  const [airtable, setAirtable] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState('');
  const [syncing, setSyncing] = useState('');
  const [scriptModal, setScriptModal] = useState(null);
  const [scriptLoading, setScriptLoading] = useState(false);

  // Populate form once; never clobber in-progress edits from realtime updates.
  useEffect(() => {
    if (initedRef.current || !knowledge) return;
    setForm({ ...knowledge });
    initedRef.current = true;
  }, [knowledge]);

  useEffect(() => {
    if (!wsEvent.seq || dirty) return;
    if (wsEvent.type === 'airtable_synced' || wsEvent.type === 'sheets_synced') {
      if (wsEvent.data?.knowledge) setForm({ ...wsEvent.data.knowledge });
      loadDbData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsEvent.seq]);

  const loadDbData = useCallback(async () => {
    setDbLoading(true);
    setDbError('');
    try {
      const [aRes, sRes] = await Promise.all([
        fetch('/api/airtable/data', { headers: { Accept: 'application/json' } }),
        fetch('/api/sheets/data', { headers: { Accept: 'application/json' } })
      ]);
      if (!aRes.ok || !sRes.ok) throw new Error('HTTP error');
      const a = await aRes.json();
      const s = await sRes.json();
      setAirtable(a.data || null);
      setSheets(s.data || null);
    } catch (e) {
      setDbError('โหลดข้อมูลฐานข้อมูลไม่สำเร็จ');
    } finally {
      setDbLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDbData();
  }, [loadDbData]);

  if (role !== 'admin') {
    return (
      <div className="gate-card">
        <h2>ส่วนนี้สำหรับแอดมิน</h2>
        <p>
          การปลดล็อกเป็นการ<strong>จำกัดหน้าจอ</strong>เท่านั้น ไม่ใช่สิทธิ์ของเซิร์ฟเวอร์
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setPinModalOpen(true)}>
          ใส่ PIN เพื่อปลดล็อก
        </button>
      </div>
    );
  }

  const onChange = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const ok = await saveKnowledge(form);
      if (ok) setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async (which) => {
    setSyncing(which);
    try {
      const res = await fetch(which === 'airtable' ? '/api/airtable/sync' : '/api/sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(which === 'airtable' ? {} : { url: '' })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        showToast(`ซิงก์ ${which === 'airtable' ? 'Airtable' : 'Google Sheets'} แล้ว`, 'success');
        if (data.knowledge) {
          setForm((f) => (dirty ? f : { ...f, ...data.knowledge }));
        }
        await loadDbData();
      } else {
        showToast(data.message || data.error || 'ซิงก์ไม่สำเร็จ', 'error');
      }
    } catch (e) {
      showToast('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', 'error');
    } finally {
      setSyncing('');
    }
  };

  const openScriptModal = async () => {
    setScriptLoading(true);
    setScriptModal({ loading: true });
    try {
      const res = await fetch('/api/sheets/apps-script');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) setScriptModal({ ...data, loading: false });
      else setScriptModal({ error: data.error || 'โหลดสคริปต์ไม่สำเร็จ', loading: false });
    } catch (e) {
      setScriptModal({ error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้', loading: false });
    } finally {
      setScriptLoading(false);
    }
  };

  const counts = (d) =>
    d
      ? `สินค้า ${d.products?.length || 0} · คำถาม ${d.faqs?.length || 0} · คู่มือ ${d.orderGuides?.length || 0}`
      : '-';

  return (
    <div className="knowledge-view">
      <div className="tabs" role="tablist" aria-label="ส่วนข้อมูลร้าน">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'kb'}
          className={`tab-btn ${tab === 'kb' ? 'active' : ''}`}
          onClick={() => setTab('kb')}
        >
          ข้อมูลร้าน (Knowledge Base)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'data'}
          className={`tab-btn ${tab === 'data' ? 'active' : ''}`}
          onClick={() => setTab('data')}
        >
          ข้อมูลที่ซิงก์
        </button>
      </div>

      {tab === 'kb' && (
        <div className="kb-form" role="tabpanel">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">ข้อมูลที่ AI ใช้ตอบลูกค้า</h2>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !dirty}>
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
            <p className="card-note">
              {dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : 'โหลดจากเซิร์ฟเวอร์แล้ว · ข้อมูลจาก Airtable/Sheets ที่ซิงก์ใหม่จะอัปเดตเฉพาะเมื่อไม่ได้กำลังแก้ไข'}
            </p>
            <div className="kb-grid">
              {KB_FIELDS.map((f) => (
                <div className={`kb-field ${f.type === 'textarea' ? 'kb-wide' : ''}`} key={f.key}>
                  <label htmlFor={`kb-${f.key}`}>{f.label}</label>
                  {f.type === 'input' ? (
                    <input
                      id={`kb-${f.key}`}
                      className="field"
                      type="text"
                      value={form[f.key] || ''}
                      onChange={(e) => onChange(f.key, e.target.value)}
                    />
                  ) : (
                    <textarea
                      id={`kb-${f.key}`}
                      className="field"
                      rows={3}
                      value={form[f.key] || ''}
                      onChange={(e) => onChange(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="db-panels" role="tabpanel">
          <div className="card">
            <div className="card-head">
              <h2 className="card-title">Airtable</h2>
              <div className="btn-row">
                <button type="button" className="btn btn-ghost" onClick={loadDbData} disabled={dbLoading}>
                  รีเฟรช
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleSync('airtable')}
                  disabled={Boolean(syncing)}
                >
                  {syncing === 'airtable' ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้'}
                </button>
              </div>
            </div>
            {dbLoading && <p className="pane-state">กำลังโหลด…</p>}
            {dbError && (
              <p className="form-error" role="alert">
                {dbError}
              </p>
            )}
            <dl className="intel-list">
              <div>
                <dt>รายการ</dt>
                <dd>{counts(airtable)}</dd>
              </div>
              <div>
                <dt>ซิงก์ล่าสุด</dt>
                <dd>{airtable?.lastSync ? new Date(airtable.lastSync).toLocaleString('th-TH') : 'ยังไม่เคยซิงก์'}</dd>
              </div>
            </dl>
          </div>

          <div className="card">
            <div className="card-head">
              <h2 className="card-title">Google Sheets</h2>
              <div className="btn-row">
                <button type="button" className="btn btn-secondary" onClick={openScriptModal} disabled={scriptLoading}>
                  ดูสคริปต์ Apps Script
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleSync('sheets')}
                  disabled={Boolean(syncing)}
                >
                  {syncing === 'sheets' ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้'}
                </button>
              </div>
            </div>
            <dl className="intel-list">
              <div>
                <dt>รายการ</dt>
                <dd>{counts(sheets)}</dd>
              </div>
              <div>
                <dt>ซิงก์ล่าสุด</dt>
                <dd>{sheets?.lastSync ? new Date(sheets.lastSync).toLocaleString('th-TH') : 'ยังไม่เคยซิงก์'}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      {scriptModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="สคริปต์ Apps Script">
          <div className="modal-card modal-wide">
            <div className="card-head">
              <h2>Apps Script — Webhook ซิงก์ชีต</h2>
              <button type="button" className="icon-btn" aria-label="ปิด" onClick={() => setScriptModal(null)}>
                ×
              </button>
            </div>
            {scriptModal.loading && <p>กำลังโหลด…</p>}
            {scriptModal.error && <p className="form-error">{scriptModal.error}</p>}
            {scriptModal.webhookUrl && (
              <>
                <label>Webhook URL</label>
                <input className="field mono" type="text" readOnly value={scriptModal.webhookUrl} />
                <label>สคริปต์</label>
                <pre className="script-body">{scriptModal.script}</pre>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      navigator.clipboard?.writeText(scriptModal.script);
                      showToast('คัดลอกสคริปต์แล้ว', 'success');
                    }}
                  >
                    คัดลอกสคริปต์
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setScriptModal(null)}>
                    ปิด
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
