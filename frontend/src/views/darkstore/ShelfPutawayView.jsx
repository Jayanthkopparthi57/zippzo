import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Check, X, AlertTriangle, RefreshCw } from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { useDarkStore, useAsyncData, receivedLpns, lpnManifest, loadSkuIndex, resolveStoreBin, shelfPutaway } from './useDarkStore';

function norm(v) {
  return String(v || '').trim().toUpperCase();
}

function Putaway({ siteId, storeCode, operatorId }) {
  const toast = useToast();
  const { data: totes, error: totesError, reload: reloadTotes, loading } = useAsyncData(
    () => receivedLpns(siteId),
    [siteId],
    { pollMs: 30000 }
  );

  const [selectedTote, setSelectedTote] = useState(null);
  const [manifestLines, setManifestLines] = useState([]);
  const [skuIndex, setSkuIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [targetBins, setTargetBins] = useState({}); // line_id -> bin_code
  const [filterQuery, setFilterQuery] = useState('');

  const toteRows = useMemo(() => totes || [], [totes]);

  useEffect(() => {
    let live = true;
    loadSkuIndex()
      .then((idx) => { if (live) setSkuIndex(idx); })
      .catch(() => { if (live) setSkuIndex(null); });
    return () => { live = false; };
  }, []);

  const openTote = async (row) => {
    setBusy(true);
    setFeedback(null);
    setSelectedTote(row);
    try {
      const manifest = await lpnManifest(row.lpn_id || row.id);
      setManifestLines((manifest || []).map((line, idx) => ({
        ...line,
        line_id: line.line_id || `${line.sku_id || line.sku}-${line.lot_id || line.lot}-${idx}`,
        sku_name: skuIndex?.byId?.get(String(line.sku_id || line.sku))?.name || line.sku_name || line.sku_code || 'Product',
        sku_code: skuIndex?.byId?.get(String(line.sku_id || line.sku))?.sku_code || line.sku_code || line.sku || '—',
        lot_number: line.lot_number || line.lot || '—',
      })));
      setTargetBins({});
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed loading tote manifest.' });
    } finally {
      setBusy(false);
    }
  };

  const resolveBin = async (line) => {
    const text = targetBins[line.line_id] || '';
    if (!text.trim()) {
      setFeedback({ type: 'error', message: 'Scan or type the shelf bin barcode first.' });
      return;
    }
    setBusy(true);
    try {
      const matches = await resolveStoreBin(storeCode, text.trim());
      if (matches.length !== 1) {
        setFeedback({
          type: 'error',
          message: matches.length
            ? `"${text}" matched ${matches.length} bins. Scan a unique label.`
            : `No bin at ${storeCode} matches "${text}".`,
        });
        return;
      }
      setTargetBins(prev => ({ ...prev, [line.line_id]: matches[0].location_id }));
      setFeedback({
        type: 'success',
        message: `${line.sku_code} will be shelved in ${matches[0].label || matches[0].location_id}.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Bin lookup failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleShelfPutaway = async (line) => {
    if (!selectedTote) return;
    const binLocationId = targetBins[line.line_id];
    if (!binLocationId) {
      setFeedback({ type: 'error', message: 'Resolve a shelf bin before putting this line away.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await shelfPutaway(selectedTote.lpn_id || selectedTote.id, [{
        sku: line.sku_id || line.sku,
        lot: line.lot_id || line.lot,
        bin: binLocationId,
        qty: line.qty || line.expected_qty || 1,
      }]);
      toast.show(`Stock placed in bin ${binLocationId}`, 'success');
      setFeedback({
        type: 'success',
        message: `Putaway confirmed: ${line.sku_name || line.sku} placed into ${binLocationId}.`,
      });
      const remaining = manifestLines.filter(l => l.line_id !== line.line_id);
      setManifestLines(remaining);
      if (remaining.length === 0) {
        setSelectedTote(null);
        reloadTotes();
      }
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Putaway failed. Check bin code.' });
    } finally {
      setBusy(false);
    }
  };

  const handlePutawayAll = async () => {
    if (!selectedTote || manifestLines.length === 0) return;
    if (manifestLines.some(line => !targetBins[line.line_id])) {
      setFeedback({ type: 'error', message: 'Resolve a shelf bin for every line before putting away all.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      await shelfPutaway(selectedTote.lpn_id || selectedTote.id, manifestLines.map(line => ({
        sku: line.sku_id || line.sku,
        lot: line.lot_id || line.lot,
        bin: targetBins[line.line_id],
        qty: line.qty || line.expected_qty || 1,
      })));
      toast.show(`All lines put away for tote ${selectedTote.barcode}`, 'success');
      setSelectedTote(null);
      setManifestLines([]);
      reloadTotes();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Complete putaway failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>SHELF PUTAWAY (STORE RESTOCK)</span>
            <span className="screen-count-tag">{toteRows.length} totes</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Break down received mother hub totes onto dark store shelf bins directly from queue.
          </div>
        </div>

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => reloadTotes()} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          style={{
            padding: '10px 14px',
            marginBottom: 16,
            borderRadius: 'var(--radius-sm)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: feedback.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
            color: feedback.type === 'error' ? 'var(--danger)' : 'var(--success)',
            border: `1px solid ${feedback.type === 'error' ? 'var(--danger-border)' : 'var(--success-border)'}`,
          }}
        >
          {feedback.type === 'error' ? <AlertTriangle size={15} /> : <Check size={15} />}
          <span style={{ flex: 1 }}>{feedback.message}</span>
          <button
            type="button"
            className="btn-ui neutral"
            style={{ padding: '2px 6px', fontSize: 11 }}
            onClick={() => setFeedback(null)}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {selectedTote ? (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
            <div>
              <strong style={{ fontSize: 15, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                TOTE: {selectedTote.barcode || selectedTote.lpn_id}
              </strong>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Status: {selectedTote.status} | Total Items: {manifestLines.length}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn-ui primary"
                disabled={busy || manifestLines.length === 0}
                onClick={handlePutawayAll}
              >
                <Check size={13} />
                <span>Putaway All Lines</span>
              </button>
              <button
                type="button"
                className="btn-ui neutral"
                onClick={() => {
                  setSelectedTote(null);
                  setManifestLines([]);
                }}
              >
                Back to Tote Queue
              </button>
            </div>
          </div>

          {/* Lines Table */}
          <table className="wms-table">
            <thead>
              <tr>
                <th>ITEM / SKU</th>
                <th>BATCH / LOT</th>
                <th>EXPIRY</th>
                <th>UNITS</th>
                <th>ASSIGNED SHELF BIN</th>
                <th style={{ textAlign: 'right' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {manifestLines.length > 0 ? (
                manifestLines.map(line => {
                  const assignedBin = targetBins[line.line_id] || '';
                  return (
                    <tr key={line.line_id}>
                      <td>
                        <strong>{line.sku_name || line.sku_code || 'Product'}</strong>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {line.sku_code || line.sku}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{line.lot_number || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{line.expiry_date || '—'}</td>
                      <td>
                        <strong style={{ fontFamily: 'var(--font-mono)' }}>{line.qty || line.expected_qty}</strong>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="text"
                            value={assignedBin}
                            onChange={e => setTargetBins({ ...targetBins, [line.line_id]: e.target.value })}
                            placeholder="Scan shelf bin"
                            style={{
                              padding: '4px 8px',
                              fontSize: 12,
                              fontFamily: 'var(--font-mono)',
                              background: 'var(--bg-input)',
                              border: '1px solid var(--border-color)',
                              borderRadius: 'var(--radius-xs)',
                              width: 140,
                            }}
                          />
                          <button
                            type="button"
                            className="btn-ui neutral"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                            disabled={busy}
                            onClick={() => resolveBin(line)}
                          >
                            Resolve
                          </button>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn-ui neutral"
                          style={{ padding: '3px 10px', fontSize: 11 }}
                          disabled={busy}
                          onClick={() => handleShelfPutaway(line)}
                        >
                          <Check size={11} style={{ color: 'var(--success)' }} />
                          <span>Place on Shelf</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                    All items in this tote have been shelved!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Tote List Table */
        <div className="wms-table-wrap">
          <table className="wms-table">
            <thead>
              <tr>
                <th>TOTE BARCODE / LPN</th>
                <th>RECEIVED AT</th>
                <th>SEAL NUMBER</th>
                <th>CONTAINER STATUS</th>
                <th style={{ textAlign: 'right' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {toteRows.length > 0 ? (
                toteRows.map(t => (
                  <tr key={t.lpn_id || t.id}>
                    <td>
                      <div>
                        <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                          {t.barcode || t.lpn_id || t.id}
                        </strong>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          LPN ID: {String(t.lpn_id || t.id).slice(0, 12)}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        {t.received_at ? new Date(t.received_at).toLocaleString() : 'Just now'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{t.seal_code || t.seal || '—'}</span>
                    </td>
                    <td>
                      <StatusBadge status={t.status || 'RECEIVED'} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn-ui primary"
                        style={{ padding: '3px 10px', fontSize: 11 }}
                        onClick={() => openTote(t)}
                      >
                        <Boxes size={12} />
                        <span>Breakdown & Putaway</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
                    No received totes waiting for putaway.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ShelfPutawayView() {
  const { siteId, storeCode, operatorId } = useDarkStore();
  return (
    <StoreGate>
      <Putaway siteId={siteId} storeCode={storeCode} operatorId={operatorId} />
    </StoreGate>
  );
}
