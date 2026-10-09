import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from 'lucide-react';

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

/**
 * One toast implementation for the whole app. The previous screens each rolled
 * their own `showToast` helper, which is why messages were inconsistent and
 * sometimes swallowed backend errors instead of surfacing them.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((type, title, msg) => {
    const id = ++seq.current;
    setToasts(prev => [...prev, { id, type, title, msg }]);
    // Errors stay until dismissed: an operator must not miss a failed scan.
    if (type !== 'error') {
      setTimeout(() => dismiss(id), type === 'warning' ? 6000 : 3500);
    }
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({
    success: (title, msg) => push('success', title, msg),
    error:   (title, msg) => push('error', title, msg),
    warning: (title, msg) => push('warning', title, msg),
    info:    (title, msg) => push('info', title, msg),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" data-testid="toast-stack" role="status" aria-live="polite">
        {toasts.map(t => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div key={t.id} className={`toast toast--${t.type}`} data-testid={`toast-${t.type}`}>
              <Icon size={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <div className="toast__body">
                <div className="toast__title">{t.title}</div>
                {t.msg && <div className="toast__msg">{t.msg}</div>}
              </div>
              <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
