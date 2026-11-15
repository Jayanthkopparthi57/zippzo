import React, { useState, useEffect, useCallback } from 'react';
import { Truck, Plus, X, CheckCircle2 } from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import { fetchApi, postApi } from '../api/client';
import BinTransferForm from '../components/ui/BinTransferForm';

// TransferView – displays bin‑to‑bin transfer orders and allows creation via a modal.
export default function TransferView({ initialTab = 'transfer-orders' }) {
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchApi('/transfer/'); // expects list of transfer objects
      if (Array.isArray(data)) setTransfers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // After a successful create, close modal and refresh list.
  const handleCreate = async (transfer) => {
    try {
      await postApi('/transfer/', transfer);
      setShowModal(false);
      await loadData();
      showToast('✓ Transfer created');
    } catch (e) {
      alert('Transfer creation failed: ' + e.message);
    }
  };

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 24, zIndex: 9999,
          background: 'linear-gradient(135deg, #065f46, #047857)',
          color: '#fff', padding: '12px 20px', borderRadius: 10,
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8
        }}>
          <CheckCircle2 size={16} /> {toast}
        </div>
      )}

      <div className="subtabs-bar">
        <button className="subtab-btn active">Transfers</button>
        <button className="btn-ui primary" onClick={() => setShowModal(true)}><Plus size={14} /> New Transfer</button>
      </div>

      <DataTable
        title="Bin‑to‑Bin Stock Transfers"
        subtitle="Move inventory between storage bins, staging areas, and dispatch lanes"
        columns={[
          { header: 'Transfer ID', key: 'transfer_id', render: r => <span className="code-cell" style={{ fontSize: 11 }}>{r.transfer_id || r.id ? String(r.transfer_id || r.id).slice(0, 8) : 'TRF-INT'}</span> },
          { header: 'Source Bin', key: 'source_bin', render: r => <span className="location-pill" style={{ background: '#fef2f2', color: '#b91c1c', borderColor: '#fecaca' }}>{r.source_bin || r.from_container || 'EXT'}</span> },
          { header: 'Destination Bin', key: 'dest_bin', render: r => <span className="location-pill" style={{ background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' }}>{r.dest_bin || r.to_container || 'BULK-01'}</span> },
          { header: 'SKU Code', key: 'sku', render: r => <strong className="code-cell">{r.sku_code || r.sku}</strong> },
          { header: 'Transfer Qty', key: 'quantity', align: 'right', render: r => <strong className="mono-num" style={{ fontSize: 14 }}>{r.quantity || r.qty}</strong> },
          { header: 'Status', key: 'status', badge: true },
          { header: 'Created At', key: 'created_at', render: r => <span style={{ fontSize: 11, color: '#64748b' }}>{r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '—'}</span> },
        ]}
        data={transfers}
        loading={loading}
      />

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal-window" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3 className="modal-heading"><Truck size={18} /> Create Transfer</h3>
              <button className="icon-btn" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            <div className="modal-content">
              <BinTransferForm onSubmit={handleCreate} onCancel={() => setShowModal(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
