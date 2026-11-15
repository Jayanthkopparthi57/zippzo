import React, { useState } from 'react';
import { fetchApi } from '../../api/client';
import { CheckCircle2, X } from 'lucide-react';

// Simple form for creating a bin‑to‑bin transfer.
export default function BinTransferForm({ onSubmit, onCancel }) {
  const [form, setForm] = useState({
    source_bin: '',
    dest_bin: '',
    sku: '',
    quantity: ''
  });
  const [skus, setSkus] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load SKU list for dropdown (optional but nice UX)
  React.useEffect(() => {
    const loadSkus = async () => {
      try {
        const data = await fetchApi('/skus/');
        if (Array.isArray(data)) setSkus(data);
      } catch (e) {
        console.error('Failed to fetch SKUs', e);
      }
    };
    loadSkus();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Basic validation
    if (!form.source_bin || !form.dest_bin || !form.sku || !form.quantity) {
      alert('All fields are required');
      return;
    }
    setLoading(true);
    try {
      await onSubmit({
        source_bin: form.source_bin,
        dest_bin: form.dest_bin,
        sku: form.sku,
        quantity: Number(form.quantity)
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        <label className="form-group">
          <span className="form-label">Source Bin</span>
          <input className="form-input" name="source_bin" value={form.source_bin} onChange={handleChange} required />
        </label>
        <label className="form-group">
          <span className="form-label">Destination Bin</span>
          <input className="form-input" name="dest_bin" value={form.dest_bin} onChange={handleChange} required />
        </label>
        <label className="form-group">
          <span className="form-label">SKU</span>
          <select className="form-input" name="sku" value={form.sku} onChange={handleChange} required>
            <option value="">Select SKU</option>
            {skus.map((s) => (
              <option key={s.sku_id} value={s.sku_id}>
                {s.sku_id} – {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Quantity</span>
          <input type="number" min="1" className="form-input" name="quantity" value={form.quantity} onChange={handleChange} required />
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" className="btn-ui neutral" onClick={onCancel} disabled={loading}>
          <X size={14} /> Cancel
        </button>
        <button type="submit" className="btn-ui primary" disabled={loading}>
          {loading ? 'Saving…' : (<><CheckCircle2 size={14} /> Create</>)}
        </button>
      </div>
    </form>
  );
}
