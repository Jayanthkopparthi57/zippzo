import React, { useCallback, useEffect, useState } from 'react';
import StatusBadge from '../../components/ui/StatusBadge';
import { useToast } from '../../components/ui/Toast';
import { fetchApi, postApi, patchApi, unwrapList, describeError } from '../../api/client';

const READY_STATUS = ['PACKED', 'LOADED', 'SORTED', 'PACKING'];
const OPEN_BATCH_STATUS = ['UPLOADED', 'ALLOCATING', 'ALLOCATED', 'IN_PROGRESS'];
const ROUTE_IN_TRANSIT = 'IN_PROGRESS';

function asList(payload, endpoint) {
  const rows = unwrapList(payload);
  if (!Array.isArray(rows)) throw new Error(`${endpoint} returned an unrecognised payload shape.`);
  return rows;
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

const TABLES = {
  transfers: {
    title: 'Dispatch Transfers',
    testId: 'dispatch-transfers',
    emptyTestId: 'dispatch-transfers-empty',
  },
  batches: {
    title: 'Shipment Batches',
    testId: 'dispatch-batches',
    emptyTestId: 'dispatch-batches-empty',
  },
  routes: {
    title: 'Route Plans',
    testId: 'dispatch-routes',
    emptyTestId: 'dispatch-routes-empty',
  },
};

export default function DispatchView({ initialTable = 'transfers' }) {
  const table = TABLES[initialTable] ? initialTable : 'transfers';
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [sites, setSites] = useState({});
  const [riders, setRiders] = useState({});
  const [lpns, setLpns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      if (table === 'transfers') {
        const [transferResults, sitePayload, lpnPayload] = await Promise.all([
          Promise.all(READY_STATUS.map((status) =>
            fetchApi(`/ds-ops/transfer-orders/?status=${status}&page_size=100`)
              .then((payload) => ({ status, payload }), (err) => ({ status, err }))
          )),
          fetchApi('/network/sites/?page_size=200')
            .then((payload) => ({ payload }), (err) => ({ err })),
          fetchApi('/inventory/lpns/?page_size=500')
            .then((payload) => ({ payload }), (err) => ({ err })),
        ]);
        const seen = new Set();
        const transfers = [];
        const errors = [];
        transferResults.forEach(({ status, payload, err }) => {
          if (err) {
            errors.push(`${status}: ${describeError(err)}`);
            return;
          }
          try {
            asList(payload, `/ds-ops/transfer-orders/?status=${status}`).forEach((row) => {
              const id = String(row.transfer_id ?? '');
              if (!id || seen.has(id)) return;
              seen.add(id);
              transfers.push(row);
            });
          } catch (listError) {
            errors.push(`${status}: ${describeError(listError)}`);
          }
        });
        setRows(transfers);
        if (sitePayload.err) {
          errors.push(`Sites: ${describeError(sitePayload.err)}`);
        } else {
          setSites(Object.fromEntries(asList(sitePayload.payload, '/network/sites/').map((site) => [
            String(site.site_id), site.code || String(site.site_id),
          ])));
        }
        if (lpnPayload.err) {
          errors.push(`Totes: ${describeError(lpnPayload.err)}`);
        } else {
          setLpns(asList(lpnPayload.payload, '/inventory/lpns/'));
        }
        if (errors.length) setError(errors.join(' · '));
      } else if (table === 'batches') {
        const [batchPayload, sitePayload] = await Promise.all([
          fetchApi('/fulfilment/batches/?page_size=200'),
          fetchApi('/network/sites/?page_size=200')
            .then((payload) => ({ payload }), (err) => ({ err })),
        ]);
        setRows(asList(batchPayload, '/fulfilment/batches/'));
        if (sitePayload.err) {
          setError(`Sites: ${describeError(sitePayload.err)}`);
        } else {
          setSites(Object.fromEntries(asList(sitePayload.payload, '/network/sites/').map((site) => [
            String(site.site_id), site.code || String(site.site_id),
          ])));
        }
      } else {
        const [routePayload, sitePayload, riderPayload] = await Promise.all([
          fetchApi('/delivery/route-plans/?page_size=200'),
          fetchApi('/network/sites/?page_size=200')
            .then((payload) => ({ payload }), (err) => ({ err })),
          fetchApi('/delivery/rider-profiles/?page_size=200')
            .then((payload) => ({ payload }), (err) => ({ err })),
        ]);
        setRows(asList(routePayload, '/delivery/route-plans/'));
        const referenceErrors = [];
        if (sitePayload.err) {
          referenceErrors.push(`Sites: ${describeError(sitePayload.err)}`);
        } else {
          setSites(Object.fromEntries(asList(sitePayload.payload, '/network/sites/').map((site) => [
            String(site.site_id), site.code || String(site.site_id),
          ])));
        }
        if (riderPayload.err) {
          referenceErrors.push(`Riders: ${describeError(riderPayload.err)}`);
        } else {
          setRiders(Object.fromEntries(asList(riderPayload.payload, '/delivery/rider-profiles/').map((rider) => [
            String(rider.rider_id), rider.name || String(rider.rider_id),
          ])));
        }
        if (referenceErrors.length) setError(referenceErrors.join(' · '));
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [table]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (id, action, successMessage) => {
    if (!id) {
      setError('This row is missing its record id.');
      return;
    }
    setBusyId(String(id));
    setError('');
    try {
      await action(String(id));
      toast.success(successMessage);
      await load();
    } catch (err) {
      const message = describeError(err);
      setError(message);
      toast.error('Update failed', message);
    } finally {
      setBusyId('');
    }
  };

  const dispatchTransfer = (row) => runAction(
    row.transfer_id,
    (id) => postApi(`/ds-ops/transfer-orders/${encodeURIComponent(id)}/dispatch/`, {}),
    'Transfer dispatched',
  );
  const dispatchBatch = (row) => runAction(
    row.batch_id,
    (id) => postApi(`/fulfilment/batches/${encodeURIComponent(id)}/dispatch/`, {}),
    'Batch dispatched',
  );
  const markRouteInTransit = (row) => runAction(
    row.route_id,
    (id) => patchApi(`/delivery/route-plans/${encodeURIComponent(id)}/`, { status: ROUTE_IN_TRANSIT }),
    'Route marked in transit',
  );

  const columns = table === 'transfers'
    ? ['Transfer', 'Units', 'Source', 'Destination', 'Totes', 'Created', 'Status', 'Action']
    : table === 'batches'
      ? ['Batch No', 'Batch ID', 'Site', 'Type', 'Ordered', 'Picked', 'Sorted', 'Totes', 'Created', 'Status', 'Action']
      : ['Route', 'Rider', 'Site', 'Stops', 'Distance (m)', 'Est. min', 'Started', 'Status', 'Action'];

  const renderRow = (row) => {
    if (table === 'transfers') {
      const id = String(row.transfer_id ?? '');
      const toteRows = lpns.filter((lpn) => String(lpn.transfer ?? '') === id);
      return (
        <tr key={id} data-testid={`dispatch-transfer-${id}`}>
          <td className="mono-num">{id}</td>
          <td data-testid={`dispatch-transfer-qty-${id}`}>{Number(row.total_qty) || 0}</td>
          <td>{sites[String(row.source_site)] || String(row.source_site ?? '—')}</td>
          <td>{sites[String(row.dest_site)] || String(row.dest_site ?? '—')}</td>
          <td data-testid={`dispatch-transfer-lpns-${id}`}>
            {toteRows.map((lpn) => lpn.barcode || lpn.lpn_id).join(', ') || '—'}
          </td>
          <td>{dateTime(row.created_at)}</td>
          <td><StatusBadge status={row.status} dataTestId={`dispatch-transfer-status-${id}`} /></td>
          <td>
            <button
              className="btn-secondary"
              onClick={() => dispatchTransfer(row)}
              disabled={busyId !== ''}
              data-testid={`dispatch-transfer-go-${id}`}
            >
              Dispatch
            </button>
          </td>
        </tr>
      );
    }

    if (table === 'batches') {
      const id = String(row.batch_id ?? '');
      return (
        <tr key={id} data-testid={`dispatch-batch-${id}`}>
          <td data-testid={`dispatch-batch-no-${id}`}>{row.batch_no || '—'}</td>
          <td className="mono-num">{id}</td>
          <td>{sites[String(row.site)] || String(row.site ?? '—')}</td>
          <td>{row.type || '—'}</td>
          <td>{Number(row.ordered_qty) || 0}</td>
          <td>{Number(row.picked_qty) || 0}</td>
          <td>{Number(row.sorted_qty) || 0}</td>
          <td>{Number(row.totes) || 0}</td>
          <td>{dateTime(row.created_at)}</td>
          <td><StatusBadge status={row.status} dataTestId="dispatch-batch-status" /></td>
          <td>
            <button
              className="btn-secondary"
              onClick={() => dispatchBatch(row)}
              disabled={busyId !== '' || !OPEN_BATCH_STATUS.includes(String(row.status).toUpperCase())}
              data-testid={`dispatch-batch-go-${id}`}
            >
              Dispatch
            </button>
          </td>
        </tr>
      );
    }

    const id = String(row.route_id ?? '');
    return (
      <tr key={id} data-testid={`dispatch-route-${id}`}>
        <td className="mono-num">{id}</td>
        <td data-testid={`dispatch-route-rider-${id}`}>
          {riders[String(row.rider)] || String(row.rider ?? '—')}
        </td>
        <td>{sites[String(row.site)] || String(row.site ?? '—')}</td>
        <td>{Number(row.stop_count) || 0}</td>
        <td>{row.total_distance_m ?? '—'}</td>
        <td>{row.estimated_min ?? '—'}</td>
        <td>{dateTime(row.started_at)}</td>
        <td><StatusBadge status={row.status} dataTestId="dispatch-route-status" /></td>
        <td>
          <button
            className="btn-secondary"
            onClick={() => markRouteInTransit(row)}
            disabled={busyId !== '' || String(row.status).toUpperCase() === ROUTE_IN_TRANSIT || ['COMPLETED', 'ABORTED'].includes(String(row.status).toUpperCase())}
            data-testid={`dispatch-route-go-${id}`}
          >
            Mark in transit
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div data-testid="dispatch-root" data-loading={loading ? 'true' : 'false'}>
      {error && <div className="alert alert-danger" role="alert" data-testid="dispatch-load-error">{error}</div>}
      <div className="table-container">
        <table className="data-table" data-testid={TABLES[table].testId}>
          <thead>
            <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length}>Loading…</td></tr>
            ) : rows.length ? (
              rows.map(renderRow)
            ) : (
              <tr data-testid={TABLES[table].emptyTestId}>
                <td colSpan={columns.length}>No records</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
