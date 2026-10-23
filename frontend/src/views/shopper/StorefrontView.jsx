import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, Plus, Minus, Trash2, MapPin, Clock, ChevronRight, ChevronLeft,
  ShoppingBasket, Package, Percent, Truck, CreditCard, Smartphone, Banknote,
  Check, Star, Heart, AlertTriangle, RefreshCw, Store, Tag, ArrowRight,
  Apple, Milk, Cookie, CupSoda, Soup, SprayCan, Baby, Croissant, Pill, Wheat,
} from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  storefront, placeOrder, myOrders, myAddresses, saveAddress,
  setDefaultAddress, removeAddress, activeCoupons, skuReviews, postReview,
  asList, num,
} from '../darkstore/useDarkStore';

/* ── helpers ─────────────────────────────────────────────────────────────── */

const rupees = (n) => `₹${Number(n || 0).toFixed(2)}`;
const CAT_TINT = ['shop-cat-tint-0', 'shop-cat-tint-1', 'shop-cat-tint-2',
  'shop-cat-tint-3', 'shop-cat-tint-4', 'shop-cat-tint-5'];

// Category → lucide icon + tint seed. Deterministic by name so the shelf looks stable.
const CAT_META = {
  'Fruits & Vegetables': { Icon: Apple, tint: 1 },
  'Dairy & Breakfast': { Icon: Milk, tint: 2 },
  'Snacks & Munchies': { Icon: Cookie, tint: 3 },
  'Beverages': { Icon: CupSoda, tint: 4 },
  'Instant Food': { Icon: Soup, tint: 5 },
  'Home & Cleaning': { Icon: SprayCan, tint: 0 },
  'Personal Care': { Icon: SprayCan, tint: 3 },
  'Baby Care': { Icon: Baby, tint: 2 },
  'Bakery & Biscuits': { Icon: Croissant, tint: 0 },
  'Pharma & Wellness': { Icon: Pill, tint: 1 },
  'Staples': { Icon: Wheat, tint: 5 },
};

function catMeta(name) {
  if (CAT_META[name]) return CAT_META[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { Icon: Package, tint: h % 6 };
}

const FALLBACK_IMG = (name) => {
  // Deterministic fallback tint tile if the SVG is missing.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0;
  return CAT_TINT[h % 6];
};

function ProductImg({ item, className }) {
  const [broken, setBroken] = useState(false);
  if (!item.image || broken) {
    const { Icon } = catMeta(item.category);
    return (
      <div className={`${className} ${FALLBACK_IMG(item.name)} `}
        style={{ display: 'grid', placeItems: 'center' }}>
        <Icon size={30} />
      </div>
    );
  }
  return (
    <img
      src={item.image}
      alt={item.name}
      className={className}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/* ── product card ────────────────────────────────────────────────────────── */

function ProductCard({ item, qty, onAdd, onInc, onDec, onOpen }) {
  const off = item.on_offer && Number(item.mrp) > Number(item.price);
  const pct = off ? Math.round((1 - Number(item.price) / Number(item.mrp)) * 100) : 0;
  const low = item.available > 0 && item.available <= 5;
  return (
    <article className="shop-pcard" data-testid="product-card">
      <div className="shop-pcard__imgwrap" onClick={() => onOpen(item)}>
        <ProductImg item={item} className="shop-pcard__img" />
        {off && <span className="shop-pcard__badge">{pct}% OFF</span>}
        {low && <span className="shop-pcard__low">Only {item.available} left</span>}
      </div>
      <div className="shop-pcard__body">
        <span className="shop-pcard__time"><Clock size={10} /> 10 MINS</span>
        <span className="shop-pcard__name" onClick={() => onOpen(item)}>{item.name}</span>
        <span className="shop-pcard__pack">{item.pack_size}</span>
        <div className="shop-pcard__pricerow">
          <span className="shop-pcard__price" data-testid="product-price">{rupees(item.price)}</span>
          {off && <span className="shop-pcard__mrp">{rupees(item.mrp)}</span>}
        </div>
      </div>
      <div className="shop-pcard__foot">
        <span className="shop-pcard__unit">{item.pack_size}</span>
        {qty > 0 ? (
          <div className="shop-step">
            <button onClick={() => onDec(item)} aria-label="Remove one">
              {qty === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
            </button>
            <span className="shop-step__qty">{qty}</span>
            <button onClick={() => onInc(item)} disabled={qty >= item.available}
              aria-label="Add one"><Plus size={14} /></button>
          </div>
        ) : (
          <button className="shop-add" data-testid="product-add"
            onClick={() => onAdd(item)} disabled={item.available <= 0}>
            ADD
          </button>
        )}
      </div>
    </article>
  );
}

/* ── product detail sheet ────────────────────────────────────────────────── */

function ProductSheet({ item, onClose, qty, onAdd }) {
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    skuReviews(item.sku_id).then((r) => setReviews(asList(r, 'reviews') || []))
      .catch(() => setReviews([]));
  }, [item.sku_id]);
  const submit = async () => {
    setBusy(true);
    try {
      await postReview(item.sku_id, rating, comment);
      const r = await skuReviews(item.sku_id);
      setReviews(asList(r, 'reviews') || []);
      setComment('');
    } catch { /* toast handled upstream */ }
    setBusy(false);
  };
  const off = item.on_offer && Number(item.mrp) > Number(item.price);
  return (
    <div className="shop-sheet-backdrop" onClick={onClose}>
      <div className="shop-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="shop-sheet__close" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
        <ProductImg item={item} className="shop-sheet__img" />
        <div className="shop-sheet__brand">{item.brand || item.category}</div>
        <h2 className="shop-sheet__name">{item.name}</h2>
        <div className="shop-sheet__pack">{item.pack_size} · {item.category}</div>
        <div className="shop-pcard__time" style={{ marginBottom: 10 }}>
          <Clock size={11} /> Delivery in 10 minutes
        </div>
        <div className="shop-sheet__pricerow">
          <span className="shop-sheet__price" data-testid="product-price">{rupees(item.price)}</span>
          {off && <span className="shop-sheet__mrp">{rupees(item.mrp)}</span>}
          {off && <span className="shop-sheet__save">SAVE {rupees(Number(item.mrp) - Number(item.price))}</span>}
        </div>
        <p className="shop-sheet__desc">
          {item.brand ? `${item.brand} · ` : ''}{item.name} ({item.pack_size}).
          Freshly packed at your nearest dark store and delivered in minutes.
        </p>
        <button className="btn btn-primary btn-block" data-testid="product-add"
          onClick={() => { onAdd(item); onClose(); }} disabled={item.available <= 0}>
          {qty > 0 ? `In basket (${qty}) · Add more` : 'ADD TO BASKET'}
        </button>

        <div className="shop-reviews">
          <div className="shop-reviews__head">
            <span className="shop-reviews__title">Ratings & Reviews</span>
            <span className="shop-section__meta">{reviews.length} review{reviews.length === 1 ? '' : 's'}</span>
          </div>
          {reviews.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--shop-ink-3)' }}>
              No reviews yet. Be the first to review this product.
            </p>
          )}
          {reviews.map((rv) => (
            <div className="shop-review" key={rv.review_id}>
              <div className="shop-review__top">
                <span className="shop-review__stars">
                  {'★'.repeat(rv.rating)}{'☆'.repeat(5 - rv.rating)}
                </span>
                <span className="shop-review__name">{rv.customer_name}</span>
              </div>
              {rv.comment && <div className="shop-review__text">{rv.comment}</div>}
            </div>
          ))}
          <div style={{ marginTop: 12, borderTop: '1px solid var(--shop-line)', paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Write a review</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} onClick={() => setRating(s)}
                  style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
                  <Star size={20} fill={s <= rating ? '#f59e0b' : 'none'}
                    color={s <= rating ? '#f59e0b' : '#d1d5db'} />
                </button>
              ))}
            </div>
            <textarea className="shop-field" rows={2} value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your experience"
              style={{ width: '100%', border: '1px solid var(--shop-line-2)', borderRadius: 8, padding: 8, fontSize: 13, resize: 'vertical' }} />
            <button className="btn btn-secondary" style={{ marginTop: 8 }}
              onClick={submit} disabled={busy || !comment.trim()}>
              {busy ? 'Posting…' : 'Post review'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── receipt screen ──────────────────────────────────────────────────────── */

function ReceiptScreen({ placed, onDone }) {
  return (
    <div className="view-container">
      <header className="view-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Check size={22} color="var(--shop-ok)" /> Order placed!
          </h1>
          <p className="view-subtitle">Arriving in about 10 minutes. Pay {rupees(placed.grand_total)} on delivery.</p>
        </div>
        <button className="btn btn-secondary" onClick={onDone}>Order something else</button>
      </header>

      <div className="shop-receipt">
        <div className="shop-receipt__head">
          <div>
            <div className="shop-receipt__label">ORDER NUMBER</div>
            <div className="shop-receipt__no">{placed.order_no}</div>
          </div>
          <div>
            <div className="shop-receipt__label">PAYMENT</div>
            <div className="shop-receipt__pay">{placed.payment_method}</div>
          </div>
          {placed.delivery_slot && (
            <div>
              <div className="shop-receipt__label">SLOT</div>
              <div className="shop-receipt__pay">{placed.delivery_slot}</div>
            </div>
          )}
        </div>

        <table className="shop-table">
          <tbody>
            {(placed.lines || []).map((l) => (
              <tr key={l.line_no || l.name}>
                <td>{l.name}</td>
                <td style={{ textAlign: 'right' }}>×{l.qty}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupees(l.line_total)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={2} style={{ color: 'var(--shop-ink-3)' }}>Subtotal</td>
              <td style={{ textAlign: 'right' }}>{rupees(placed.subtotal)}</td>
            </tr>
            {Number(placed.discount) > 0 && (
              <tr>
                <td colSpan={2} style={{ color: 'var(--shop-ok)' }}>Coupon {placed.coupon_code}</td>
                <td style={{ textAlign: 'right', color: 'var(--shop-ok)' }}>−{rupees(placed.discount)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={2} style={{ color: 'var(--shop-ink-3)' }}>Delivery</td>
              <td style={{ textAlign: 'right' }}>{rupees(placed.delivery_fee)}</td>
            </tr>
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--shop-line)' }}>
              <td colSpan={2}>To pay on delivery</td>
              <td style={{ textAlign: 'right', color: 'var(--shop-accent)', fontFamily: 'var(--font-display)' }}>
                {rupees(placed.grand_total)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="shop-note" style={{ marginTop: 16 }}>
          <Truck size={17} />
          <span>
            A rider is being assigned. When they are outside, a six-digit delivery
            code appears under <strong>Your orders</strong>. Read it to them and they
            can hand the parcel over.
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── main storefront ─────────────────────────────────────────────────────── */

export default function ShopperStorefrontView() {
  const { user, facilitiesList } = useAuth();
  const stores = facilitiesList?.dark_stores || [];
  const [picked, setPicked] = useState('');
  const siteCode = useMemo(() => {
    if (picked && stores.some((s) => s.code === picked)) return picked;
    return stores[0]?.code || '';
  }, [picked, stores]);

  if (!user) {
    return <div className="alert alert-error">Sign in to order.</div>;
  }
  return (
    <StorefrontScreen siteCode={siteCode} stores={stores} picked={siteCode} onPick={setPicked} />
  );
}

function StorefrontScreen({ siteCode, stores, picked, onPick }) {
  const { toast } = useToast();
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [basket, setBasket] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zippzo:basket') || '{}'); } catch { return {}; }
  });
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState('');
  const [payMethod, setPayMethod] = useState('COD');
  const [slot, setSlot] = useState('Express · 10 mins');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [sheetItem, setSheetItem] = useState(null);
  const [showAddrPanel, setShowAddrPanel] = useState(false);
  const [addrDraft, setAddrDraft] = useState({ label: 'Home', line1: '', city: '', pincode: '' });
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrErr, setAddrErr] = useState('');
  const searchRef = useRef(null);
  // StrictMode remounts in dev; guard so each loader fires once per key.
  const shopLoadedFor = useRef(null);
  const addrLoaded = useRef(false);

  // The address the shelf is asked about. Empty while no address is selected,
  // which is also the "store has no pincode list" case: it stays permissive.
  const addressPincode = useMemo(() => {
    const chosen = addresses.find((a) => a.address_id === addressId);
    return (chosen?.pincode || '').trim();
  }, [addresses, addressId]);

  const loadShop = useCallback((force = false) => {
    if (!siteCode) return;
    // The shelf itself answers "do you deliver here", so the address is part
    // of the cache key: switching address must not keep the old answer.
    const key = `${siteCode}|${addressPincode}`;
    if (!force && shopLoadedFor.current === key) return;
    shopLoadedFor.current = key;
    setLoading(true); setLoadError(null);
    storefront(siteCode, '', addressPincode)
      .then((d) => setShop(d))
      .catch((e) => setLoadError(e.message || 'The shelf could not be loaded.'))
      .finally(() => setLoading(false));
  }, [siteCode, addressPincode]);

  const loadAddresses = useCallback(() => {
    if (addrLoaded.current) return;
    addrLoaded.current = true;
    myAddresses().then((rows) => {
      const list = asList(rows, 'addresses') || [];
      setAddresses(list);
      setAddressId((prev) => prev || (list.find((a) => a.is_default) || list[0])?.address_id || '');
    }).catch(() => { addrLoaded.current = false; });
  }, []);

  useEffect(() => { loadShop(); }, [loadShop]);
  useEffect(() => { loadAddresses(); }, [loadAddresses]);
  useEffect(() => {
    activeCoupons().then((r) => setCoupons(asList(r, 'coupons') || [])).catch(() => setCoupons([]));
  }, []);

  // persist the basket across tab switches and page reloads
  useEffect(() => {
    try { localStorage.setItem('zippzo:basket', JSON.stringify(basket)); } catch { /* private mode */ }
  }, [basket]);

  // reorder from MyOrders pushes items in, then jumps to the Shop tab
  useEffect(() => {
    const onAdd = (e) => {
      const { sku_id, qty } = e.detail || {};
      if (!sku_id) return;
      setBasket((b) => ({ ...b, [sku_id]: Math.min((b[sku_id] || 0) + (qty || 1), 99) }));
    };
    window.addEventListener('zippzo:basket-add', onAdd);
    return () => window.removeEventListener('zippzo:basket-add', onAdd);
  }, []);

  const items = useMemo(() => shop?.items || [], [shop]);
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.sku_id, i])), [items]);

  const categories = useMemo(() => {
    const seen = new Map();
    items.forEach((i) => {
      const c = i.category || 'Others';
      if (!seen.has(c)) seen.set(c, 0);
      seen.set(c, seen.get(c) + 1);
    });
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((i) => {
      if (cat && (i.category || 'Others') !== cat) return false;
      if (!needle) return true;
      return [i.name, i.brand, i.pack_size, i.sku_code, i.category]
        .filter(Boolean).some((f) => String(f).toLowerCase().includes(needle));
    });
  }, [items, cat, query]);

  // group visible by category for sectioned browse
  const grouped = useMemo(() => {
    const m = new Map();
    visible.forEach((i) => {
      const c = i.category || 'Others';
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(i);
    });
    return [...m.entries()];
  }, [visible]);

  const lines = Object.entries(basket)
    .filter(([, q]) => q > 0)
    .map(([skuId, q]) => ({ item: byId[skuId], qty: q }))
    .filter((l) => l.item);
  const subtotal = lines.reduce((s, l) => s + Number(l.item.price) * l.qty, 0);
  const discount = appliedCoupon ? Math.min(
    appliedCoupon.discount_type === 'FLAT'
      ? Number(appliedCoupon.discount_value)
      : subtotal * Number(appliedCoupon.discount_value) / 100,
    appliedCoupon.max_discount ? Number(appliedCoupon.max_discount) : Infinity,
    subtotal,
  ) : 0;
  // The store's own rule, including the "free above ₹X" waiver. The server
  // recomputes this at checkout; showing the same arithmetic here means the
  // amount on the button is the amount charged.
  const deliveryFee = Number(shop?.delivery_fee ?? 20);
  const freeAbove = Number(shop?.free_above ?? 0);
  const feeWaived = freeAbove > 0 && subtotal >= freeAbove;
  const fee = feeWaived ? 0 : (Number.isFinite(deliveryFee) ? deliveryFee : 20);
  const serviceable = shop?.serviceable !== false;
  const total = Math.max(0, subtotal - discount) + fee;
  const basketCount = lines.reduce((s, l) => s + l.qty, 0);

  const add = (item) => {
    setBasket((b) => ({ ...b, [item.sku_id]: Math.min((b[item.sku_id] || 0) + 1, item.available) }));
  };
  const inc = (item) => {
    setBasket((b) => ({ ...b, [item.sku_id]: Math.min((b[item.sku_id] || 0) + 1, item.available) }));
  };
  const dec = (item) => {
    setBasket((b) => {
      const n = (b[item.sku_id] || 0) - 1;
      const next = { ...b };
      if (n <= 0) delete next[item.sku_id]; else next[item.sku_id] = n;
      return next;
    });
  };

  const applyCoupon = () => {
    setCouponError('');
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const found = coupons.find((c) => c.code === code);
    if (!found) { setCouponError('That code is not one of ours.'); return; }
    if (subtotal < Number(found.min_order)) {
      setCouponError(`Add ₹${(Number(found.min_order) - subtotal).toFixed(2)} more to use ${code}.`);
      return;
    }
    setAppliedCoupon(found);
    setCouponInput('');
  };

  const submit = async () => {
    if (!serviceable) {
      setRefusal(`We do not deliver to ${shop?.pincode || 'this address'} from `
        + `${shop?.name || 'this store'} yet. Choose another store or address.`);
      return;
    }
    if (!addressId) { setShowAddrPanel(true); return; }
    setPlacing(true); setRefusal(null);
    try {
      const res = await placeOrder({
        site: siteCode,
        address_id: addressId,
        items: lines.map((l) => ({ sku_id: l.item.sku_id, qty: l.qty })),
        payment_method: payMethod,
        coupon_code: appliedCoupon?.code || '',
        delivery_slot: slot,
      });
      setPlaced(res);
      setBasket({});
      setAppliedCoupon(null);
      setCartOpen(false);
    } catch (e) {
      setRefusal(e.message || 'The order could not be placed.');
      toast(e.message || 'The order could not be placed.', 'error');
    }
    setPlacing(false);
  };

  const saveAddr = async () => {
    setAddrBusy(true); setAddrErr('');
    try {
      const created = await saveAddress({
        label: addrDraft.label || 'Home',
        line1: addrDraft.line1, city: addrDraft.city,
        pincode: addrDraft.pincode, is_default: addresses.length === 0,
      });
      toast('Address saved', 'success');
      setAddrDraft({ label: 'Home', line1: '', city: '', pincode: '' });
      loadAddresses();
      setShowAddrPanel(false);
      window.dispatchEvent(new Event('zippzo:addresses-changed'));
      if (created?.address_id) setAddressId(created.address_id);
    } catch (e) {
      setAddrErr(e.message || 'Could not save that address.');
    }
    setAddrBusy(false);
  };

  /* receipt */
  if (placed) {
    return <ReceiptScreen placed={placed} onDone={() => setPlaced(null)} />;
  }

  const addr = addresses.find((a) => a.address_id === addressId);

  /* ── cart panel (shared desktop sidebar / mobile sheet) ── */
  const cartPanel = (
    <aside className={`shop-cart-panel ${cartOpen ? 'shop-cart--open' : ''}`}
      style={{
        background: 'var(--shop-surface)', border: '1px solid var(--shop-line)',
        borderRadius: 'var(--shop-radius-lg)', padding: 16,
        position: 'sticky', top: 'calc(var(--shop-topbar-h) + 16px)',
        maxHeight: 'calc(100dvh - var(--shop-topbar-h) - 32px)',
        display: 'flex', flexDirection: 'column',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700 }}>
          My Basket <span style={{ color: 'var(--shop-ink-3)', fontWeight: 500 }}>({basketCount})</span>
        </h2>
        <button className="shop-sheet__close" style={{ position: 'static' }}
          onClick={() => setCartOpen(false)} aria-label="Close basket">
          <X size={16} />
        </button>
      </div>

      {lines.length === 0 ? (
        <div className="shop-empty-card" data-testid="basket-empty" style={{ padding: '28px 16px' }}>
          <ShoppingBasket size={32} />
          <div className="shop-empty-card__title">Your basket is empty</div>
          <div className="shop-empty-card__sub">Add items to get started.</div>
        </div>
      ) : (
        <>
          <ul data-testid="basket-lines" style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', flex: 1 }}>
            {lines.map((l) => (
              <li key={l.item.sku_id} data-testid="basket-line"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--shop-line)' }}>
                <ProductImg item={l.item} className="shop-cart-line__img" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{l.item.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--shop-ink-3)' }}>
                    {l.item.pack_size} ×{l.qty}
                  </div>
                </div>
                <span data-testid="basket-line-total" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                  {rupees(Number(l.item.price) * l.qty)}
                </span>
                <div className="shop-step" style={{ height: 26 }}>
                  <button style={{ width: 26, height: 26 }} onClick={() => dec(l.item)} aria-label="Less">
                    {l.qty === 1 ? <Trash2 size={12} /> : <Minus size={12} />}
                  </button>
                  <span className="shop-step__qty" style={{ minWidth: 18, fontSize: 12 }}>{l.qty}</span>
                  <button style={{ width: 26, height: 26 }} onClick={() => inc(l.item)}
                    disabled={l.qty >= l.item.available} aria-label="More"><Plus size={12} /></button>
                </div>
              </li>
            ))}
          </ul>

          {/* bill */}
          <div data-testid="basket-totals" style={{ borderTop: '1px solid var(--shop-line)', paddingTop: 12, marginTop: 8 }}>
            <div className="shop-bill">
              <div className="shop-bill__row">
                <span data-testid="basket-subtotal">Subtotal</span>
                <span className="num" data-testid="basket-subtotal-value">{rupees(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="shop-bill__row shop-bill__row--discount">
                  <span>Coupon {appliedCoupon.code}</span>
                  <span className="num">−{rupees(discount)}</span>
                </div>
              )}
              <div className="shop-bill__row">
                <span>Delivery fee</span>
                <span className="num" data-testid="basket-fee-value">
                  {feeWaived
                    ? <><s style={{ color: 'var(--shop-ink-3)', marginRight: 6 }}>{rupees(deliveryFee)}</s>FREE</>
                    : rupees(fee)}
                </span>
              </div>
              {freeAbove > 0 && !feeWaived && (
                <div style={{ fontSize: 11.5, color: 'var(--shop-ink-3)', marginTop: -2, marginBottom: 6 }}>
                  Free delivery on baskets over {rupees(freeAbove)}
                </div>
              )}
              <hr className="shop-bill__divider" />
              <div className="shop-bill__row shop-bill__row--total">
                <span data-testid="basket-total">To pay</span>
                <span className="num" data-testid="basket-total-value">{rupees(total)}</span>
              </div>
            </div>

            {/* coupon */}
            {!appliedCoupon ? (
              <div className="shop-coupon" style={{ marginTop: 12 }}>
                <input value={couponInput} onChange={(e) => setCouponInput(e.target.value)}
                  placeholder="Coupon code" aria-label="Coupon code" />
                <button onClick={applyCoupon}>Apply</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12,
                background: 'var(--shop-ok-soft)', borderRadius: 8, padding: '8px 12px' }}>
                <Tag size={14} color="var(--shop-ok)" />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--shop-ok)' }}>
                  {appliedCoupon.code} applied · −{rupees(discount)}
                </span>
                <button onClick={() => setAppliedCoupon(null)}
                  style={{ marginLeft: 'auto', background: 'none', border: 0, color: 'var(--shop-ok)', cursor: 'pointer' }}>
                  <X size={14} />
                </button>
              </div>
            )}
            {couponError && (
              <div style={{ fontSize: 12, color: 'var(--shop-bad)', marginTop: 6 }}>{couponError}</div>
            )}

            {/* payment */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Payment method</div>
              <div className="shop-choice-grid">
                {[
                  { id: 'COD', icon: Banknote, title: 'Cash on Delivery', sub: 'Pay the rider when it arrives' },
                  { id: 'UPI', icon: Smartphone, title: 'UPI', sub: 'GPay, PhonePe, Paytm' },
                  { id: 'CARD', icon: CreditCard, title: 'Card', sub: 'Credit / debit at delivery' },
                ].map((p) => {
                  const Icon = p.icon;
                  return (
                    <button key={p.id} className="shop-choice" aria-pressed={payMethod === p.id}
                      onClick={() => setPayMethod(p.id)}>
                      <span className="shop-choice__icon"><Icon size={18} /></span>
                      <span className="shop-choice__body">
                        <span className="shop-choice__title">{p.title}</span>
                        <span className="shop-choice__sub">{p.sub}</span>
                      </span>
                      <Check size={16} className="shop-choice__tick" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* slot */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Delivery slot</div>
              <div className="shop-choice-grid">
                {['Express · 10 mins', 'Within 30 mins', 'Schedule · tonight'].map((s) => (
                  <button key={s} className="shop-choice" aria-pressed={slot === s} onClick={() => setSlot(s)}>
                    <span className="shop-choice__icon"><Clock size={18} /></span>
                    <span className="shop-choice__body">
                      <span className="shop-choice__title">{s}</span>
                    </span>
                    <Check size={16} className="shop-choice__tick" />
                  </button>
                ))}
              </div>
            </div>

            {/* address */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Deliver to</span>
                {addresses.length > 0 && (
                  <button onClick={() => setShowAddrPanel((v) => !v)}
                    style={{ background: 'none', border: 0, color: 'var(--shop-accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    {showAddrPanel ? 'Done' : 'Manage'}
                  </button>
                )}
              </div>
              {addresses.length === 0 || showAddrPanel ? (
                <div>
                  {addresses.length === 0 && !showAddrPanel && (
                    <p style={{ fontSize: 13, color: 'var(--shop-ink-3)', margin: '0 0 10px' }}>No delivery address yet</p>
                  )}
                  {addresses.length === 0 && (
                    <button className="btn btn-secondary btn-block" style={{ marginBottom: 10 }}
                      onClick={() => setShowAddrPanel(true)}>
                      Manage
                    </button>
                  )}
                  {showAddrPanel && addresses.map((a) => (
                    <div key={a.address_id} className="shop-addr-card">
                      <MapPin size={16} className="shop-addr-card__icon" />
                      <div style={{ flex: 1 }}>
                        <div className="shop-addr-card__label">{a.label || 'Address'}</div>
                        <div className="shop-addr-card__text">{a.line1}, {a.city} {a.pincode}</div>
                      </div>
                      <div className="shop-addr-card__actions">
                        {!a.is_default && (
                          <button onClick={() => setDefaultAddress(a.address_id).then(loadAddresses)}>Default</button>
                        )}
                        <button onClick={() => removeAddress(a.address_id).then(loadAddresses)}>Remove</button>
                      </div>
                    </div>
                  ))}
                  {showAddrPanel && (
                    <div style={{ marginTop: 10 }}>
                      <input className="shop-field" placeholder="Flat, building, street *"
                        value={addrDraft.line1} onChange={(e) => setAddrDraft((d) => ({ ...d, line1: e.target.value }))}
                        style={{ width: '100%', border: '1px solid var(--shop-line-2)', borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 8 }} />
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <input placeholder="City *" value={addrDraft.city}
                          onChange={(e) => setAddrDraft((d) => ({ ...d, city: e.target.value }))}
                          style={{ border: '1px solid var(--shop-line-2)', borderRadius: 8, padding: 10, fontSize: 13 }} />
                        <input placeholder="PIN *" value={addrDraft.pincode} maxLength={6}
                          onChange={(e) => setAddrDraft((d) => ({ ...d, pincode: e.target.value }))}
                          style={{ border: '1px solid var(--shop-line-2)', borderRadius: 8, padding: 10, fontSize: 13 }} />
                      </div>
                      {addrErr && <div style={{ fontSize: 12, color: 'var(--shop-bad)', marginTop: 6 }}>{addrErr}</div>}
                      <button className="btn btn-primary btn-block" style={{ marginTop: 10 }}
                        onClick={saveAddr} disabled={addrBusy || !addrDraft.line1 || !addrDraft.city || !addrDraft.pincode}>
                        {addrBusy ? 'Saving…' : 'Add address'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <select value={addressId} onChange={(e) => setAddressId(e.target.value)}
                  style={{ width: '100%', border: '1px solid var(--shop-line-2)', borderRadius: 8, padding: 10, fontSize: 13 }}>
                  {addresses.map((a) => (
                    <option key={a.address_id} value={a.address_id}>
                      {a.label ? `${a.label}: ` : ''}{a.line1}, {a.city} {a.pincode}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {refusal && (
              <div className="alert alert-error" style={{ marginTop: 12, fontSize: 12.5 }}>
                <AlertTriangle size={14} /> {refusal}
              </div>
            )}

            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }}
              data-testid="place-order" onClick={submit}
              disabled={placing || lines.length === 0 || !addressId || !serviceable}>
              {placing ? 'Placing…' : `Place order · ${rupees(total)}`}
            </button>
          </div>
        </>
      )}
    </aside>
  );

  /* ── main ── */
  return (
    <div className="view-container">
      {/* store row */}
      <div className="shop-storerow">
        {stores.length > 1 ? (
          <label className="shop-chip" htmlFor="shop-select">
            <Store size={14} />
            <select id="shop-select" value={picked}
              onChange={(e) => { setCat(''); setQuery(''); onPick(e.target.value); }}>
              {stores.map((s) => (
                <option key={s.code} value={s.code}>{s.name || s.code}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className="shop-chip"><Store size={14} /> {shop?.name || siteCode}</span>
        )}
        <span className="shop-chip shop-chip--quiet">
          <Truck size={14} /> {fee > 0 ? `${rupees(fee)} delivery` : 'Free delivery'}
        </span>
        <button className="shop-refresh" onClick={() => loadShop(true)} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loadError && (
        <div className="alert alert-error" style={{ marginBottom: 14 }}>
          <AlertTriangle size={16} /> {loadError}
        </div>
      )}

      {shop && !serviceable && (
        <div className="alert alert-error" data-testid="serviceability-banner"
          style={{ marginBottom: 14 }}>
          <AlertTriangle size={16} />
          <span>
            {shop.name || siteCode} does not deliver to {shop.pincode} yet. Pick another
            store above or choose a different delivery address.
          </span>
        </div>
      )}

      {/* delivery banner */}
      <div className="shop-banner">
        <div className="shop-banner__icon"><Truck size={22} /></div>
        <div>
          <div className="shop-banner__title">Delivery in 10 minutes</div>
          <div className="shop-banner__sub">Fresh groceries from {shop?.name || 'your nearest dark store'}</div>
        </div>
      </div>

      {/* search */}
      <div className="shop-search">
        <Search size={18} />
        <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for atta, dal, coke, maggi…" aria-label="Search products" />
        {query && (
          <button className="shop-search__clear" onClick={() => { setQuery(''); searchRef.current?.focus(); }}
            aria-label="Clear search"><X size={14} /></button>
        )}
      </div>

      {/* offers */}
      {coupons.length > 0 && (
        <div className="shop-offers">
          {coupons.map((c, i) => {
            const tint = ['shop-offer--violet', 'shop-offer--green', 'shop-offer--amber'][i % 3];
            return (
              <div key={c.coupon_id} className={`shop-offer ${tint}`}>
                <span className="shop-offer__code">{c.code}</span>
                <span className="shop-offer__desc">{c.description || c.title}</span>
                {Number(c.min_order) > 0 && (
                  <span className="shop-offer__min">Min order {rupees(c.min_order)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* category rail */}
      {categories.length > 1 && (
        <div className="shop-cats">
          <button className="shop-cat" aria-pressed={cat === ''} onClick={() => setCat('')}>
            <span className={`shop-cat__disc ${CAT_TINT[0]}`}><Package size={24} /></span>
            <span className="shop-cat__label">All</span>
          </button>
          {categories.map(([name, count]) => {
            const { Icon } = catMeta(name);
            const m = catMeta(name);
            return (
              <button key={name} className="shop-cat" aria-pressed={cat === name}
                onClick={() => setCat(cat === name ? '' : name)}>
                <span className={`shop-cat__disc ${CAT_TINT[m.tint]}`}><Icon size={24} /></span>
                <span className="shop-cat__label">{name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* shelf */}
      <div className="shop-cart-layout">
        <div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--shop-ink-3)' }}>Loading the shelf…</div>
          ) : items.length === 0 ? (
            <div className="shop-empty-card" data-testid="storefront-empty">
              <Package size={36} />
              <div className="shop-empty-card__title">Nothing on its shelves</div>
              <div className="shop-empty-card__sub">This store has no listed items right now.</div>
            </div>
          ) : visible.length === 0 ? (
            <div className="shop-empty-card">
              <Search size={32} />
              <div className="shop-empty-card__title">No matches for “{query || cat}”</div>
              <button className="shop-empty-card__cta" onClick={() => { setQuery(''); setCat(''); }}>
                Show everything
              </button>
            </div>
          ) : (
            grouped.map(([name, list]) => (
              <section key={name} className="shop-section">
                <div className="shop-section__head">
                  <h2 className="shop-section__title">{name}</h2>
                  <span className="shop-section__meta">{list.length} item{list.length === 1 ? '' : 's'}</span>
                </div>
                <div className="shop-grid">
                  {list.map((item) => (
                    <ProductCard key={item.sku_id} item={item}
                      qty={basket[item.sku_id] || 0}
                      onAdd={add} onInc={inc} onDec={dec} onOpen={setSheetItem} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {cartPanel}
      </div>

      {/* mobile cart bar */}
      {basketCount > 0 && !cartOpen && (
        <button className="shop-cartbar" onClick={() => setCartOpen(true)} aria-label="Open basket">
          <span className="shop-cartbar__left">
            <span className="shop-cartbar__count">{basketCount} item{basketCount === 1 ? '' : 's'} · {rupees(total)}</span>
            <span className="shop-cartbar__total">View basket</span>
          </span>
          <span className="shop-cartbar__cta">View basket <ArrowRight size={16} /></span>
        </button>
      )}

      {sheetItem && (
        <ProductSheet item={sheetItem} qty={basket[sheetItem.sku_id] || 0}
          onAdd={add} onClose={() => setSheetItem(null)} />
      )}
    </div>
  );
}
