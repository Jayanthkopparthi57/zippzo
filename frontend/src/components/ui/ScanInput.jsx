import React, { useState } from 'react';
import { ScanLine, Camera, X, Check, Loader2 } from 'lucide-react';
import BarcodeScannerModal from './BarcodeScannerModal';

/**
 * The primary input control for every operational screen.
 *
 * Scanning is the main way work gets done in this warehouse, so the scan target
 * is the largest thing on the screen and Enter is wired to submit. Typing is
 * still allowed, but it is a fallback for units with no barcode (or when the
 * camera is unavailable) rather than the normal path.
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

  const submit = (e) => {
    e.preventDefault();
    const code = (value ?? '').trim();
    if (!code || disabled || busy) return;
    onScan?.(code);
  };

  return (
    <div className="scan-field">
      {label && (
        <label className="scan-field-label" htmlFor={`${dataTestId}-text`}>
          <ScanLine size={13} /> {label}
        </label>
      )}

      <form className="scan-field-row" onSubmit={submit}>
        <input
          id={`${dataTestId}-text`}
          data-testid={`${dataTestId}-text`}
          className="scan-input"
          type="text"
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => onChange?.(e.target.value)}
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
          <Camera size={18} /> {cameraLabel}
        </button>
        <button
          type="submit"
          className="scan-btn"
          data-testid={`${dataTestId}-submit`}
          disabled={disabled || busy || !(value ?? '').trim()}
        >
          {busy ? <Loader2 size={18} className="spin" /> : <Check size={18} />} Scan
        </button>
      </form>

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
