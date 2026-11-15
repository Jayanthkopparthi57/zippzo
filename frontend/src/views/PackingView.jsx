import React, { useCallback, useEffect, useState } from 'react';
import StatusBadge from '../components/ui/StatusBadge';
import { fetchApi, unwrapList, describeError } from '../api/client';

function readRows(payload, endpoint) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${endpoint} returned an unrecognised payload shape.`);
  return rows;
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export default function PackingView({ initialTable = 'batches' }) {
  const table = initialTable === 'lpns' ? 'lpns' : 'batches';
  const [rows, setRows] = useState([]);
  const [sites, setSites] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      if (table === 'lpns') {
        const [lpnPayload, sitePayload] = await Promise.all([
          fetchApi('/inventory/lpns/?page_size=500'),
          fetchApi('/network/sites/?page_size=200')
            .then((payload) => ({ payload }), (err) => ({ err })),
        ]);
        setRows(readRows(lpnPayload, '/inventory/lpns/'));
        if (sitePayload.err) {
          setError(`Sites: ${describeError(sitePayload.err)}`);
        } else {
          setSites(Object.fromEntries(readRows(sitePayload.payload, '/network/sites/').map((site) => [
            String(site.site_id), site.code || String(site.site_id),
          ])));
        }
      } else {
        const [batchPayload, sitePayload] = await Promise.all([
          fetchApi('/fulfilment/batches/?page_size=200'),
          fetchApi('/network/sites/?page_size=200')
            .then((payload) => ({ payload }), (err) => ({ err })),
        ]);
        setRows(readRows(batchPayload, '/fulfilment/batches/'));
        if (sitePayload.err) {
          setError(`Sites: ${describeError(sitePayload.err)}`);
        } else {
          setSites(Object.fromEntries(readRows(sitePayload.payload, '/network/sites/').map((site) => [
            String(site.site_id), site.code || String(site.site_id),
          ])));
        }
      }
    } catch (err) {
      setError(describeError(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [table]);

  useEffect(() => { load(); }, [load]);

  const isLpnTable = table === 'lpns';
  const columns = isLpnTable
    ? ['LPN ID', 'Barcode', 'Type', 'Current Site', 'Destination', 'Transfer', 'Container', 'Status', 'Created']
    : ['Batch No', 'Site', 'SKUs', 'Units', 'Destination', 'Status'];

  return (
    <div data-testid="packing-root" data-loading={loading ? 'true' : 'false'}>
      {error && <div className="alert alert-danger" role="alert" data-testid="packing-load-error">{error}</div>}
      <div className="table-container">
        <table className="data-table" data-testid={isLpnTable ? 'packed-lpns' : 'packing-batches'}>
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length}>Loading…</td></tr>
            ) : rows.length ? (
              rows.map((row) => {
                if (isLpnTable) {
                  return (
                    <tr key={row.lpn_id}>
                      <td className="mono-num">{row.lpn_id || '—'}</td>
                      <td className="mono-num">{row.barcode || '—'}</td>
                      <td>{row.lpn_type || '—'}</td>
                      <td>{sites[String(row.current_site)] || String(row.current_site ?? '—')}</td>
                      <td>{sites[String(row.dest_site)] || String(row.dest_site ?? '—')}</td>
                      <td className="mono-num">{row.transfer || '—'}</td>
                      <td>{row.current_container ? `${row.current_container} ${row.current_ref_id || ''}`.trim() : '—'}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td>{dateTime(row.created_at)}</td>
                    </tr>
                  );
                }

                return (
                  <tr key={row.batch_no}>
                    <td className="code-cell">{row.batch_no || '—'}</td>
                    <td>{sites[String(row.site)] || String(row.site ?? '—')}</td>
                    <td>{Number(row.ordered_skus) || 0}</td>
                    <td>{Number(row.ordered_qty) || 0}</td>
                    <td>{row.destinations || '—'}</td>
                    <td><StatusBadge status={row.status || 'UPLOADED'} /></td>
                  </tr>
                );
              })
            ) : (
              <tr><td colSpan={columns.length}>No records</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
