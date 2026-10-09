import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Search, CheckCircle2, AlertCircle, Video, RotateCcw, Camera } from 'lucide-react';

const SAMPLE_BARCODES = [
  { code: 'LPNHYD0001001', type: 'Container LPN (Tote)', detail: 'Amul Milk 1L x 50 (Packed)' },
  { code: '8901262010012', type: 'Product EAN Barcode', detail: 'Amul Taaza Toned Milk 1L' },
  { code: 'A-01-01-01', type: 'Storage Bin Coordinate', detail: 'Aisle A, Rack 01, Level 01, Pos 01' },
  { code: 'ASN-AMUL-001', type: 'ASN Arrival Number', detail: 'Consignment INB-2026-001 (GRN Passed)' }
];

function BarcodeScannerModal({ onClose, onScan, title = 'Handheld Laser Barcode Scanner', expected = '' }) {
  const [scanInput, setScanInput] = useState('');
  const [scannedResult, setScannedResult] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraPermission, setCameraPermission] = useState('prompt');
  const [facingMode, setFacingMode] = useState('environment');
  const [error, setError] = useState('');
  const [codeReader, setCodeReader] = useState(null);

  const videoRef = useRef(null);
  const scanTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);
  // @zxing/browser 0.2.x has no reset(); decodeFromVideoDevice returns
  // IScannerControls with stop(). Calling the old codeReader.reset() threw
  // "not a function" on every teardown.
  const controlsRef = useRef(null);

  const stopScanning = useCallback(() => {
    try {
      if (controlsRef.current && typeof controlsRef.current.stop === 'function') {
        controlsRef.current.stop();
      } else if (codeReader && typeof codeReader.releaseAllStreams === 'function') {
        codeReader.releaseAllStreams();
      }
    } catch (err) {
      console.warn('Failed to stop scanner cleanly:', err);
    }
    controlsRef.current = null;
    setIsScanning(false);
    if (scanTimeoutRef.current) { clearTimeout(scanTimeoutRef.current); scanTimeoutRef.current = null; }
  }, [codeReader]);

  useEffect(() => {
    let mounted = true;
    const initCodeReader = async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        if (mounted) setCodeReader(reader);
      } catch (err) {
        console.error('Failed to initialize barcode reader:', err);
        if (mounted) setError('Failed to initialize barcode scanner.');
      }
    };
    initCodeReader();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      try {
        if (controlsRef.current && typeof controlsRef.current.stop === 'function') {
          controlsRef.current.stop();
        } else if (codeReader && typeof codeReader.releaseAllStreams === 'function') {
          codeReader.releaseAllStreams();
        }
      } catch {
        // Camera already released; nothing to clean up.
      }
      controlsRef.current = null;
    };
  }, [codeReader]);

  const requestCameraPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode } } });
      stream.getTracks().forEach(t => t.stop());
      setCameraPermission('granted');
      setError('');
      return true;
    } catch (err) {
      console.error('Camera permission denied:', err);
      setCameraPermission('denied');
      setError('Camera access denied. Please grant camera permission.');
      return false;
    }
  }, [facingMode]);

  const toggleCamera = useCallback(() => {
    const newFacingMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newFacingMode);
    if (isScanning && codeReader) {
      stopScanning();
      setTimeout(startScanning, 500);
    }
  }, [facingMode, isScanning, codeReader]);

  const handleScanResult = useCallback((code) => {
    if (!code?.trim()) return;
    const val = code.trim();
    setScanInput(val);
    setScannedResult({ success: true, code: val, type: 'Scanned Barcode', detail: 'Successfully scanned via camera' });
    if (onScan) onScan(val);
  }, [onScan]);

  const startScanning = useCallback(async () => {
    if (!codeReader || isScanning) return;
    if (cameraPermission !== 'granted') {
      const granted = await requestCameraPermission();
      if (!granted) return;
    }
    if (!videoRef.current) return;
    try {
      setIsScanning(true);
      setError('');
      const controls = await codeReader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result, err) => {
          if (!isMountedRef.current) return;
          if (result) {
            handleScanResult(result.getText());
            stopScanning();
          } else if (err && !(err instanceof Error && err.name === 'NotFoundException')) {
            console.warn('Scan error:', err);
          }
        }
      );
      controlsRef.current = controls || null;
    } catch (err) {
      console.error('Failed to start scanning:', err);
      setError('Failed to start camera.');
      setIsScanning(false);
    }
  }, [codeReader, cameraPermission, requestCameraPermission, handleScanResult, stopScanning]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    handleScanResult(scanInput.trim());
  };

  const clearResult = () => {
    setScannedResult(null);
    setScanInput('');
    setError('');
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card" style={{ maxWidth: '520px', maxHeight: '90vh', overflow: 'auto' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: 'var(--accent-cyan)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{title}</span>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close scanner"><X size={18} /></button>
          </div>

          <div style={{ padding: 16 }}>
            {scannedResult && (
              <div className="alert alert-success" data-testid="scan-result" style={{ marginBottom: 12 }}>
                <CheckCircle2 size={16} />
                <span>Scanned: <strong className="code-cell">{scannedResult.code}</strong></span>
                <button type="button" className="icon-btn" onClick={clearResult} style={{ marginLeft: 'auto' }}
                  aria-label="Clear scan result">
                  <X size={14} />
                </button>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ textAlign: 'center', padding: '24px 16px', background: '#f8fafc', borderRadius: 8, border: '1px dashed #cbd5e1' }}>
                {isScanning ? (
                  <>
                    {/* decodeFromVideoDevice needs a real element to paint into;
                        without this videoRef.current is always null and camera
                        scanning silently never starts. */}
                    <video
                      ref={videoRef}
                      data-testid="scanner-video"
                      style={{
                        width: '100%', maxWidth: 320, borderRadius: 8,
                        background: '#000', display: 'block', margin: '0 auto 12px',
                      }}
                      autoPlay
                      muted
                      playsInline
                    />
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                      Camera active — point at the barcode
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      <button type="button" className="btn-secondary" onClick={toggleCamera} data-testid="flip-camera">
                        <RotateCcw size={16} /> Flip Camera
                      </button>
                      <button type="button" className="btn-secondary" onClick={stopScanning} data-testid="stop-scanning">
                        Stop Camera
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <Camera size={48} style={{ color: '#94a3b8', marginBottom: 12, margin: '0 auto 12px' }} />
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                      Ready to Scan
                    </div>
                    <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
                      {expected
                        ? `Scan or enter a ${expected}`
                        : 'Start the camera, or type the code below (works with a handheld gun too).'}
                    </p>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={startScanning}
                      disabled={isScanning}
                      data-testid="start-camera-scan"
                      style={{ width: '100%', maxWidth: 280, padding: '12px 16px' }}
                    >
                      <Video size={16} /> Start Camera Scan
                    </button>
                  </>
                )}
              </div>
            </div>

            <div>
              <form onSubmit={handleManualSubmit} style={{ marginBottom: 12 }}>
                <div className="form-group">
                  <label>Or Enter Barcode Manually</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-control"
                      data-testid="manual-barcode-input"
                      placeholder="e.g. LPNHYD0001001 or 8901262010012"
                      value={scanInput}
                      onChange={e => setScanInput(e.target.value)}
                    />
                    <button type="submit" className="btn-primary" data-testid="manual-barcode-submit" disabled={!scanInput.trim()}>
                      <Search size={16} /> Lookup
                    </button>
                  </div>
                </div>
              </form>

              {error && (
                <div className="alert alert-danger" style={{ marginBottom: 12 }}>
                  <AlertCircle size={16} /><span>{error}</span>
                </div>
              )}

              <div>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Quick Test Barcodes:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {SAMPLE_BARCODES.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: '11px', fontFamily: 'monospace' }}
                      onClick={() => {
                        setScanInput(item.code);
                        handleScanResult(item.code);
                      }}
                    >
                      {item.code}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BarcodeScannerModal;