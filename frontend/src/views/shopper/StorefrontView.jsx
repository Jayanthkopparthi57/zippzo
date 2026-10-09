import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingBasket, Plus, Minus, MapPin, PackageCheck, Trash2,
  AlertTriangle, RefreshCw, Check, Truck, KeyRound, Star,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { describeError } from '../../api/client';
import {
  storefront, placeOrder, myOrders, myAddresses, saveAddress,
  setDefaultAddress, removeAddress, deliveryCode, num,
} from '../darkstore/useDarkStore';

const rupees = (v) => `₹${num(v).toFixed(2)}`;

/**
 * The stages at which the rider is on their way and the shopper may soon be
 * asked for a pickup code. Before these the code does not exist yet; after
 * DELIVERED it has been spent.
 */
const AWAITING_CODE = new Set(['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED']);

const STAGE_WORDS = {
  PLACED: 'Placed',
  PAYMENT_PENDING: 'Awaiting payment',
  CONFIRMED: 'Confirmed by the store',
  PICKING: 'Being picked',
  INTERRUPTED: 'Pick interrupted',
  PICKED: 'Picked',
  PACKED: 'Packed',
  PICKED_UP: 'On the way',
  OUT_FOR_DELIVERY: 'Out for delivery',
  ARRIVED: 'Arrived',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_FULFILLED: 'Partly fulfilled',
};

function StorefrontScreen({ siteCode }) {
  const toast = useToast();
  const { user } = useAuth();

  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [basket, setBasket] = useState({});
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [orders, setOrders] = useState([]);

  // Address book: what is saved, whether it could be read, and the draft of
  // the one being added.
  const [addrPanel, setAddrPanel] = useState(false);
  const [addrLoadError, setAddrLoadError] = useState(null);
  const [addrError, setAddrError] = useState(null);
  const [addrBusy, setAddrBusy] = useState(false);
  const [draft, setDraft] = useState({ label: '', line1: '', city: '', pincode: '' });

  // Pickup codes, keyed by order id. A missing entry means "not read yet",
  // which is kept apart from an explicit `null` meaning "the read failed".
  const [codes, setCodes] = useState({});

  const loadShop = useCallback(async () => {
    // The store directory arrives asynchronously. Falling back to a made-up
    // site code here made the page request /orders/storefront?site=DS-01,
    // which 404s on any database that has no such store, and the shopper saw
    // a fabricated empty shelf instead of the directory still loading.
    if (!siteCode) {
      setLoading(true);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const data = await storefront(siteCode);
      setShop(data);
    } catch (err) {
      // No demo shelf. A storefront that invents stock would have the
      // shopper place an order for items nobody is going to pick, and the
      // receipt screen would confirm an order that does not exist.
      setShop(null);
      setLoadError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [siteCode]);

  // Re-trigger when the facility list arrives after the initial render.
  // Without this, a shopper who opens the storefront before the site directory
  // has loaded sees a perpetual spinner because loadShop bails on siteCode=''
  // and never retries once the code is known.
  useEffect(() => { loadShop(); }, [loadShop]);

  const loadCodes = useCallback(async (rows) => {
    const live = rows.filter((o) => AWAITING_CODE.has(o.status));
    if (live.length === 0) {
      setCodes({});
      return;
    }
    const found = await Promise.all(live.map(async (o) => {
      try {
        return [o.order_id, await deliveryCode(o.order_id)];
      } catch {
        // Left out rather than rendered blank: "we could not read it" and
        // "there is not one yet" must not look the same at the door.
        return [o.order_id, null];
      }
    }));
    setCodes(Object.fromEntries(found));
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const rows = await myOrders();
      const list = Array.isArray(rows) ? rows : rows?.results || [];
      setOrders(list);
      loadCodes(list);
    } catch {
      // Order list is a convenience; failing must not block ordering
    }
  }, [loadCodes]);

  const loadAddresses = useCallback(async () => {
    try {
      const rows = await myAddresses();
      const list = Array.isArray(rows) ? rows : rows?.results || [];
      setAddresses(list);
      setAddrLoadError(null);
      setAddressId((current) => {
        if (list.some((a) => a.address_id === current)) return current;
        const preferred = list.find((a) => a.is_default) || list[0];
        return preferred ? preferred.address_id : '';
      });
    } catch (err) {
      // Not papered over with a placeholder. A shopper whose addresses could
      // not be read cannot place an order anyway, and a made-up address would
      // only fail later, at checkout, with a worse message.
      setAddresses([]);
      setAddressId('');
      setAddrLoadError(describeError(err));
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { loadAddresses(); }, [loadAddresses]);

  // The rider mints the code at the door, minutes after pickup, so the
  // shopper has to watch it appear without touching anything.
  useEffect(() => {
    if (!orders.some((o) => AWAITING_CODE.has(o.status))) return undefined;
    const timer = setInterval(() => loadCodes(orders), 8000);
    return () => clearInterval(timer);
  }, [orders, loadCodes]);

  const items = shop?.items || [];
  const byId = useMemo(
    () => Object.fromEntries(items.map((i) => [i.sku_id, i])),
    [items]
  );

  const lines = useMemo(
    () => Object.entries(basket)
      .filter(([, qty]) => qty > 0)
      .map(([skuId, qty]) => ({ ...byId[skuId], qty })),
    [basket, byId]
  );

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + num(l.price) * l.qty, 0),
    [lines]
  );
  const fee = num(shop?.delivery_fee);
  const total = subtotal + fee;

  const setQty = (skuId, next) => {
    setRefusal(null);
    setBasket((prev) => {
      const copy = { ...prev };
      if (next <= 0) delete copy[skuId];
      else copy[skuId] = Math.min(next, 12);
      return copy;
    });
  };

  const saveDraft = async () => {
    if (!draft.line1.trim() || !draft.city.trim() || !draft.pincode.trim()) {
      setAddrError('Street, city and PIN code are what the rider navigates by.');
      return;
    }
    setAddrBusy(true);
    setAddrError(null);
    try {
      // The first address becomes the default on its own, so someone who has
      // saved nothing yet does not have to think about which one to pick.
      await saveAddress({ ...draft, is_default: addresses.length === 0 });
      setDraft({ label: '', line1: '', city: '', pincode: '' });
      await loadAddresses();
      if (toast?.success) toast.success('Address saved');
    } catch (err) {
      setAddrError(describeError(err));
    } finally {
      setAddrBusy(false);
    }
  };

  const makeDefault = async (id) => {
    setAddrError(null);
    try {
      await setDefaultAddress(id);
      await loadAddresses();
    } catch (err) {
      setAddrError(describeError(err));
    }
  };

  const dropAddress = async (id) => {
    setAddrError(null);
    try {
      await removeAddress(id);
      await loadAddresses();
      if (toast?.success) toast.success('Address removed');
    } catch (err) {
      setAddrError(describeError(err));
    }
  };

  /**
   * The pickup code, or an honest word for why there is not one.
   *
   * The rider is given `otp_required` and nothing else - the code only exists
   * here, on the order the shopper owns, so this cell is the whole reason a
   * cash delivery can close at all.
   */
  const codeCell = (order) => {
    if (!AWAITING_CODE.has(order.status)) {
      return <span style={{ color: 'var(--text-secondary)' }}>—</span>;
    }
    const entry = codes[order.order_id];
    if (entry === undefined) return <span style={{ color: 'var(--text-secondary)' }}>…</span>;
    if (entry === null) {
      return <span style={{ color: 'var(--danger)' }}>Unavailable</span>;
    }
    if (entry.state === 'ready') {
      return (
        <span
          title="Read this code to the rider at the door"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <KeyRound size={14} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 16, letterSpacing: 3 }}>{entry.code}</strong>
        </span>
      );
    }
    if (entry.state === 'used') {
      return <span style={{ color: 'var(--text-secondary)' }}>Used</span>;
    }
    return <span style={{ color: 'var(--text-secondary)' }}>Waiting for the rider…</span>;
  };

  const submit = async () => {
    setPlacing(true);
    setRefusal(null);
    try {
      const res = await placeOrder({
        site: siteCode,
        address_id: addressId || undefined,
        items: lines.map((l) => ({ sku_id: l.sku_id, qty: l.qty })),
        payment_method: 'COD',
      });
      setPlaced(res);
      setBasket({});
      if (toast?.success) {
        toast.success(`Order ${res.order_no} placed`, `Pay ₹${num(res.grand_total).toFixed(2)} on delivery.`);
      }
      loadOrders();
    } catch (err) {
      // The refusal the store actually gave is shown, short lines and all.
      // There is no pretend success behind this: an order the server did not
      // take must never reach the receipt screen.
      const body = err?.body;
      setPlaced(null);
      setRefusal({
        message: body?.error || describeError(err),
        short: body?.short_lines || body?.unavailable || null,
      });
    } finally {
      setPlacing(false);
    }
  };

  /* ── receipt screen after a successful order ── */
  if (placed) {
    return (
      <div className="view-container">
        <header className="view-header">
          <div>
            <h1 className="page-title"><PackageCheck size={22} /> Order placed!</h1>
            <p className="view-subtitle">Pay the rider in cash on delivery.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => setPlaced(null)}>
            Order something else
          </button>
        </header>

        <div className="card" style={{ maxWidth: 540, margin: '0 auto', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingBottom: 16, borderBottom: '1px dashed var(--border)' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>ORDER NUMBER</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{placed.order_no}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>PAYMENT</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>Cash on Delivery</div>
            </div>
          </div>

          <table className="data-table">
            <tbody>
              {(placed.lines || []).map((l) => (
                <tr key={l.line_no || l.name}>
                  <td>{l.name}</td>
                  <td style={{ textAlign: 'right' }}>×{l.qty}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(l.line_total)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} style={{ color: 'var(--text-secondary)' }}>Delivery</td>
                <td style={{ textAlign: 'right' }}>{rupees(placed.delivery_fee)}</td>
              </tr>
              <tr style={{ fontWeight: 700, borderTop: '2px solid var(--border)' }}>
                <td colSpan={2}>To pay on delivery</td>
                <td style={{ textAlign: 'right', color: 'var(--accent)' }}>{rupees(placed.grand_total)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 10, fontSize: 13 }}>
            <Truck size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-secondary)' }}>A picker is now collecting your items. A rider will be assigned shortly.</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 10, fontSize: 13 }}>
            <KeyRound size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-secondary)' }}>
              When the rider is outside, a six digit delivery code appears under
              <strong> Your orders</strong>. Read it to them and they can hand
              the parcel over.
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <header className="view-header">
        <div>
          <h1 className="page-title"><ShoppingBasket size={22} /> {shop?.name || siteCode}</h1>
          <p className="view-subtitle">
            Signed in as {user?.email}. Pay cash when the rider arrives.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadShop} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>

      {loadError && (
        <div className="alert alert-error">
          <AlertTriangle size={16} /> {loadError}
        </div>
      )}

      {refusal && (
        <div className="alert alert-error">
          <AlertTriangle size={16} />
          <div>
            <strong>{refusal.message}</strong>
            {Array.isArray(refusal.short) && refusal.short.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 16 }}>
                {refusal.short.map((s) => (
                  <li key={s.sku_id}>
                    {s.name || s.sku_id}: asked for {s.requested},{' '}
                    {s.available} on the shelf
                    {s.reason ? ` — ${s.reason}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* ── product catalogue ── */}
        <section style={{ flex: 1 }}>
          {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading what is in stock…</p>}
          {!loading && items.length === 0 && !loadError && (
            <div className="card empty-state" data-testid="storefront-empty">
              <ShoppingBasket size={22} />
              <p>This store has nothing on its shelves right now.</p>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {items.map((item) => {
              const qty = basket[item.sku_id] || 0;
              return (
                <div key={item.sku_id} className="card" data-testid="product-card" style={{ padding: 16, border: qty ? '2px solid var(--accent)' : '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: 'var(--text-primary)' }}>{item.name}</div>
                  <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-secondary)' }}>
                    {[item.brand, item.pack_size].filter(Boolean).join(' · ')}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong data-testid="product-price" style={{ color: 'var(--text-primary)' }}>{rupees(item.price)}</strong>
                    {item.on_offer && <span style={{ fontSize: 11, color: 'var(--text-muted)', textDecoration: 'line-through' }}>{rupees(item.mrp)}</span>}
                  </div>
                  <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-secondary)' }}>{item.available} in stock</p>

                  {qty === 0 ? (
                    <button className="btn btn-primary" data-testid="product-add" style={{ width: '100%', fontSize: 13 }} onClick={() => setQty(item.sku_id, 1)}>
                      <Plus size={14} /> Add
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button className="btn btn-secondary btn-icon" onClick={() => setQty(item.sku_id, qty - 1)}>
                        {qty === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                      </button>
                      <span style={{ fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{qty}</span>
                      <button className="btn btn-secondary btn-icon" onClick={() => setQty(item.sku_id, qty + 1)}
                        disabled={qty >= item.available}>
                        <Plus size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── basket sidebar ── */}
        <aside className="card" style={{ width: 300, flexShrink: 0, padding: 20, position: 'sticky', top: 80 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Your basket</h3>

          {lines.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Nothing in it yet.</p>
          ) : (
            <ul data-testid="basket-lines" style={{ margin: '0 0 16px', padding: 0, listStyle: 'none' }}>
              {lines.map((l) => (
                <li key={l.sku_id} data-testid="basket-line" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ flex: 1, paddingRight: 8 }}>
                    {l.name} <span style={{ color: 'var(--text-secondary)' }}>×{l.qty}</span>
                  </span>
                  <span data-testid="basket-line-total" style={{ fontWeight: 600 }}>{rupees(num(l.price) * l.qty)}</span>
                  <button className="btn btn-icon" style={{ marginLeft: 8, padding: 4 }} onClick={() => setQty(l.sku_id, 0)}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div data-testid="basket-totals" style={{ fontSize: 13, marginBottom: 12 }}>
            <div data-testid="basket-subtotal" style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>Subtotal</span><span data-testid="basket-subtotal-value">{rupees(subtotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>Delivery</span><span>{rupees(fee)}</span>
            </div>
            <div data-testid="basket-total" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700, borderTop: '1px solid var(--border)', marginTop: 4 }}>
              <span>Total</span><span data-testid="basket-total-value">{rupees(total)}</span>
            </div>
          </div>

          {/* ── delivery address ── */}
          <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                <MapPin size={14} style={{ color: 'var(--text-secondary)' }} /> Deliver to
              </span>
              <button
                className="btn btn-secondary"
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => { setAddrPanel((v) => !v); setAddrError(null); }}
              >
                {addrPanel ? 'Done' : 'Manage'}
              </button>
            </div>

            {addrLoadError ? (
              <div style={{ marginTop: 8 }}>
                <p style={{ margin: '0 0 6px', color: 'var(--danger)' }}>
                  Your saved addresses could not be loaded.
                </p>
                <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={loadAddresses}>
                  <RefreshCw size={12} /> Try again
                </button>
              </div>
            ) : addresses.length === 0 ? (
              <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)' }}>
                {addrPanel ? 'Nothing saved yet.' : 'No delivery address yet — choose Manage to add one.'}
              </p>
            ) : (
              <select
                value={addressId}
                onChange={(e) => setAddressId(e.target.value)}
                className="form-input"
                style={{ marginTop: 8, width: '100%', fontSize: 12 }}
              >
                {addresses.map((a) => (
                  <option key={a.address_id} value={a.address_id}>
                    {a.label ? `${a.label}: ` : ''}{a.line1}, {a.city} {a.pincode}
                    {a.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            )}

            {addrError && (
              <p style={{ margin: '8px 0 0', color: 'var(--danger)' }}>{addrError}</p>
            )}

            {addrPanel && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                {addresses.length > 0 && (
                  <ul style={{ margin: '0 0 10px', padding: 0, listStyle: 'none' }}>
                    {addresses.map((a) => (
                      <li key={a.address_id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 0' }}>
                        <span style={{ flex: 1, lineHeight: 1.35, minWidth: 0 }}>
                          {a.label ? <strong>{a.label}</strong> : null}
                          <span style={{ display: 'block', color: 'var(--text-secondary)' }}>
                            {a.line1}{a.city ? `, ${a.city}` : ''} {a.pincode}
                          </span>
                        </span>
                        {a.is_default ? (
                          <span title="Your default delivery address" style={{ color: 'var(--accent)', display: 'flex' }}>
                            <Star size={14} fill="currentColor" />
                          </span>
                        ) : (
                          <button
                            className="btn btn-icon"
                            title="Make this the default"
                            onClick={() => makeDefault(a.address_id)}
                            disabled={addrBusy}
                          >
                            <Star size={14} />
                          </button>
                        )}
                        <button
                          className="btn btn-icon"
                          title="Remove this address"
                          onClick={() => dropAddress(a.address_id)}
                          disabled={addrBusy}
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div style={{ display: 'grid', gap: 6 }}>
                  <input
                    className="form-input"
                    placeholder="Label — Home, Work…"
                    maxLength={20}
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  />
                  <input
                    className="form-input"
                    placeholder="Flat, building, street *"
                    maxLength={200}
                    value={draft.line1}
                    onChange={(e) => setDraft({ ...draft, line1: e.target.value })}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="form-input"
                      placeholder="City *"
                      maxLength={40}
                      style={{ flex: 1, minWidth: 0 }}
                      value={draft.city}
                      onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                    />
                    <input
                      className="form-input"
                      placeholder="PIN *"
                      maxLength={6}
                      inputMode="numeric"
                      style={{ width: 96 }}
                      value={draft.pincode}
                      onChange={(e) => setDraft({ ...draft, pincode: e.target.value.replace(/\D/g, '') })}
                    />
                  </div>
                  <button
                    className="btn btn-secondary"
                    onClick={saveDraft}
                    disabled={addrBusy}
                  >
                    {addrBusy ? 'Saving…' : <><Plus size={13} /> Add address</>}
                  </button>
                </div>
              </div>
            )}
          </div>

          <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Prices are confirmed by the store when the order is placed.
          </p>

          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={submit}
            disabled={placing || lines.length === 0 || addresses.length === 0}
          >
            {placing ? 'Placing…' : <><Check size={15} /> Place order · {rupees(total)}</>}
          </button>
        </aside>
      </div>

      {/* ── order history ── */}
      {orders.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}><Truck size={17} style={{ marginRight: 6, verticalAlign: 'middle' }} />Your orders</h3>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Placed</th>
                  <th>Status</th>
                  <th>Delivery code</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.order_id}>
                    <td style={{ fontWeight: 600 }}>{o.order_no}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{new Date(o.placed_at).toLocaleString()}</td>
                    <td><span className="badge">{STAGE_WORDS[o.status] || o.status}</span></td>
                    <td>{codeCell(o)}</td>
                    <td style={{ textAlign: 'right' }}>{rupees(o.grand_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default function ShopperStorefrontView() {
  const { user, facilitiesList } = useAuth();
  const stores = facilitiesList?.dark_stores || [];
  const [picked, setPicked] = useState('');

  const code = picked && stores.some((s) => s.code === picked)
    ? picked
    : stores[0]?.code || '';

  if (!user) {
    return (
      <div className="view-container">
        <div className="alert alert-error"><ShoppingBasket size={16} /> Sign in to order.</div>
      </div>
    );
  }

  return (
    <div className="view-container">
      {stores.length > 1 && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="shop-select" style={{ fontSize: 13, fontWeight: 600 }}>Store</label>
          <select id="shop-select" value={code} onChange={(e) => setPicked(e.target.value)} className="input">
            {stores.map((s) => <option key={s.code} value={s.code}>{s.name || s.code}</option>)}
          </select>
        </div>
      )}
      <StorefrontScreen siteCode={code} />
    </div>
  );
}