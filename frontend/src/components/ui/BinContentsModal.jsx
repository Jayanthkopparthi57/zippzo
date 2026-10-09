import React, { useState, useEffect } from 'react';
import { X, Box, Search, Package, MapPin, AlertCircle, Loader2, RotateCcw, Camera, QrCode } from 'lucide-react';
import BarcodeGenerator from './BarcodeGenerator';
import BarcodeScannerModal from './BarcodeScannerModal';
import { fetchApi, unwrapList, describeError } from '../../api/client';

export default function BinContentsModal({ onClose, initialBinCode = '' }) {
  const [binCode, setBinCode] = useState(initialBinCode || '');
  const [binContents, setBinContents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scannedBinCode, setScannedBinCode] = useState(null);
  const [errorDetail, setErrorDetail] = useState('');

  const loadBinContents = async (code) => {
    if (!code || !code.trim()) return;
    const cleanCode = code.trim().toUpperCase();
    setLoading(true);
    setError('');
    setErrorDetail('');
    try {
      // Fetch stock positions filtered by this bin/location
      const res = await fetchApi(`/inventory/positions?location_id=${encodeURIComponent(cleanCode)}&container=BIN`);
      const data = unwrapList(res);
      
      if (data && data.length > 0) {
        setBinContents(data);
        setScannedBinCode(cleanCode);
      } else {
        setBinContents([]);
        setErrorDetail(`No stock found in bin ${cleanCode}`);
      }
    } catch (err) {
      console.error('Failed to load bin contents:', err);
      setError(describeError(err));
      setBinContents([]);
    } finally {
      setLoading(false);
    }
  };

  // Load initial bin code if provided
  useEffect(() => {
    if (initialBinCode) {
      loadBinContents(initialBinCode);
    }
  }, [initialBinCode]);

  const handleScanComplete = (code) => {
    setBinCode(code);
    loadBinContents(code);
    setShowScanner(false);
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (binCode.trim()) {
      loadBinContents(binCode);
    }
  };

  const clearResults = () => {
    setBinCode('');
    setBinContents([]);
    setScannedBinCode(null);
    setError('');
    setErrorDetail('');
  };

  const formatQty = (qty) => {
    if (qty === null || qty === undefined) return '—';
    return Number(qty).toLocaleString();
  };

  const getTotalQty = () => {
    return binContents.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  };

  const getTotalSkus = () => {
    const skus = new Set(binContents.map(item => item.sku_code || item.sku).filter(Boolean));
    return skus.size;
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: '720px', maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title" style={{ color: 'var(--accent-cyan)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#fef3c7', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Box size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a' }}>Bin Contents Lookup</h3>
                <div style={{ fontSize: 12, color: '#64748b' }}>Scan or enter bin code to view all products stored in that bin</div>
              </div>
            </div>
            <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>

          <div style={{ padding: 20 }}>
            {/* Search/Scan Section */}
            <div style={{ marginBottom: 20 }}>
              <form onSubmit={handleManualSubmit} style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Bin Code / Location ID
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Enter or scan bin code (e.g. A-01-02-04)"
                      value={binCode}
                      onChange={e => setBinCode(e.target.value.toUpperCase())}
                      placeholder="e.g. A-01-02-04"
                      style={{ flex: 1 }}
                      disabled={loading}
                    />
                    <button 
                      type="button" 
                      className="btn-secondary" 
                      onClick={() => setShowScanner(true)}
                      disabled={loading}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      <Camera size={16} style={{ marginRight: 6 }} /> Scan Bin
                    </button>
                    <button 
                      type="submit" 
                      className="btn-primary" 
                      disabled={!binCode.trim() || loading}
                    >
                      <Search size={16} style={{ marginRight: 6 }} /> Lookup
                    </button>
                    {binContents.length > 0 && (
                      <button 
                        type="button" 
                        className="btn-secondary" 
                        onClick={clearResults}
                        disabled={loading}
                      >
                        <X size={14} style={{ marginRight: 4 }} /> Clear
                      </button>
                    )}
                  </div>
                </div>
              </form>

              {/* Quick scan button when no input */}
              {!binCode.trim() && !loading && (
                <div style={{ textAlign: 'center', padding: '24px 16px', background: '#fef3c7', borderRadius: 8, border: '1px dashed #f59e0b' }}>
                  <Camera size={32} style={{ color: '#d97706', marginBottom: 8 }} />
                  <p style={{ fontSize: 13, color: '#92400e', marginBottom: 12 }}>
                    Scan a bin barcode to instantly view all products stored in that location
                  </p>
                  <button 
                    className="btn-primary" 
                    onClick={() => setShowScanner(true)}
                    style={{ padding: '10px 20px', fontSize: 13 }}
                  >
                    <Camera size={14} style={{ marginRight: 6 }} /> Open Barcode Scanner
                  </button>
                </div>
              )}
            </div>

            {/* Error Display */}
            {error && (
              <div style={{ 
                background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', 
                marginBottom: 16, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1 }}>{error}</div>
                <button className="btn-secondary" onClick={() => setError('')} style={{ fontSize: 11, padding: '4px 8px' }}>
                  Dismiss
                </button>
              </div>
            )}

            {/* Error Detail (no stock found) */}
            {errorDetail && !error && (
              <div style={{ 
                background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 16px', 
                marginBottom: 16, color: '#92400e', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10
              }}>
                <AlertCircle size={16} style={{ color: '#d97706' }} />
                <span>{errorDetail}</span>
              </div>
            )}

            {/* Loading State */}
            {loading && !binContents.length && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b' }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 13, color: '#64748b' }}>Loading bin contents...</div>
              </div>
            )}

            {/* Results Section */}
            {binContents.length > 0 && (
              <div>
                {/* Summary Header */}
                <div style={{ 
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                  marginBottom: 16, padding: '16px', background: 'linear-gradient(135deg, #fef3c7 0%, #fef9c3 100%)', 
                  borderRadius: 12, border: '1px solid #fde68a'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ 
                      width: 48, height: 48, borderRadius: 10, background: '#fef3c7', color: '#d97706', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Box size={24} style={{ color: '#d97706' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#92400e', letterSpacing: '0.05em' }}>
                        Bin Location
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', fontFamily: 'var(--font-mono)' }}>
                        {scannedBinCode || binCode}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 24, textAlign: 'right' }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#92400e' }}>Total SKUs</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#7c2d12' }}>{getTotalSkus()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#92400e' }}>Total Units</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#7c2d12' }}>{formatQty(getTotalQty())}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#92400e' }}>Line Items</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#7c2d12' }}>{binContents.length}</div>
                    </div>
                  </div>
                </div>

                {/* Contents Table */}
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '60px 140px 180px 80px 100px 1fr', 
                    gap: 8, 
                    padding: '12px 16px', 
                    background: '#f8fafc', 
                    borderBottom: '1px solid #e2e8f0',
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#64748b',
                    letterSpacing: '0.05em'
                  }}>
                    <div>Qty</div>
                    <div>SKU Code</div>
                    <div>Product Name</div>
                    <div>Batch</div>
                    <div>Expiry</div>
                    <div>Location</div>
                  </div>
                  <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {binContents.map((item, idx) => (
                      <div 
                        key={`${item.sku_code}-${item.lot}-${idx}`}
                        style={{ 
                          display: 'grid', 
                          gridTemplateColumns: '60px 140px 180px 80px 100px 1fr', 
                          gap: 8, 
                          padding: '10px 16px', 
                          borderBottom: idx < binContents.length - 1 ? '1px solid #f1f5f9' : 'none',
                          alignItems: 'center',
                          fontSize: 12
                        }}
                      >
                        <div style={{ fontWeight: 700, color: '#059669', fontFamily: 'var(--font-mono)' }}>
                          {formatQty(item.qty)}
                        </div>
                        <div style={{ fontWeight: 700, color: '#7c3aed', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {item.sku_code || item.sku || '—'}
                        </div>
                        <div style={{ fontWeight: 500, color: '#1e293b', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.sku_name || item.product_name || '—'}
                        </div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#64748b' }}>
                          {item.batch_number || '—'}
                        </div>
                        <div style={{ fontSize: 11, color: item.expiry_date ? '#dc2626' : '#64748b' }}>
                          {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '—'}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          {item.location?.id || item.location_code || item.container_ref || '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {binCode.trim() && !loading && binContents.length === 0 && !error && !errorDetail && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: '#64748b' }}>
                <Box size={48} style={{ color: '#cbd5e1', marginBottom: 12, marginLeft: 'auto', marginRight: 'auto' }} />
                <p style={{ fontSize: 14, fontWeight: 500, color: '#475569', marginBottom: 8 }}>
                  No stock found in bin <strong style={{ fontFamily: 'var(--font-mono)' }}>{binCode}</strong>
                </p>
                <p style={{ fontSize: 13, color: '#94a3b8' }}>This bin appears to be empty or the code doesn't match any stocked location.</p>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={onClose}>
                <X size={14} style={{ marginRight: 6 }} /> Close
              </button>
              {binContents.length > 0 && (
                <button className="btn-primary" onClick={() => {
                  // Print/bin label functionality
                  window.print();
                }}>
                  <QrCode size={14} style={{ marginRight: 6 }} /> Print Bin Label
                </button>
              )}
            </div>
          </div>

          {/* Barcode Scanner Modal */}
          {showScanner && (
            <BarcodeScannerModal 
              onClose={() => setShowScanner(false)}
              onScan={handleScanComplete}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function formatQty(qty) {
  if (qty === null || qty === undefined) return '—';
  return Number(qty).toLocaleString();
}