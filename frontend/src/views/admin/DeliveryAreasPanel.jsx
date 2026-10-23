import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  deleteApi, describeError, fetchApi, patchApi, postApi, unwrapList,
} from '../../api/client';

const BANDS = ['CORE', 'STANDARD', 'EXTENDED'];
const BAND_LABEL = { CORE: 'Core', STANDARD: 'Standard', EXTENDED: 'Extended' };

/**
 * Which pincodes each dark store promises to deliver to.
 *
 * This is the store's service contract: checkout refuses an address whose
 * pincode is not on the list of a store that has one, so the panel is the
 * place a pincode is opened or withdrawn. Bulk entry is supported because
 * onboarding a store usually means pasting a list, not typing 40 rows.
 */
export default function DeliveryAreasPanel({ stores = [] }) {
  const darkStores = useMemo(
    () => stores.filter((s) => s.site_type === 'DS' || s.site_type === 'DARK_STORE'),
    [stores],
  );

  const [siteId, setSiteId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState('');
  const [band, setBand] = useState('CORE');

  const [checkPincode, setCheckPincode] = useState('');
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [checkError, setCheckError] = useState('');

  useEffect(() => {
    if (!siteId && darkStores.length) setSiteId(darkStores[0].site_id);
  }, [darkStores, siteId]);

  const load = useCallback(async () => {
    if (!siteId) { setRows([]); return; }
    setLoading(true);
    setError('');
    try {
      const payload = await fetchApi(
        `/routing/delivery-areas/?site=${encodeURIComponent(siteId)}&page_size=500`);
      setRows(unwrapList(payload) || []);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const addAreas = async () => {
    const wanted = draft
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!wanted.length) { setError('Type at least one 6-digit pincode.'); return; }
    const bad = wanted.filter((p) => !/^\d{6}$/.test(p));
    if (bad.length) {
      setError(`Not a 6-digit pincode: ${bad.join(', ')}`);
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const failures = [];
    let added = 0;
    for (const pincode of [...new Set(wanted)]) {
      try {
        await postApi('/routing/delivery-areas/', {
          site: siteId, pincode, band,
        });
        added += 1;
      } catch (err) {
        failures.push(`${pincode}: ${describeError(err)}`);
      }
    }
    setBusy(false);
    if (added) setNotice(`${added} pincode${added === 1 ? '' : 's'} added.`);
    if (failures.length) setError(failures.join(' • '));
    if (added) setDraft('');
    await load();
  };

  const removeArea = async (row) => {
    if (!window.confirm(`Withdraw ${row.pincode} from ${row.site_code}?`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteApi(`/routing/delivery-areas/${row.area_id}/`);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleArea = async (row) => {
    setBusy(true);
    setError('');
    try {
      await patchApi(`/routing/delivery-areas/${row.area_id}/`,
        { is_active: !row.is_active });
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const checkCoverage = async () => {
    const pincode = checkPincode.trim();
    if (!/^\d{6}$/.test(pincode)) {
      setCheckError('A pincode is exactly 6 digits.');
      setCheckResult(null);
      return;
    }
    setCheckBusy(true);
    setCheckError('');
    try {
      setCheckResult(await fetchApi(`/routing/coverage?pincode=${pincode}`));
    } catch (err) {
      setCheckError(describeError(err));
      setCheckResult(null);
    } finally {
      setCheckBusy(false);
    }
  };

  return (
    <div data-testid="da-panel">
      <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <MapPin size={16} color="#7c3aed" />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Delivery areas</h2>
        </div>
        <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: 12 }}>
          The pincodes this store promises to serve. Checkout refuses an address outside a
          store&apos;s published list; a store with no list keeps accepting every pincode.
          Paste several separated by commas, spaces or new lines.
        </p>

        {(error || notice) && (
          <div className={`scan-feedback ${error ? 'scan-feedback--error' : 'scan-feedback--ok'}`}
            data-testid={error ? 'da-error' : 'da-notice'} style={{ marginBottom: 12 }}>
            {error || notice}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>Store</label>
            <select className="form-input" style={{ minWidth: 220, height: 32 }}
              data-testid="da-site" value={siteId}
              onChange={(e) => { setSiteId(e.target.value); setNotice(''); }}>
              {darkStores.map((s) => (
                <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="form-label" style={{ fontSize: 11 }}>Pincode(s)</label>
            <input className="form-input" style={{ height: 32 }} value={draft}
              data-testid="da-pincode" placeholder="560001, 560034"
              onChange={(e) => setDraft(e.target.value)} />
          </div>
          <div>
            <label className="form-label" style={{ fontSize: 11 }}>Band</label>
            <select className="form-input" style={{ height: 32 }} data-testid="da-band"
              value={band} onChange={(e) => setBand(e.target.value)}>
              {BANDS.map((b) => <option key={b} value={b}>{BAND_LABEL[b]}</option>)}
            </select>
          </div>
          <button className="btn-primary" style={{ height: 32, fontSize: 12 }}
            data-testid="da-add" disabled={busy || !siteId} onClick={addAreas}>
            <Plus size={13} /> Add
          </button>
          <button className="btn-secondary" style={{ height: 32, fontSize: 12 }}
            data-testid="da-refresh" disabled={loading} onClick={load}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>Published pincodes</strong>
          <span className="badge badge-default" data-testid="da-count">
            {loading ? 'Loading…' : `${rows.length} area${rows.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {!loading && rows.length === 0 && (
          <div className="wf-empty" data-testid="da-empty" style={{ padding: '18px 0' }}>
            <div className="wf-empty__title">No pincodes published</div>
            <div>This store accepts every pincode until its first area is added.</div>
          </div>
        )}
        {rows.length > 0 && (
          <table className="data-table" data-testid="da-table">
            <thead>
              <tr>
                <th>Pincode</th><th>Band</th><th>Status</th><th>Added</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.area_id} data-testid={`da-row-${row.pincode}`}>
                  <td><span className="code-cell">{row.pincode}</span></td>
                  <td><span className="badge badge-info">{row.band}</span></td>
                  <td>
                    <span className={`badge ${row.is_active ? 'badge-success' : 'badge-default'}`}>
                      {row.is_active ? 'ACTIVE' : 'WITHDRAWN'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11, color: '#64748b' }}>
                    {row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-secondary"
                      style={{ height: 26, padding: '0 8px', fontSize: 11 }}
                      data-testid={`da-toggle-${row.pincode}`}
                      disabled={busy} onClick={() => toggleArea(row)}>
                      {row.is_active ? 'Withdraw' : 'Restore'}
                    </button>
                    <button className="btn-secondary"
                      style={{ height: 26, padding: '0 8px', fontSize: 11, color: '#b91c1c' }}
                      data-testid={`da-del-${row.pincode}`}
                      disabled={busy} onClick={() => removeArea(row)}>
                      <Trash2 size={12} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel" style={{ padding: 16 }}>
        <strong style={{ fontSize: 13 }}>Check coverage</strong>
        <p style={{ margin: '4px 0 10px', color: '#64748b', fontSize: 12 }}>
          What a shopper&apos;s address resolves to. Useful before switching a pincode off.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="form-input" style={{ height: 32, width: 160 }} value={checkPincode}
            data-testid="da-check-pincode" placeholder="560001"
            onChange={(e) => setCheckPincode(e.target.value)} />
          <button className="btn-secondary" style={{ height: 32, fontSize: 12 }}
            data-testid="da-check" disabled={checkBusy} onClick={checkCoverage}>
            <Search size={13} /> Check
          </button>
        </div>
        {checkError && (
          <div className="scan-feedback scan-feedback--error" data-testid="da-check-error"
            style={{ marginTop: 10 }}>{checkError}</div>
        )}
        {checkResult && (
          <div data-testid="da-check-result" style={{ marginTop: 10, fontSize: 12 }}>
            {checkResult.sites.length === 0 ? (
              <span style={{ color: '#b91c1c' }}>
                No store publishes {checkResult.pincode}
                {checkResult.configured ? '.' : ' — no areas are configured anywhere yet.'}
              </span>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {checkResult.sites.map((s) => (
                  <li key={s.site_id} data-testid={`da-check-store-${s.code}`}>
                    <strong>{s.code}</strong> — {s.name} ({s.band}), delivery ₹{s.delivery_fee}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
