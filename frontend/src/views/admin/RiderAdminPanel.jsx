import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import DataTable from '../../components/ui/DataTable';
import { describeError, fetchApi, postApi } from '../../api/client';

const KYC_BADGE = {
  VERIFIED: 'badge-success',
  PENDING: 'badge-warning',
  REJECTED: 'badge-danger',
};

/**
 * The store admin's view of its riders.
 *
 * Dispatch already has a live fleet board; this is the roster behind it: KYC
 * state, whether someone is online or on shift, what they delivered today and
 * what they earned, plus the two decisions an admin owns - verify/reject KYC
 * and suspend an account.
 */
export default function RiderAdminPanel({ sites = [] }) {
  const darkStores = useMemo(
    () => sites.filter((s) => s.site_type === 'DS' || s.site_type === 'DARK_STORE'),
    [sites],
  );
  const [siteCode, setSiteCode] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = siteCode ? `?site=${encodeURIComponent(siteCode)}` : '';
      const payload = await fetchApi(`/delivery/admin/riders${query}`);
      setRows(Array.isArray(payload?.results) ? payload.results : []);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [siteCode]);

  useEffect(() => { load(); }, [load]);

  const setKyc = async (row, kycStatus) => {
    setBusyId(row.rider_id);
    setError('');
    try {
      await postApi('/delivery/admin/riders', {
        rider_id: row.rider_id, kyc_status: kycStatus,
      });
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div data-testid="rv-panel">
      <div className="panel" style={{ padding: 14, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label className="form-label" style={{ fontSize: 11 }}>Store</label>
          <select className="form-input" style={{ minWidth: 240, height: 32 }}
            data-testid="rv-site" value={siteCode}
            onChange={(e) => setSiteCode(e.target.value)}>
            <option value="">All stores</option>
            {darkStores.map((s) => (
              <option key={s.site_id} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
        <button className="btn-secondary" style={{ height: 32, fontSize: 12 }}
          data-testid="rv-refresh" disabled={loading} onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <span className="form-hint" data-testid="rv-count">
          {loading ? 'Loading…' : `${rows.length} rider${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {error && (
        <div className="scan-feedback scan-feedback--error" data-testid="rv-error"
          style={{ marginBottom: 12 }}>{error}</div>
      )}

      <DataTable
        data-testid="rv-table"
        title="Rider roster"
        subtitle="KYC, shift state, today's deliveries and earnings per rider."
        searchPlaceholder="Search name, phone, email, vehicle..."
        columns={[
          {
            header: 'Rider', key: 'name', render: (r) => (
              <div>
                <strong>{r.name}</strong>
                <div style={{ fontSize: 11, color: '#64748b' }}>{r.email || r.phone}</div>
              </div>
            ),
          },
          { header: 'Store', key: 'current_site', render: (r) => <span className="code-cell">{r.current_site || '—'}</span> },
          {
            header: 'Vehicle', key: 'vehicle_type', render: (r) => (
              <span style={{ fontSize: 11 }}>
                {r.vehicle_type}{r.vehicle_number ? ` · ${r.vehicle_number}` : ''}
              </span>
            ),
          },
          {
            header: 'KYC', key: 'kyc_status', render: (r) => (
              <span className={`badge ${KYC_BADGE[r.kyc_status] || 'badge-default'}`}>
                {r.kyc_status}
              </span>
            ),
          },
          {
            header: 'Status', key: 'is_online', render: (r) => (
              <span className={`badge ${r.is_online ? 'badge-success' : 'badge-default'}`}>
                {r.is_online ? 'ONLINE' : 'OFFLINE'}
              </span>
            ),
          },
          {
            header: 'Shift', key: 'on_shift', render: (r) => (
              r.on_shift
                ? <span className="badge badge-info">ON SHIFT</span>
                : <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>
            ),
          },
          { header: 'Delivered today', key: 'delivered_today', render: (r) => <strong>{r.delivered_today}</strong> },
          { header: 'Active jobs', key: 'active_jobs', render: (r) => r.active_jobs },
          {
            header: 'Earned today', key: 'earnings_today', render: (r) => (
              <strong>₹{Number(r.earnings_today || 0).toLocaleString('en-IN')}</strong>
            ),
          },
          {
            header: 'Actions', key: 'actions', render: (r) => (
              <span style={{ display: 'inline-flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                {r.kyc_status !== 'VERIFIED' && (
                  <button className="btn-secondary" style={{ height: 26, padding: '0 8px', fontSize: 11, color: '#15803d' }}
                    data-testid={`rv-verify-${r.rider_id}`} disabled={busyId === r.rider_id}
                    onClick={() => setKyc(r, 'VERIFIED')}>
                    <CheckCircle2 size={12} /> Verify
                  </button>
                )}
                {r.kyc_status !== 'REJECTED' && (
                  <button className="btn-secondary" style={{ height: 26, padding: '0 8px', fontSize: 11, color: '#b91c1c' }}
                    data-testid={`rv-reject-${r.rider_id}`} disabled={busyId === r.rider_id}
                    onClick={() => setKyc(r, 'REJECTED')}>
                    <ShieldAlert size={12} /> Reject
                  </button>
                )}
              </span>
            ),
          },
        ]}
        data={rows}
      />
      <p style={{ margin: '10px 2px 0', color: '#64748b', fontSize: 11 }}>
        <ShieldCheck size={12} style={{ verticalAlign: -2 }} />{' '}
        Rejecting KYC takes the rider offline immediately. Suspending the login itself is on
        Employees &amp; Roles.
      </p>
    </div>
  );
}
