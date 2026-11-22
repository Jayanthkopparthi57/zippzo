import React, { useState, useEffect, useMemo } from 'react';
import { Download, X, Calendar } from 'lucide-react';

const RESOURCES = [
  { value: 'sites', label: 'Sites' },
  { value: 'zones', label: 'Zones' },
  { value: 'locations', label: 'Storage Bins' },
  { value: 'skus', label: 'SKUs' },
  { value: 'sku-categories', label: 'SKU Categories' },
  { value: 'users', label: 'Users (admin only)' },
  { value: 'orders', label: 'Customer Orders' },
  { value: 'stock-movements', label: 'Stock Movements' },
  { value: 'stock-balances', label: 'Stock Balances' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysAgoStr = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const startOfWeekStr = () => {
  const d = new Date(); const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
};
const startOfMonthStr = () => {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
};

export default function ExportModal({ open, onClose, appKey = 'wms' }) {
  const [resource, setResource] = useState('locations');
  const [preset, setPreset] = useState('lifetime');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    if (preset === 'lifetime') { setFrom(''); setTo(''); }
    else if (preset === 'week') { setFrom(startOfWeekStr()); setTo(todayStr()); }
    else if (preset === 'month') { setFrom(startOfMonthStr()); setTo(todayStr()); }
    else if (preset === 'last7') { setFrom(daysAgoStr(6)); setTo(todayStr()); }
    else if (preset === 'last30') { setFrom(daysAgoStr(29)); setTo(todayStr()); }
  }, [preset, open]);

  const canDownload = useMemo(() => {
    if (preset !== 'custom') return true;
    if (!from || !to) return false;
    return from <= to;
  }, [preset, from, to]);

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      const params = new URLSearchParams({ resource });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const token = localStorage.getItem(`zippzo_jwt:${appKey}`);
      const res = await fetch(`/api/export/?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try { const j = await res.json(); msg = j.error || msg; } catch (_) {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${resource}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(e.message || 'Export failed.');
    } finally {
      setDownloading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div className="modal-title">Export to Excel</div>
          <button type="button" className="btn-ui neutral" onClick={onClose} disabled={downloading}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          {error && <div className="form-error-banner">{error}</div>}
          <div className="crud-form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="crud-form-field">
              <label>Dataset</label>
              <select value={resource} onChange={(e) => setResource(e.target.value)}>
                {RESOURCES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="crud-form-field">
              <label>Period</label>
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                <option value="lifetime">Lifetime (all)</option>
                <option value="week">This week</option>
                <option value="month">This month</option>
                <option value="last7">Last 7 days</option>
                <option value="last30">Last 30 days</option>
                <option value="custom">Custom range</option>
              </select>
            </div>
            {preset === 'custom' && (
              <>
                <div className="crud-form-field">
                  <label>From</label>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="crud-form-field">
                  <label>To</label>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
            <Calendar size={11} style={{ verticalAlign: 'middle' }} /> Exports up to 50,000 rows as <strong>.xlsx</strong>.
            Date filters apply where the dataset has a date column.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ui neutral" onClick={onClose} disabled={downloading}>Cancel</button>
          <button type="button" className="btn-ui primary" onClick={handleDownload} disabled={downloading || !canDownload}>
            <Download size={13} />
            <span>{downloading ? 'Preparing…' : 'Download'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
