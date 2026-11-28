/* The store's rider fleet: who is on shift, where they were last seen, and
 * what they are carrying.
 *
 * The pin is not typed in by anyone - it is pushed by the rider's own device
 * while they are online (RiderDashboardView -> POST /rider-profiles/me/location/),
 * so this board can only ever show where a phone actually reported. A rider
 * who has never shared, or whose browser refused the permission, shows
 * "no location" rather than a stale guess.
 */
import React, { useState } from 'react';
import {
  Activity, BadgeIndianRupee, Bike, MapPin, RefreshCw, AlertTriangle,
  Wifi, WifiOff, Users2, Wallet,
} from 'lucide-react';
import StoreGate, { StoreBadge } from './StoreGate';
import {
  useDarkStore, useAsyncData, asList, num, secondsSince,
} from './useDarkStore';
import { fetchApi, postApi } from '../../api/client';
import { useToast } from '../../components/ui/Toast';
import RiderAdminPanel from './RiderAdminPanel';
import VendorsView from '../VendorsView';
import '../../styles/vendors.css';

const RIDERS = '/delivery/rider-profiles/';
const ACTIVE_TASK_STATES = 'ACCEPTED,AT_DS,PICKED_UP,EN_ROUTE,ARRIVED,POD_PENDING';

function ago(value) {
  const s = secondsSince(value);
  if (s == null) return 'never';
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(value).toLocaleDateString();
}

function LiveBoard() {
  const { siteId, storeCode } = useDarkStore();

  const { data: allRiders, error: riderError, loading, reload } = useAsyncData(
    () => (siteId
      ? fetchApi(`/delivery/admin/riders?site=${encodeURIComponent(storeCode)}`).then((r) => asList(r, '/delivery/admin/riders'))
      : Promise.resolve([])),
    [siteId, storeCode],
    { pollMs: 30000 },
  );
  const toast = useToast();
  const reviewKyc = async (row, kycStatus) => {
    try {
      await postApi('/delivery/admin/riders/', { rider_id: row.rider_id, kyc_status: kycStatus });
      toast.success('KYC updated', `${row.name}: ${kycStatus}`);
      await reload({ quiet: true });
    } catch (error) {
      toast.error('KYC not updated', error.message || 'Validation refused the change.');
    }
  };

  const { data: tasks } = useAsyncData(
    () => (siteId
      ? fetchApi(
        `/delivery/delivery-tasks/?site=${encodeURIComponent(siteId)}` +
          `&status__in=${ACTIVE_TASK_STATES}&page_size=100`,
      ).then((r) => asList(r, '/delivery/delivery-tasks'))
      : Promise.resolve([])),
    [siteId],
    { pollMs: 30000 },
  );

  // The admin board is already scoped to this store by the site query.
  const riders = allRiders || [];

  const jobsByRider = {};
  (tasks || []).forEach((t) => {
    if (!t.rider) return;
    jobsByRider[String(t.rider)] = (jobsByRider[String(t.rider)] || 0) + 1;
  });

  return (
    <StoreGate>
      {siteId && (
        <div className="wf-panel">
          <div className="wf-panel__header">
            <div>
              <div className="wf-peek">
 Rider fleet
              </div>
              <div className="wf-panel__hint">
                Riders based at <StoreBadge />
              </div>
            </div>
            <div className="wf-panel__actions">
              {loading && <span className="scan-feedback scan-feedback--hint">Loading…</span>}
              <button className="btn-secondary" onClick={() => reload()} disabled={loading}
                      data-testid="rf-refresh">
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
          </div>

          {riderError && (
            <div className="scan-feedback scan-feedback--error" data-testid="rf-error">
              <AlertTriangle size={14} /> {String(riderError)}
            </div>
          )}

          {riders.length === 0 ? (
            <div className="wf-empty" data-testid="rf-empty">
              <Bike size={40} className="wf-empty__icon" />
              <div className="wf-empty__title">No riders are based here yet</div>
              <div className="wf-empty__text">
                A rider appears once their profile is pinned to this store.
              </div>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rider</th>
                    <th>Vehicle</th>
                    <th>Open jobs</th>
                    <th>Deliveries today</th>
                    <th>Earnings today</th>
                    <th>Last seen</th>
                    <th>Position</th>
                    <th>State</th>
                    <th>KYC</th>
                  </tr>
                </thead>
                <tbody data-testid="rf-table">
                  {riders.map((r) => {
                    const jobs = jobsByRider[String(r.rider_id)] || 0;
                    const pinned = r.last_lat != null && r.last_lng != null;
                    return (
                      <tr key={r.rider_id} data-testid={`rf-row-${r.rider_id}`}>
                        <td>
                          <div className="entity-card__title">
                            {r.name || 'Unnamed rider'}
                          </div>
                        </td>
                        <td>
                          {r.vehicle_type}{r.vehicle_number ? ` · ${r.vehicle_number}` : ''}
                        </td>
                        <td data-testid={`rf-jobs-${r.rider_id}`}>
                          {jobs === 0 ? r.active_jobs || 'No open job' : `${jobs} open job${jobs === 1 ? '' : 's'}`}
                        </td>
                        <td className="mono-num">{r.delivered_today ?? 0}</td>
                        <td className="mono-num">₹{num(r.earnings_today)}</td>
                        <td data-testid={`rf-lastseen-${r.rider_id}`}>
                          Last seen {ago(r.last_seen_at)}
                        </td>
                        <td data-testid={`rf-pin-${r.rider_id}`}>
                          {pinned ? (
                            <>
                              <MapPin size={11} style={{ verticalAlign: -1 }} />{' '}
                              {num(r.last_lat).toFixed(4)}, {num(r.last_lng).toFixed(4)}
                            </>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>No location yet</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${r.is_online ? 'badge-success' : 'badge-default'}`}
                                data-testid={`rf-online-${r.rider_id}`}>
                            {r.is_online ? <Wifi size={11} /> : <WifiOff size={11} />}
                            {r.is_online ? ' Online' : ' Offline'}
                          </span>
                        </td>
                        <td>
                          <div>{r.kyc_document_type || 'KYC doc'}: {r.kyc_document_url ? <a href={r.kyc_document_url} target="_blank" rel="noreferrer">View</a> : 'not provided'}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.kyc_status}</div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                            <button type="button" className="btn-ui neutral" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => reviewKyc(r, 'VERIFIED')}>Verify</button>
                            <button type="button" className="btn-ui neutral" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => reviewKyc(r, 'REJECTED')}>Reject</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </StoreGate>
  );
}

/**
 * Rider Fleet is the rider hub. Each operation gets its own tab so the live
 * board never competes with forms, and sensitive pay actions stay separate.
 */
export default function RiderFleetView() {
  const [tab, setTab] = useState('live');
  const { site, siteId, storeCode } = useDarkStore();

  return (
    <div className="vend-page">
      <div className="vend-page__head">
        <div>
          <h1>Rider Fleet</h1>
          <p>Live board, rider registration, pay rates and salary payouts.</p>
        </div>
        <div className="vend-page__context">{site?.code && <span>{site.code}</span>}</div>
      </div>

      <div className="vend-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}><Activity size={15} /> Live board</button>
        <button type="button" role="tab" aria-selected={tab === 'riders'} className={tab === 'riders' ? 'active' : ''} onClick={() => setTab('riders')}><Users2 size={15} /> Riders</button>
        <button type="button" role="tab" aria-selected={tab === 'rates'} className={tab === 'rates' ? 'active' : ''} onClick={() => setTab('rates')}><BadgeIndianRupee size={15} /> Rate card</button>
        <button type="button" role="tab" aria-selected={tab === 'pay'} className={tab === 'pay' ? 'active' : ''} onClick={() => setTab('pay')}><Wallet size={15} /> Salary &amp; payouts</button>
      </div>

      {tab === 'live' && <LiveBoard />}
      {tab === 'riders' && <RiderAdminPanel section="roster" siteId={siteId} storeCode={storeCode} />}
      {tab === 'rates' && <RiderAdminPanel section="rates" siteId={siteId} storeCode={storeCode} />}
      {tab === 'pay' && <VendorsView mode="DS" initialTab="salaries" embedded />}
    </div>
  );
}
