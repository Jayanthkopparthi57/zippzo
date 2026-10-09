import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchApi, postApi, unwrapList, describeError
} from '../../api/client';
import {
  myOrders, deliveryCode, asList, num, myAddresses
} from '../darkstore/useDarkStore';
import {
  Package, MapPin, ChevronRight, KeyRound,
  AlertCircle, RotateCcw, Truck
} from 'lucide-react';

const LINES = '/orders/order-lines/';
const HISTORY = '/orders/order-history/';
const SKUS = '/catalog/skus/';
const RETURNS = '/reverse/returns/';

const AWAITING_CODE = new Set(['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED']);
const CANCELLED = new Set(['CANCELLED', 'REFUNDED', 'EXPIRED', 'FAILED']);

const STAGE_WORDS = {
  PLACED: 'Order placed',
  PAYMENT_PENDING: 'Awaiting confirmation',
  PAYMENT_FAILED: 'Payment failed',
  CONFIRMED: 'Confirmed',
  PICKING: 'Being picked',
  INTERRUPTED: 'Picking interrupted',
  PICKED: 'Picked',
  PARTIALLY_FULFILLED: 'Partly fulfilled',
  PACKED: 'Packed',
  PRICE_FINALIZED: 'Finalised',
  STAGED: 'Ready at the store',
  RIDER_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'On the way',
  OUT_FOR_DELIVERY: 'Out for delivery',
  ARRIVED: 'Rider at your door',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  CANCELLED_PENDING_RETURN: 'Return in progress',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
  CLOSED_RTO: 'Returned to store',
  REFUNDED: 'Refunded',
};

// Everything a shopper is allowed to move to by themselves. Cancel is not in
// here: cancelling is a stock and refund decision and lives on the server.
const chip = (status) => ({
  background: CANCELLED.has(status) ? '#fee2e2'
    : status === 'DELIVERED' ? '#d1fae5'
    : AWAITING_CODE.has(status) || status === 'RIDER_ASSIGNED' ? '#ede9fe'
    : '#f1f5f9',
  color: CANCELLED.has(status) ? '#991b1b'
    : status === 'DELIVERED' ? '#065f46'
    : AWAITING_CODE.has(status) || status === 'RIDER_ASSIGNED' ? '#5b21b6'
    : '#475569',
  padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700,
  whiteSpace: 'nowrap',
});

const card = {
  background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0',
  overflow: 'hidden',
};

export default function MyOrdersView() {
  const [orders, setOrders] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [skus, setSkus] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState({ lines: [], history: [] });
  const [code, setCode] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);

  // Return flow
  const [returnFor, setReturnFor] = useState(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState(null);
  const [returns, setReturns] = useState([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, a, s, r] = await Promise.all([
        myOrders(),
        myAddresses().catch(() => []),
        fetchApi(SKUS).catch(() => []),
        fetchApi(RETURNS).catch(() => []),
      ]);
      setOrders(asList(o, 'orders'));
      setAddresses(asList(a, 'addresses') || []);
      const map = {};
      for (const sku of (unwrapList(s) || [])) map[sku.sku_id] = sku;
      setSkus(map);
      setReturns(asList(r, 'returns') || []);
    } catch (err) {
      console.error(err);
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (orderId) => {
    setOpenId(orderId);
    setDetail({ lines: [], history: [] });
    setCode(null);
    setDetailBusy(true);
    try {
      const [l, h] = await Promise.all([
        fetchApi(`${LINES}?order=${orderId}`),
        fetchApi(`${HISTORY}?order=${orderId}`).catch(() => []),
      ]);
      setDetail({
        lines: unwrapList(l) || [],
        history: unwrapList(h) || [],
      });
      if (AWAITING_CODE.has(orders.find(o => o.order_id === orderId)?.status)) {
        const c = await deliveryCode(orderId).catch(() => null);
        setCode(c);
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setDetailBusy(false);
    }
  }, [orders]);

  // While a code is live, keep asking for it - it appears only once the rider
  // has requested it at the door.
  useEffect(() => {
    const order = orders.find(o => o.order_id === openId);
    if (!order || !AWAITING_CODE.has(order.status)) return undefined;
    const id = setInterval(async () => {
      const c = await deliveryCode(openId).catch(() => null);
      if (c) setCode(c);
    }, 8000);
    return () => clearInterval(id);
  }, [openId, orders]);

  const submitReturn = async () => {
    setReturnBusy(true);
    setReturnError(null);
    try {
      await postApi(RETURNS, { order: returnFor, reason: returnReason.trim() });
      setReturnFor(null);
      setReturnReason('');
      await load();
    } catch (err) {
      setReturnError(describeError(err));
    } finally {
      setReturnBusy(false);
    }
  };

  const live = orders.filter(o => !CANCELLED.has(o.status));
  const past = orders.filter(o => CANCELLED.has(o.status) || o.status === 'DELIVERED');
  const rows = filter === 'live' ? orders.filter(o => !CANCELLED.has(o.status) && o.status !== 'DELIVERED')
    : filter === 'past' ? past
    : orders;

  const addressFor = (order) =>
    addresses.find(a => a.address_id === order.address);

  const open = orders.find(o => o.order_id === openId);

  if (loading) {
    return <div style={{ padding: 44, textAlign: 'center', color: '#64748b' }}>Loading your orders…</div>;
  }

  if (error && orders.length === 0) {
    return (
      <div style={{ padding: 44, textAlign: 'center' }}>
        <AlertCircle size={30} color="#dc2626" />
        <p style={{ color: '#991b1b', fontWeight: 600 }}>{error}</p>
        <button onClick={load} style={{ padding: '9px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>Try again</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px 48px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 20, color: '#0f172a', display: 'flex', gap: 9, alignItems: 'center' }}>
          <Package size={21} color="#7c3aed" /> My orders
        </h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {[['all', `All (${orders.length})`], ['live', `Live (${orders.filter(o => !CANCELLED.has(o.status) && o.status !== 'DELIVERED').length})`], ['past', `Past (${past.length})`]].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{
              border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13,
              fontWeight: 700, cursor: 'pointer',
              background: filter === id ? '#7c3aed' : '#f1f5f9',
              color: filter === id ? '#fff' : '#475569',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {rows.length === 0 && (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: '#94a3b8' }}>
          Nothing here yet. Place an order from the storefront.
        </div>
      )}

      {rows.map(o => (
        <div key={o.order_id} style={{ ...card, marginBottom: 12 }}>
          <div
            onClick={() => openId === o.order_id ? setOpenId(null) : openDetail(o.order_id)}
            style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>{o.order_no}</span>
                <span style={chip(o.status)}>{STAGE_WORDS[o.status] || o.status}</span>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 5 }}>
                {o.placed_at ? new Date(o.placed_at).toLocaleString() : ''}
                {o.payment_method === 'COD' && ' · pay on delivery'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontWeight: 800, color: '#1e293b' }}>₹{num(o.grand_total).toFixed(2)}</span>
              <ChevronRight size={17} color={openId === o.order_id ? '#7c3aed' : '#94a3b8'}
                            style={{ transform: openId === o.order_id ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
            </div>
          </div>

          {openId === o.order_id && (
            <div style={{ borderTop: '1px solid #e2e8f0', padding: 16, background: '#f8fafc' }}>
              {detailBusy && <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>}

              {/* Delivery code */}
              {code && (
                <div style={{
                  background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 12,
                  padding: 14, marginBottom: 14, display: 'flex', gap: 12,
                  alignItems: 'center',
                }}>
                  <KeyRound size={26} color="#c2410c" style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#9a3412' }}>
                      {code.state === 'ready' ? 'Your delivery code'
                        : code.state === 'used' ? 'This code has been used'
                        : 'Waiting for the rider to ask for a code'}
                    </div>
                    {code.code && (
                      <div style={{ fontSize: 30, fontWeight: 900, letterSpacing: 7, color: '#7c2d12' }}>
                        {code.code}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: '#9a3412', marginTop: 3 }}>
                      Read this to the rider at your door. The rider never sees it beforehand.
                    </div>
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div style={{ ...card, padding: 14, marginBottom: 14 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, color: '#475569' }}>Tracking</h3>
                {detail.history.length === 0 && (
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>No updates yet.</div>
                )}
                {detail.history.map((h, i) => (
                  <div key={h.history_id || i} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: i < detail.history.length - 1 ? 14 : 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{
                        width: 11, height: 11, borderRadius: 999, flexShrink: 0,
                        background: i === 0 ? '#10b981' : '#cbd5e1',
                      }} />
                      {i < detail.history.length - 1 && (
                        <div style={{ width: 2, flex: 1, background: '#e2e8f0', marginTop: 2 }} />
                      )}
                    </div>
                    <div style={{ paddingBottom: 2 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>
                        {STAGE_WORDS[h.to_status] || h.to_status}
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Items */}
              <div style={{ ...card, padding: 14, marginBottom: 14 }}>
                <h3 style={{ margin: '0 0 10px', fontSize: 13, color: '#475569' }}>
                  Items ({detail.lines.length})
                </h3>
                {detail.lines.map(l => (
                  <div key={l.line_id} style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '7px 0', fontSize: 13,
                    borderBottom: '1px solid #f1f5f9',
                  }}>
                    <span style={{ color: '#1e293b' }}>
                      {l.qty}× {skus[l.sku]?.name || skus[l.sku]?.sku_code || 'Item'}
                    </span>
                    <span style={{ color: '#475569', fontWeight: 600 }}>
                      ₹{num(l.line_total).toFixed(2)}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, fontWeight: 800, color: '#0f172a' }}>
                  <span>Total</span><span>₹{num(o.grand_total).toFixed(2)}</span>
                </div>
              </div>

              {/* Address */}
              <div style={{ ...card, padding: 14, marginBottom: 14, display: 'flex', gap: 10 }}>
                <MapPin size={17} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13, color: '#475569' }}>
                  {addressFor(o)
                    ? [addressFor(o).line1, addressFor(o).line2, addressFor(o).city, addressFor(o).pincode]
                        .filter(Boolean).join(', ')
                    : 'Delivery address not found in your saved list.'}
                </div>
              </div>

              {/* Return */}
              {o.status === 'DELIVERED' && (
                <div>
                  {returns.some(r => r.order === o.order_id) ? (
                    <div style={{
                      background: '#f1f5f9', borderRadius: 10, padding: '11px 14px',
                      fontSize: 13, color: '#475569', display: 'flex',
                      alignItems: 'center', gap: 8,
                    }}>
                      <RotateCcw size={15} /> A return is open for this order.
                    </div>
                  ) : returnFor === o.order_id ? (
                    <div style={{ ...card, padding: 14 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                        What went wrong?
                      </label>
                      <textarea
                        value={returnReason}
                        onChange={e => setReturnReason(e.target.value)}
                        rows={3}
                        placeholder="Damaged, wrong item, past its date…"
                        style={{ width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                      {returnError && (
                        <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 7 }}>{returnError}</div>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={() => { setReturnFor(null); setReturnError(null); }}
                                style={{ flex: 1, padding: 10, background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>
                          Cancel
                        </button>
                        <button onClick={submitReturn} disabled={returnBusy || !returnReason.trim()}
                                style={{ flex: 2, padding: 10, background: returnReason.trim() ? '#dc2626' : '#cbd5e1', border: 'none', borderRadius: 8, fontWeight: 700, color: '#fff', cursor: returnReason.trim() ? 'pointer' : 'default' }}>
                          {returnBusy ? 'Sending…' : 'Request return'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setReturnFor(o.order_id); setReturnError(null); }}
                            style={{ padding: '11px 16px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10, fontWeight: 700, fontSize: 13, color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
                      <RotateCcw size={15} /> Report a problem
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Quiet summary of what is actually moving right now */}
      {filter === 'all' && live.some(o => AWAITING_CODE.has(o.status)) && (
        <div style={{
          marginTop: 6, background: '#f5f3ff', border: '1px solid #ddd6fe',
          borderRadius: 12, padding: '13px 16px', fontSize: 13, color: '#5b21b6',
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <Truck size={18} />
          {live.filter(o => AWAITING_CODE.has(o.status)).length} order(s) on the way —
          the delivery code appears in the order once the rider asks for it.
        </div>
      )}
    </div>
  );
}
