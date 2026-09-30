'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

let toastSeq = 0;

export default function AppProvider({ children }) {
  const router = useRouter();
  const [config, setConfig] = useState(null);
  const [knowledge, setKnowledge] = useState(null);
  const [status, setStatus] = useState(null);
  const [user, setUser] = useState(null);
  const [authState, setAuthState] = useState('checking'); // checking | anonymous | authenticated
  const [soundOn, setSoundOn] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [wsStatus, setWsStatus] = useState('connecting'); // connecting | connected | reconnecting | offline
  const [wsEvent, setWsEvent] = useState({ type: null, data: null, seq: 0 });
  const [loadingConfig, setLoadingConfig] = useState(true);

  const wsRef = useRef(null);
  const retryTimerRef = useRef(null);
  const retryDelayRef = useRef(2000);
  const closedRef = useRef(false);

  const showToast = useCallback((message, type = 'info') => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  // Any 401 means the session expired or was revoked — send the user to login.
  const handleUnauthorized = useCallback(() => {
    setUser(null);
    setAuthState('anonymous');
    setConfig(null);
    setKnowledge(null);
    setLoadingConfig(false);
    if (typeof window !== 'undefined' && window.location.pathname !== '/login' && window.location.pathname !== '/setup') {
      window.location.href = '/login';
    }
  }, []);

  // ---- session check + initial load (client-side only) ----
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch('/api/auth/me', { signal: ctrl.signal });
        if (!res.ok) {
          handleUnauthorized();
          return;
        }
        const data = await res.json();
        setUser(data.user);
        setAuthState('authenticated');
      } catch (e) {
        if (e.name !== 'AbortError') handleUnauthorized();
        return;
      }

      try {
        const res = await fetch('/api/config', { signal: ctrl.signal });
        if (res.status === 401) return handleUnauthorized();
        if (res.ok) {
          const data = await res.json();
          setConfig(data.config || {});
          setKnowledge(data.knowledge || {});
        }
      } catch (e) {
        if (e.name !== 'AbortError') showToast('โหลดค่าตั้งค่าไม่สำเร็จ', 'error');
      } finally {
        if (!ctrl.signal.aborted) setLoadingConfig(false);
      }

      try {
        const res = await fetch('/api/status', { signal: ctrl.signal });
        if (res.ok) setStatus(await res.json());
      } catch (e) {
        /* status is non-critical */
      }
    })();
    return () => ctrl.abort();
  }, [handleUnauthorized, showToast]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      /* the cookie is cleared regardless */
    }
    setUser(null);
    setAuthState('anonymous');
    router.replace('/login');
  }, [router]);

  // ---- config / knowledge persistence ----
  const saveConfig = useCallback(
    async (partial) => {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: partial, knowledge: undefined })
      });
      if (res.status === 401) {
        handleUnauthorized();
        return false;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.config) setConfig(data.config);
        showToast('บันทึกการตั้งค่าแล้ว', 'success');
        return true;
      }
      showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
      return false;
    },
    [handleUnauthorized, showToast]
  );

  const saveKnowledge = useCallback(
    async (kb) => {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledge: kb })
      });
      if (res.status === 401) {
        handleUnauthorized();
        return false;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.knowledge) setKnowledge(data.knowledge);
        if (data.config) setConfig(data.config);
        showToast('บันทึกข้อมูลร้านแล้ว', 'success');
        return true;
      }
      showToast(data.error || 'บันทึกไม่สำเร็จ', 'error');
      return false;
    },
    [handleUnauthorized, showToast]
  );

  const setMode = useCallback((mode) => {
    setConfig((c) => ({ ...(c || {}), mode }));
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { mode } })
    }).catch(() => {});
  }, []);

  // ---- WebSocket on /ws (never the root path; root breaks Next dev HMR) ----
  useEffect(() => {
    if (authState !== 'authenticated') return undefined;
    closedRef.current = false;
    let cancelled = false;

    const connect = () => {
      if (closedRef.current || cancelled) return;
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      let ws;
      try {
        ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      } catch (e) {
        setWsStatus('offline');
        scheduleRetry();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retryDelayRef.current = 2000;
        setWsStatus('connected');
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        const type = msg.type || msg.event;
        if (!type) return;
        if (type === 'config_updated') {
          if (msg.data?.config) setConfig(msg.data.config);
          if (msg.data?.knowledge) setKnowledge(msg.data.knowledge);
        }
        // init_state is deliberately ignored: HTTP /api/config is the source of truth
        // and chat history must come from the full HTTP list, not the 20-item socket payload.
        setWsEvent((prev) => ({ type, data: msg.data || {}, seq: prev.seq + 1 }));
      };
      ws.onclose = (ev) => {
        if (closedRef.current || cancelled) return;
        if (ev.code === 4401) {
          handleUnauthorized();
          return;
        }
        setWsStatus('reconnecting');
        scheduleRetry();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch (e) {
          /* ignore */
        }
      };
    };

    const scheduleRetry = () => {
      if (retryTimerRef.current) return;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        connect();
      }, retryDelayRef.current);
      retryDelayRef.current = Math.min(retryDelayRef.current * 1.5, 15000);
    };

    connect();
    return () => {
      cancelled = true;
      closedRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        try {
          wsRef.current.close();
        } catch (e) {
          /* ignore */
        }
        wsRef.current = null;
      }
    };
  }, [authState, handleUnauthorized]);

  const value = useMemo(
    () => ({
      config,
      knowledge,
      status,
      user,
      authState,
      logout,
      loadingConfig,
      saveConfig,
      saveKnowledge,
      setConfig,
      setKnowledge,
      setMode,
      soundOn,
      setSoundOn,
      toasts,
      showToast,
      dismissToast,
      wsStatus,
      wsEvent
    }),
    [
      config,
      knowledge,
      status,
      user,
      authState,
      logout,
      loadingConfig,
      saveConfig,
      saveKnowledge,
      setMode,
      soundOn,
      toasts,
      showToast,
      dismissToast,
      wsStatus,
      wsEvent
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}