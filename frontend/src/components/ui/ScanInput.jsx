import React, { useState, useEffect } from 'react';
import { ScanLine, Camera, X, Check, Loader2, Clock, AlertTriangle, RefreshCw } from 'lucide-react';
import BarcodeScannerModal from './BarcodeScannerModal';
import {
  readStoredQueue,
  dismissRejectedScan,
  retryRejectedScan,
  EVENT_QUEUE_UPDATED,
} from '../../api/offlineQueue';

/**
 * The primary input control for every operational screen.
 *
 * Scanning is the main way work gets done in this warehouse, so the scan target
 * is the largest thing on the screen and Enter is wired to submit. Typing is
 * still allowed, but it is a fallback for units with no barcode (or when the
 * camera is unavailable) rather than the normal path.
 *
 * Realtime & Offline Recovery:
 * Displays pending queued scans syncing in the background and surfaces
 * conflicts or server rejections (e.g. wrong bin, invalid SKU) with one-click
 * Retry or Dismiss controls.
 */
export default function ScanInput({
  label = 'Scan barcode',
  placeholder = 'Scan or type a barcode, then press Enter',
  value,
  onChange,
  onScan,
  autoFocus = true,
  disabled = false,
  busy = false,
  hint = '',
  feedback = null,          // { type: 'ok' | 'error' | 'hint', message: string }
  cameraLabel = 'Camera',
  dataTestId = 'scan-input',
  children,
}) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [queuedItems, setQueuedItems] = useState(() => readStoredQueue());

  useEffect(() => {
    const onQueueUpdate = () => {
      setQueuedItems(readStoredQueue());
    };
    window.addEventListener(EVENT_QUEUE_UPDATED, onQueueUpdate);
    return () => window.removeEventListener(EVENT_QUEUE_UPDATED, onQueueUpdate);
  }, []);

  const pendingCount = queuedItems.filter(i => i.status === 'QUEUED' || i.status === 'SYNCING').length;
  const rejectedItems = queuedItems.filter(i => i.status === 'REJECTED');

  // A scan field is often placed inside a page-level <form>, so this control
  // deliberately renders no <form> of its own: Enter is handled directly on
  // the input and the Scan button delegates to the same handler.
  const submit = (e) => {
    e?.preventDefault?.();
    const code = (value ?? '').trim();
    if (!code || disabled || busy) return;
    onScan?.(code);
  };

  return (
    <div className="scan-field">
      {label && (
        <label className="scan-field-label" htmlFor={`${dataTestId}-text`}>
          <ScanLine size={12} /> {label}
        </label>
      )}

      <div className="scan-field-row">
        <input
          id={`${dataTestId}-text`}
          data-testid={`${dataTestId}-text`}
          className="scan-input"
          type="text"
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => onChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(e);
          }}
          autoFocus={autoFocus}
          disabled={disabled || busy}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="scan-btn scan-btn--ghost"
          data-testid={`${dataTestId}-camera`}
          onClick={() => setScannerOpen(true)}
          disabled={disabled}
        >
          <Camera size={14} /> {cameraLabel}
        </button>
        <button
          type="button"
          className="scan-btn"
          data-testid={`${dataTestId}-submit`}
          onClick={submit}
          disabled={disabled || busy || !(value ?? '').trim()}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Scan
        </button>
      </div>

      {pendingCount > 0 && (
        <div
          className="scan-feedback scan-feedback--hint"
          data-testid={`${dataTestId}-queue-pending`}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Clock size={12} className="spin" />
          <span>{pendingCount} offline scan{pendingCount === 1 ? '' : 's'} queued — will sync automatically when online.</span>
        </div>
      )}

      {rejectedItems.map((item) => (
        <div
          key={item.id}
          className="scan-feedback scan-feedback--error"
          data-testid={`${dataTestId}-queue-rejected-${item.id}`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} />
            <span>
              <strong>Scan conflict ({item.label}):</strong> {item.error || 'Server validation rejected scan'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="scan-btn scan-btn--ghost"
              style={{ minHeight: 24, padding: '2px 8px', fontSize: 11 }}
              onClick={() => retryRejectedScan(item.id)}
            >
              <RefreshCw size={10} /> Retry
            </button>
            <button
              type="button"
              className="scan-btn scan-btn--ghost"
              style={{ minHeight: 24, padding: '2px 8px', fontSize: 11 }}
              onClick={() => dismissRejectedScan(item.id)}
            >
              <X size={10} /> Dismiss
            </button>
          </div>
        </div>
      ))}

      {hint && !feedback && (
        <div className="scan-feedback scan-feedback--hint">{hint}</div>
      )}

      {feedback?.message && (
        <div
          className={`scan-feedback scan-feedback--${feedback.type}`}
          data-testid={`${dataTestId}-feedback`}
        >
          {feedback.type === 'ok' && <Check size={14} />}
          {feedback.type === 'error' && <X size={14} />}
          <span>{feedback.message}</span>
        </div>
      )}

      {children}

      {scannerOpen && (
        <BarcodeScannerModal
          onClose={() => setScannerOpen(false)}
          onScan={(code) => {
            setScannerOpen(false);
            onChange?.(code);
            if (code) onScan?.(code);
          }}
        />
      )}
    </div>
  );
}
