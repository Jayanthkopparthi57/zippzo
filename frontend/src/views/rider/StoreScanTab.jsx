import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Store, Camera, Keyboard } from 'lucide-react';
import { postApi, describeError } from '../../api/client';

const RIDERS = '/delivery/rider-profiles/';
const SHIFTS = '/delivery/rider-shifts/';

/**
 * The rider clocks in by scanning the QR taped to the store counter.
 *
 * The store's QR is `zippzo:site:<SITE_CODE>` — the same code the store
 * console shows its staff. Scanning it starts (or idempotently keeps) the
 * rider's shift at that store and flips them online for dispatch. There is
 * no separate "show the store my code" direction anymore: orders reach the
 * rider automatically once they are on shift.
 */
export default function StoreScanTab({ profile, shift, onShiftChanged }) {
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [manualOpen, setManualOpen] = useState(false);

  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const mountedRef = useRef(true);

  const stopCamera = useCallback(() => {
    try {
      controlsRef.current?.stop?.();
    } catch { /* camera already released */ }
    controlsRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  const clockIn = useCallback(async (siteCode) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await postApi(`${SHIFTS}open/`, { site_code: siteCode });
      await postApi(`${RIDERS}${profile.rider_id}/set_online/`, { is_online: true });
      if (mountedRef.current) {
        setNote(`Clocked in at ${siteCode}. You're online — jobs come to you automatically.`);
      }
      onShiftChanged?.();
    } catch (err) {
      if (mountedRef.current) setError(describeError(err));
    } finally {
      if (mountedRef.current) {
        setBusy(false);
        stopCamera();
      }
    }
  }, [busy, profile?.rider_id, onShiftChanged, stopCamera]);

  const handleDecoded = useCallback((raw) => {
    const text = String(raw || '').trim();
    const match = text.match(/^zippzo:site:([A-Za-z0-9_-]+)$/i)
      || text.match(/^site:([A-Za-z0-9_-]+)$/i);
    if (!match) {
      setError('That is not a Zippzo store QR.');
      return;
    }
    clockIn(match[1].toUpperCase());
  }, [clockIn]);

  const startScanner = useCallback(async () => {
    setError('');
    setNote('');
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      if (!mountedRef.current) return;
      setScanning(true);
      const reader = new BrowserMultiFormatReader();
      controlsRef.current = await reader.decodeFromVideoDevice(
        { facingMode: 'environment' },
        videoRef.current,
        (result) => {
          if (result) {
            handleDecoded(result.getText());
          }
        },
      );
    } catch {
      if (mountedRef.current) {
        setScanning(false);
        setError('Camera unavailable. Check permission, or enter the store code below.');
      }
    }
  }, [handleDecoded]);

  const endShift = useCallback(async () => {
    if (!shift || busy) return;
    setBusy(true);
    setError('');
    try {
      await postApi(`${SHIFTS}${shift.shift_id}/close/`, { reason: 'MANUAL' });
      await postApi(`${RIDERS}${profile.rider_id}/set_online/`, { is_online: false });
      setNote('Shift ended. You are offline; no jobs will reach you until you clock in again.');
      onShiftChanged?.();
    } catch {
      setError('Could not end the shift. Try again.');
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [shift, busy, profile, onShiftChanged]);

  if (shift) {
    return (
      <div className="rv3-page" data-testid="rd-scan">
        <h1>Clocked in</h1>
        <div className="rv3-card">
          <div className="rv3-shift-live">
            <span className="rv3-shift-live-dot" />
            <span>
              Shift open · started{' '}
              {new Date(shift.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <h2 style={{ fontFamily: 'Space Grotesk', fontSize: 24, margin: '12px 0 2px' }}>
            {profile?.current_site_code || shift.site || 'DS-VERIFY-1'}
          </h2>
          <p style={{ fontSize: 13, color: '#66766d', margin: 0 }}>
            Jobs reach you automatically while you are on shift. Scan the store QR any time to re-clock-in.
          </p>
          <div className="rv3-amount-row" style={{ marginTop: 14 }}>
            <div className="rv3-amount-tile">
              <div className="rv3-amount-label">Orders</div>
              <div className="rv3-amount-value" style={{ fontSize: 19 }}>{shift.orders_delivered ?? 0}</div>
            </div>
            <div className="rv3-amount-tile">
              <div className="rv3-amount-label">Distance</div>
              <div className="rv3-amount-value" style={{ fontSize: 19 }}>
                {shift.distance_km ? `${Number(shift.distance_km).toFixed(1)} km` : '—'}
              </div>
            </div>
          </div>
          <button className="rv3-cta" style={{ background: '#177a45', color: '#fff', boxShadow: '0 10px 26px rgba(23, 122, 69, 0.35)' }}
                  onClick={endShift} disabled={busy}>
            {busy ? 'Working…' : <>End shift & go offline</>}
          </button>
        </div>
        {note && <div role="status" className="rv3-banner rv3-banner--ok" style={{ position: 'static', marginTop: 12 }}>{note}</div>}
        {error && <div role="alert" className="rv3-banner rv3-banner--error" style={{ position: 'static', marginTop: 12 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="rv3-page" data-testid="rd-scan">
      <h1>Clock in</h1>

      {!scanning ? (
        <div className="rv3-card">
          <div className="rv3-scan-badge"><Store size={15} /> Store QR</div>
          <h2 style={{ fontFamily: 'Space Grotesk', fontSize: 23, lineHeight: 1.15, margin: '10px 0 6px' }}>
            Scan the QR at the store counter
          </h2>
          <p style={{ fontSize: 13.5, color: '#66766d', lineHeight: 1.55, margin: 0 }}>
            Point the camera at the code on the counter. It activates your shift —
            and jobs start reaching you automatically. Nothing to tap or accept.
          </p>
          <button className="rv3-cta" onClick={startScanner} disabled={busy}>
            <Camera size={18} style={{ verticalAlign: -3, marginRight: 8 }} />
            {busy ? 'Clocking in…' : 'Scan store QR'}
          </button>
          <button className="rv3-scan-alt" onClick={() => setManualOpen(v => !v)}>
            <Keyboard size={15} /> No camera? Enter the store code
          </button>
          {manualOpen && (
            <div className="rv3-scan-manual">
              <input
                className="rv3-input"
                placeholder="DS-VERIFY-1"
                value={manualCode}
                onChange={e => setManualCode(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter' && manualCode.trim()) clockIn(manualCode.trim()); }}
              />
              <button className="rv3-cta" style={{ marginTop: 10 }}
                      onClick={() => manualCode.trim() && clockIn(manualCode.trim())}
                      disabled={busy || !manualCode.trim()}>
                Clock in
              </button>
            </div>
          )}
          {note && <div role="status" className="rv3-banner rv3-banner--ok" style={{ position: 'static', marginTop: 10 }}>{note}</div>}
          {error && <div role="alert" className="rv3-banner rv3-banner--error" style={{ position: 'static', marginTop: 10 }}>{error}</div>}
        </div>
      ) : (
        <div className="rv3-card" style={{ padding: 10 }}>
          <div className="rv3-scan-frame">
            <video ref={videoRef} muted playsInline autoPlay className="rv3-scan-video" />
            <div className="rv3-scan-reticle" />
          </div>
          <p style={{ textAlign: 'center', fontSize: 12.5, color: '#66766d', margin: '10px 0 8px' }}>
            Hold steady on the counter QR
          </p>
          <button className="rv3-scan-alt" onClick={stopCamera}>Cancel</button>
          {error && <div role="alert" className="rv3-banner rv3-banner--error" style={{ position: 'static', marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
