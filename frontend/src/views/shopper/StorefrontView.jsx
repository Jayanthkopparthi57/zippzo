import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, Plus, Minus, Trash2, MapPin, Clock, ChevronRight, ChevronLeft,
  ShoppingBasket, Package, Truck, Smartphone, Banknote,
  Check, Star, AlertTriangle, Tag, ArrowRight,
  Apple, Milk, Cookie, CupSoda, Soup, SprayCan, Baby, Croissant, Pill, Wheat,
  LocateFixed,
} from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { describeError } from '../../api/client';
import {
  storefront, placeOrder, myAddresses, saveAddress,
  setDefaultAddress, removeAddress, activeCoupons, skuReviews, postReview,
  deliveryCoverage, cashfreePaymentStatus, asList,
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

async function openCashfreeCheckout(paymentSessionId, environment) {
  if (!window.Cashfree) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Cashfree checkout.'));
      document.head.appendChild(script);
    });
  }
  if (!window.Cashfree) throw new Error('Cashfree checkout is unavailable in this browser.');
  const cashfree = window.Cashfree({ mode: environment === 'production' ? 'production' : 'sandbox' });
  return cashfree.checkout({ paymentSessionId, redirectTarget: '_modal' });
}

function distanceKm(from, to) {
  if ([from?.geo_lat, from?.geo_lng, to?.geo_lat, to?.geo_lng]
    .some((value) => value == null || value === '')) return null;
  const lat1 = Number(from?.geo_lat);
  const lng1 = Number(from?.geo_lng);
  const lat2 = Number(to?.geo_lat);
  const lng2 = Number(to?.geo_lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)
      || Math.abs(lat1) > 90 || Math.abs(lat2) > 90
      || Math.abs(lng1) > 180 || Math.abs(lng2) > 180) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, a));
  return 6371 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}

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
  const unitPrice = item.weight_g && Number(item.weight_g) > 0 ? Number(item.price) / (Number(item.weight_g) / 100) : null;
  return (
    <article className="shop-pcard" data-testid="product-card">
      <div className="shop-pcard__imgwrap" onClick={() => onOpen(item)}>
        <ProductImg item={item} className="shop-pcard__img" />
        {off && <span className="shop-pcard__badge">{pct}% OFF</span>}
        {low && <span className="shop-pcard__low">Only {item.available} left</span>}
      </div>
      <div className="shop-pcard__body">
        <span className="shop-pcard__name" onClick={() => onOpen(item)}>{item.name}</span>
        <span className="shop-pcard__pack">{item.pack_size}</span>
        <div className="shop-pcard__pricerow">
          <span className="shop-pcard__price" data-testid="product-price">{rupees(item.price)}</span>
          {off && <span className="shop-pcard__mrp">{rupees(item.mrp)}</span>}
        </div>
        {unitPrice != null && <span className="shop-pcard__unit">{rupees(unitPrice)} / 100g</span>}
      </div>
      <div className="shop-pcard__foot">
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

/* ── product detail page ─────────────────────────────────────────────────── */

function ProductPage({ item, qty, onAdd, onInc, onDec,
                       onBack, siteName, onBuyNow, placing, refusal, clearRefusal }) {
  const [reviews, setReviews] = useState([]);
  const [imageIndex, setImageIndex] = useState(0);
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
  const pct = off ? Math.round((1 - Number(item.price) / Number(item.mrp)) * 100) : 0;
  const low = item.available > 0 && item.available <= 5;
  const unitPrice = item.weight_g && Number(item.weight_g) > 0 ? Number(item.price) / (Number(item.weight_g) / 100) : null;
  const images = item.images && item.images.length ? item.images : [item.image];
  const ratingValue = Number(item.rating || 0);
  const qtyInBasket = qty || 0;

  return (
    <div className="view-container shop-pdp">
      <div className="shop-pdp__crumbs">
        <button type="button" className="shop-pdp__back" onClick={onBack} aria-label="Back to storefront">
          <ChevronLeft size={17} /> Back to shelf
        </button>
        <span className="shop-pdp__crumb">Groceries <ChevronRight size={12} /> {item.category || 'Others'} <ChevronRight size={12} /> <span>{item.name}</span></span>
      </div>

      <div className="shop-pdp__panel">
        <div className="shop-pdp__gallery">
          <div className="shop-pdp__imgwrap">
            <ProductImg item={{ ...item, image: images[imageIndex] || item.image }} className="shop-pdp__img" />
            {off && <span className="shop-pdp__off">{pct}% OFF</span>}
            {low && <span className="shop-pdp__low">Only {item.available} left</span>}
          </div>
          {images.length > 1 && (
            <div className="shop-pdp__thumbs">
              {images.map((url, index) => (
                <button key={`${url}-${index}`} type="button" onClick={() => setImageIndex(index)}
                  className={`shop-pdp__thumb${index === imageIndex ? ' shop-pdp__thumb--on' : ''}`}
                  aria-label={`Show photo ${index + 1}`}>
                  <img src={url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="shop-pdp__info">
          <div className="shop-pdp__brand">{(item.brand || item.category || 'Zippzo').toUpperCase()}</div>
          <h1 className="shop-pdp__name">{item.name}</h1>
          <div className="shop-pdp__meta">{[item.pack_size, item.category].filter(Boolean).join(' · ') || 'Each'}</div>

          {ratingValue > 0 && (
            <div className="shop-pdp__rating">
              <Star size={14} fill="#f4b400" color="#f4b400" />
              <strong>{ratingValue.toFixed(1)}</strong>
              {Number(item.review_count) > 0 && <span>({item.review_count} reviews)</span>}
            </div>
          )}

          <div className="shop-pdp__pricerow">
            <span className="shop-pdp__price">{rupees(item.price)}</span>
            {off && <span className="shop-pdp__mrp">{rupees(item.mrp)}</span>}
            {off && <span className="shop-pdp__save">Save {rupees(Number(item.mrp) - Number(item.price))} ({pct}% off)</span>}
          </div>
          {unitPrice != null && <div className="shop-pdp__unit">{rupees(unitPrice)} / 100 g</div>}

          <div className="shop-pdp__buyrow">
            {item.available > 0 ? (
              <div className="shop-step shop-pdp__step">
                <button onClick={() => (qtyInBasket > 0 ? onDec(item) : null)} aria-label="Remove one" disabled={qtyInBasket === 0}>
                  {qtyInBasket <= 1 ? <Trash2 size={15} /> : <Minus size={15} />}
                </button>
                <span className="shop-step__qty">{qtyInBasket || 1}</span>
                <button onClick={() => onInc(item)} disabled={qtyInBasket >= item.available} aria-label="Add one">
                  <Plus size={15} />
                </button>
              </div>
            ) : null}
            <button className="shop-btn shop-btn--ghost shop-pdp__addcart" data-testid="product-add"
              onClick={() => onAdd(item)} disabled={item.available <= 0}>
              {qtyInBasket > 0 ? `In basket (${qtyInBasket}) · Add more` : 'Add to basket'}
            </button>
            <button className="shop-btn shop-btn--primary shop-pdp__buynow"
              onClick={() => onBuyNow(item, Math.max(1, qtyInBasket))}
              disabled={item.available <= 0 || placing}>
              {placing ? 'Placing…' : 'Buy now'}
            </button>
          </div>
          {item.available <= 0 && <div className="shop-pdp__oos">Out of stock at this store</div>}
          {clearRefusal && refusal && (
            <div className="shop-pdp__refusal" role="alert">
              <AlertTriangle size={14} /> {refusal}
            </div>
          )}
        </div>
      </div>

      {item.description && <div className="shop-pdp__about">{item.description}</div>}

      <div className="shop-pdp__details">
        <div className="shop-pdp__block">
          <div className="shop-pdp__blocktitle">Product details</div>
          {[
            ['Brand', item.brand || '—'],
            ['Pack size', item.pack_size || 'Each'],
            ['Category', item.category || 'Others'],
            ['Availability', item.available > 0 ? `${item.available} in stock` : 'Out of stock'],
            ['Sold by', siteName || 'This dark store'],
          ].map(([label, value]) => (
            <div key={label} className="shop-pdp__row">
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
          {(item.ingredients || item.allergens || item.storage_notes) && (
            <div className="shop-pdp__extras">
              {item.ingredients && <div><strong>Ingredients</strong><p>{item.ingredients}</p></div>}
              {item.allergens && <div><strong>Allergens</strong><p>{item.allergens}</p></div>}
              {item.storage_notes && <div><strong>Storage</strong><p>{item.storage_notes}</p></div>}
            </div>
          )}
        </div>

        <div className="shop-pdp__block">
          <div className="shop-reviews__head">
            <span className="shop-pdp__blocktitle">Ratings & reviews</span>
            <span className="shop-section__meta">{reviews.length} review{reviews.length === 1 ? '' : 's'}</span>
          </div>
          {reviews.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--shop-ink-3)' }}>No reviews yet. Be the first to review this product.</p>
          )}
          {reviews.map((rv) => (
            <div className="shop-review" key={rv.review_id}>
              <div className="shop-review__top">
                <span className="shop-review__stars">{'★'.repeat(rv.rating)}{'☆'.repeat(5 - rv.rating)}</span>
                <span className="shop-review__name">{rv.customer_name}</span>
              </div>
              {rv.comment && <div className="shop-review__text">{rv.comment}</div>}
            </div>
          ))}
          <div style={{ marginTop: 12, borderTop: '1px solid var(--shop-line)', paddingTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Write a review</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} onClick={() => setRating(s)} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
                  <Star size={20} fill={s <= rating ? '#f4b400' : 'none'} color={s <= rating ? '#f4b400' : '#d1d5db'} />
                </button>
              ))}
            </div>
            <textarea className="shop-field" rows={2} value={comment} onChange={(e) => setComment(e.target.value)}
              placeholder="Share your experience"
              style={{ width: '100%', border: '1px solid var(--shop-line-2)', borderRadius: 8, padding: 8, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={submit} disabled={busy || !comment.trim()}>
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
  const paidOnline = placed.payment_method === 'Cashfree' || placed.payment_method === 'CASHFREE';
  return (
    <div className="view-container">
      <header className="view-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Check size={22} color="var(--shop-ok)" /> Order placed!
          </h1>
          <p className="view-subtitle">
            {paidOnline
              ? `Payment of ${rupees(placed.grand_total)} received. Track delivery in My Orders.`
              : `Arriving in about ${placed.promise_minutes || 10} minutes. Pay ${rupees(placed.grand_total)} on delivery.`}
          </p>
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
            {Number(placed.coupon_discount ?? placed.discount) > 0 && (
              <tr>
                <td colSpan={2} style={{ color: 'var(--shop-ok)' }}>
                  {placed.coupon_code ? `Coupon ${placed.coupon_code}` : 'Coupon savings'}
                </td>
                <td style={{ textAlign: 'right', color: 'var(--shop-ok)' }}>
                  −{rupees(placed.coupon_discount ?? placed.discount)}
                </td>
              </tr>
            )}
            {Number(placed.combo_discount) > 0 && (
              <tr>
                <td colSpan={2} style={{ color: 'var(--shop-ok)' }}>Combo savings</td>
                <td style={{ textAlign: 'right', color: 'var(--shop-ok)' }}>−{rupees(placed.combo_discount)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={2} style={{ color: 'var(--shop-ink-3)' }}>Delivery</td>
              <td style={{ textAlign: 'right' }}>{rupees(placed.delivery_fee)}</td>
            </tr>
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--shop-line)' }}>
              <td colSpan={2}>{paidOnline ? 'Paid online' : 'To pay on delivery'}</td>
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
  const { user } = useAuth();
  if (!user) {
    return <div className="alert alert-error">Sign in to order.</div>;
  }
  return <StorefrontScreen siteCode="" />;
}

function StorefrontScreen({ siteCode: requestedSiteCode }) {
  const toast = useToast();
  const { user } = useAuth();
  const basketStorageKey = `zippzo:basket:${user?.user_id || 'guest'}`;
  const [shop, setShop] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nearbyCoordinates] = useState(null);
  const [useCurrentLocation] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [basket, setBasket] = useState(() => {
    try { return JSON.parse(localStorage.getItem(basketStorageKey) || '{}'); } catch { return {}; }
  });
  const [addresses, setAddresses] = useState([]);
  const [addressId, setAddressId] = useState('');
  const [manualPincode, setManualPincode] = useState('');
  const [coveredStores, setCoveredStores] = useState([]);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageChecked, setCoverageChecked] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [pendingPayment, setPendingPayment] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState('');
  const [payMethod, setPayMethod] = useState('COD');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [sheetItem, setSheetItem] = useState(null);
  const [showAddrPanel, setShowAddrPanel] = useState(false);
  const [addrDraft, setAddrDraft] = useState({ label: 'Home', line1: '', city: '', pincode: '', geo_lat: null, geo_lng: null });
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrErr, setAddrErr] = useState('');
  const [addrGeoBusy, setAddrGeoBusy] = useState(false);
  const [addrGeoStatus, setAddrGeoStatus] = useState('');
  /* The top bar owns search: every keystroke from its input lands here as the
     shelf's query, and submitting jumps to the storefront tab. */
  useEffect(() => {
    const handler = (e) => setQuery(String(e.detail ?? ''));
    window.addEventListener('zippzo:search', handler);
    return () => window.removeEventListener('zippzo:search', handler);
  }, []);
  // StrictMode remounts in dev; guard so each loader fires once per key.
  const shopLoadedFor = useRef(null);
  const shopRequestSequence = useRef(0);
  const addrLoaded = useRef(false);
  const basketStore = useRef('');

  // A shelf is never loaded until the shopper has a delivery pincode and a
  // dark store has explicitly published coverage for it.
  const addressPincode = useMemo(() => {
    const chosen = addresses.find((a) => a.address_id === addressId);
    return (chosen?.pincode || '').trim();
  }, [addresses, addressId]);
  const deliveryPincode = addressPincode || manualPincode.trim();
  useEffect(() => {
    let active = true;
    setCoverageChecked(false);
    setCoveredStores([]);
    if (!/^\d{6}$/.test(deliveryPincode)) {
      setCoverageLoading(false);
      return () => { active = false; };
    }
    setCoverageLoading(true);
    setLocationError('');
    deliveryCoverage(deliveryPincode)
      .then((response) => {
        if (!active) return;
        const matches = Array.isArray(response?.sites) ? response.sites : [];
        setCoveredStores(matches);
        setCoverageChecked(true);
      })
      .catch((error) => {
        if (active) {
          setCoveredStores([]);
          setCoverageChecked(true);
          setLocationError(error.message || 'Could not check delivery coverage.');
        }
      })
      .finally(() => { if (active) setCoverageLoading(false); });
    return () => { active = false; };
  }, [deliveryPincode]);
  const deliveryAddress = addresses.find((a) => a.address_id === addressId)
    || addresses.find((a) => a.is_default)
    || addresses[0]
    || null;
  const distanceOrigin = !useCurrentLocation
    && deliveryAddress?.geo_lat != null && deliveryAddress?.geo_lng != null
    ? deliveryAddress
    : nearbyCoordinates;
  const nearestStore = useMemo(() => {
    if (!distanceOrigin) return null;
    return coveredStores
      .map((store) => ({ store, distance: distanceKm(distanceOrigin, store) }))
      .filter((entry) => entry.distance !== null)
      .sort((a, b) => a.distance - b.distance)[0]?.store || null;
  }, [distanceOrigin, coveredStores]);
  const siteCode = (coveredStores.some((store) => store.code === requestedSiteCode)
    ? requestedSiteCode : '') || nearestStore?.code || coveredStores[0]?.code || '';

  const loadShop = useCallback((force = false) => {
    // A shopper with no published store has no shelf to ask about. Say so
    // instead of leaving the loading placeholder up forever: siteCode arrives
    // asynchronously with the store directory, so this clears itself as soon
    // as a store is resolvable.
    if (!siteCode) {
      shopRequestSequence.current += 1;
      shopLoadedFor.current = null;
      setShop(null);
      setLoading(coverageLoading);
      setLoadError(coverageLoading || !coverageChecked
        ? null
        : (deliveryPincode
          ? `No active dark store currently delivers to ${deliveryPincode}.`
          : 'Enter your delivery pincode to see products available near you.'));
      return;
    }
    // The shelf itself answers "do you deliver here", so the address is part
    // of the cache key: switching address must not keep the old answer.
    const key = `${siteCode}|${deliveryPincode}`;
    if (!force && shopLoadedFor.current === key) return;
    shopLoadedFor.current = key;
    const requestSequence = ++shopRequestSequence.current;
    setLoading(true); setLoadError(null);
    setShop(null);
    storefront(siteCode, '', deliveryPincode)
      .then((d) => {
        if (requestSequence === shopRequestSequence.current) setShop(d);
      })
      .catch((e) => {
        if (requestSequence !== shopRequestSequence.current) return;
        // The key was claimed before the request went out. Release it on
        // failure, otherwise one dropped read is cached as "this store has
        // nothing" and Refresh is the only thing that can ever clear it.
        shopLoadedFor.current = null;
        setLoadError(e.message || 'The shelf could not be loaded.');
      })
      .finally(() => {
        if (requestSequence === shopRequestSequence.current) setLoading(false);
      });
  }, [siteCode, deliveryPincode, coverageChecked, coverageLoading]);

  const loadAddresses = useCallback((force = false) => {
    if (addrLoaded.current && !force) return;
    addrLoaded.current = true;
    return myAddresses().then((rows) => {
      const list = asList(rows, 'addresses') || [];
      setAddresses(list);
      setAddressId((prev) => (list.some((a) => a.address_id === prev)
        ? prev : (list.find((a) => a.is_default) || list[0])?.address_id || ''));
      const preferred = list.find((a) => a.is_default) || list[0];
      if (preferred?.pincode) setManualPincode(preferred.pincode);
    }).catch((error) => {
      addrLoaded.current = false;
      if (force) throw error;
    });
  }, []);

  useEffect(() => { loadShop(); }, [loadShop]);
  useEffect(() => { loadAddresses(); }, [loadAddresses]);
  useEffect(() => {
    setAppliedCoupon(null);
    setCouponError('');
    let active = true;
    activeCoupons(siteCode)
      .then((r) => {
        if (active) setCoupons(asList(r, 'coupons') || []);
      })
      .catch((error) => {
        if (!active) return;
        setCoupons([]);
        if (siteCode) toast.error('Offers unavailable', describeError(error));
      });
    return () => { active = false; };
  }, [siteCode, toast]);

  // persist the basket across tab switches and page reloads
  useEffect(() => {
    try { localStorage.setItem(basketStorageKey, JSON.stringify(basket)); } catch { /* private mode */ }
  }, [basket, basketStorageKey]);

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
  const comboOffers = useMemo(() => shop?.combo_offers || [], [shop]);
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

  // One representative image per category — the tile the shelf picked for
  // itself, from its own listings. Falls back to the icon when a category
  // has no imagery.
  const catImages = useMemo(() => {
    const map = {};
    items.forEach((i) => {
      const c = i.category || 'Others';
      const img = i.image || (Array.isArray(i.images) && i.images[0]);
      if (img && !map[c]) map[c] = img;
    });
    return map;
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
  const requestedCouponDiscount = appliedCoupon && subtotal >= Number(appliedCoupon.min_order) ? Math.min(
    appliedCoupon.discount_type === 'FLAT'
      ? Number(appliedCoupon.discount_value)
      : subtotal * Number(appliedCoupon.discount_value) / 100,
    appliedCoupon.max_discount ? Number(appliedCoupon.max_discount) : Infinity,
    subtotal,
  ) : 0;
  const comboSavings = useMemo(() => {
    const remaining = Object.fromEntries(lines.map((line) => [line.item.sku_id, line.qty]));
    const candidates = comboOffers.filter((offer) => offer.items.length > 0).map((offer) => ({
      offer,
      count: Math.min(...offer.items.map((item) =>
        Math.floor((remaining[item.sku_id] || 0) / item.quantity))),
    })).sort((a, b) => Number(b.offer.savings) - Number(a.offer.savings)
      || String(a.offer.offer_id).localeCompare(String(b.offer.offer_id)));
    const applied = [];
    candidates.forEach(({ offer, count }) => {
      if (count < 1) return;
      offer.items.forEach((item) => {
        remaining[item.sku_id] = (remaining[item.sku_id] || 0) - item.quantity * count;
      });
      applied.push({ offer, count, savings: Number(offer.savings) * count });
    });
    const rawTotal = applied.reduce((sum, item) => sum + item.savings, 0);
    return {
      offers: applied,
      total: Math.min(rawTotal, subtotal),
    };
  }, [comboOffers, lines, subtotal]);
  const discount = Math.min(
    requestedCouponDiscount,
    Math.max(0, subtotal - comboSavings.total),
  );
  // Handling charge: ₹20 below ₹150 basket, free above — the standing rule
  // for stores without their own rule; a store's rule overrides this.
  // The server recomputes this at checkout; showing the same arithmetic
  // here means the amount on the button is the amount charged.
  const deliveryFee = Number(shop?.delivery_fee ?? 20);
  const freeAbove = Number(shop?.free_above ?? 150);
  const feeWaived = freeAbove > 0 && subtotal >= freeAbove;
  const fee = feeWaived ? 0 : (Number.isFinite(deliveryFee) ? deliveryFee : 20);
  const serviceable = shop?.serviceable !== false;
  const total = Math.max(0, subtotal - discount - comboSavings.total) + fee;
  const basketCount = lines.reduce((s, l) => s + l.qty, 0);
  useEffect(() => {
    if (!siteCode) return;
    if (basketStore.current && basketStore.current !== siteCode && basketCount > 0) {
      setBasket({});
      setAppliedCoupon(null);
      toast.error('Basket cleared', 'Your delivery area uses a different dark store, so we cleared items and prices from the previous store.');
    }
    basketStore.current = siteCode;
  }, [siteCode, basketCount, toast]);

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

  const addCombo = (offer) => {
    const next = { ...basket };
    for (const component of offer.items) {
      const current = Number(next[component.sku_id] || 0);
      const item = byId[component.sku_id];
      if (!item || current + component.quantity > item.available) {
        toast.error('Combo stock changed', `${component.name} does not have enough stock for this combo.`);
        return;
      }
      next[component.sku_id] = current + component.quantity;
    }
    setBasket(next);
    toast.success(`${offer.title} added to your basket`);
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

  /* Shared order placement — basket checkout and Buy now both go through
     here. `clearBasket` is false for Buy now: it must not touch the
     shopper's basket. */
  const placeLines = async ({ items, coupon, clearBasket, onPlaced }) => {
    if (!serviceable) {
      setRefusal(`We do not deliver to ${shop?.pincode || 'this address'} from `
        + `${shop?.name || 'this store'} yet. Choose another store or address.`);
      return;
    }
    if (!addressId) { setShowAddrPanel(true); setCartOpen(true); return; }
    if (!addr?.pincode || addr.pincode.trim() !== deliveryPincode) {
      setRefusal('Choose or add a delivery address with the same pincode used to load this store’s products.');
      setShowAddrPanel(true);
      setCartOpen(true);
      return;
    }
    setPlacing(true); setRefusal(null);
    let onlineOrderCreated = null;
    try {
      const res = await placeOrder({
        site: siteCode,
        address_id: addressId,
        items,
        payment_method: payMethod,
        coupon_code: coupon,
      });
      if (payMethod === 'CASHFREE') {
        onlineOrderCreated = res;
        const provider = res.cashfree;
        if (!res.payment_required || !provider?.payment_session_id) {
          throw new Error('Cashfree did not return a payment session. Contact support before retrying.');
        }
        // Keep the full server receipt while payment is pending. The shopper
        // may close the provider sheet and verify later, so a successful
        // delayed verification must still have its real totals and line items.
        setPendingPayment({ ...res, orderId: res.order_id, orderNo: res.order_no });
        await openCashfreeCheckout(provider.payment_session_id, provider.environment);
        const verified = await cashfreePaymentStatus(res.order_id);
        if (verified.payment_status !== 'CAPTURED') {
          if (verified.payment_status === 'FAILED') {
            setPendingPayment(null);
            setRefusal(clearBasket
              ? 'Cashfree could not complete the payment. Your basket is still here; you can try again or choose Cash on Delivery.'
              : 'Cashfree could not complete the payment. Place the order again or choose Cash on Delivery.');
          } else {
            setRefusal('Payment is still being confirmed. Check its status before placing another order.');
          }
        } else {
          if (clearBasket) { setBasket({}); setAppliedCoupon(null); }
          setPlaced({ ...res, payment_method: 'Cashfree', status: 'CONFIRMED' });
          setPendingPayment(null);
          setCartOpen(false);
          onPlaced?.();
        }
      } else {
        setPlaced(res);
        if (clearBasket) { setBasket({}); setAppliedCoupon(null); }
        setCartOpen(false);
        onPlaced?.();
      }
    } catch (e) {
      const message = onlineOrderCreated
        ? `Payment for ${onlineOrderCreated.order_no || 'your order'} did not finish. The order is saved as pending; check its status before trying again.`
        : (e.message || 'The order could not be placed.');
      setRefusal(message);
      toast.error(onlineOrderCreated ? 'Payment needs confirmation' : 'Order could not be placed', message);
    }
    setPlacing(false);
  };

  const submit = () => placeLines({
    items: lines.map((l) => ({ sku_id: l.item.sku_id, qty: l.qty })),
    coupon: appliedCoupon?.code || '',
    clearBasket: true,
  });

  const buyNow = (item, qty) => placeLines({
    items: [{ sku_id: item.sku_id, qty }],
    coupon: '',
    clearBasket: false,
    onPlaced: () => setSheetItem(null),
  });

  const refreshPendingPayment = async () => {
    if (!pendingPayment?.orderId) return;
    setPlacing(true);
    try {
      const verified = await cashfreePaymentStatus(pendingPayment.orderId);
      if (verified.payment_status === 'CAPTURED') {
        setPlaced({ ...pendingPayment, payment_method: 'Cashfree', status: 'CONFIRMED' });
        setPendingPayment(null);
        setBasket({});
        setAppliedCoupon(null);
        setCartOpen(false);
        setRefusal(null);
      } else if (verified.payment_status === 'FAILED') {
        setPendingPayment(null);
        setRefusal('Payment failed. Your basket is still here; you can try again or choose Cash on Delivery.');
      } else {
        setRefusal('Payment is still pending confirmation. Please check again shortly.');
      }
    } catch (e) {
      setRefusal(e.message || 'Could not verify payment status. Try again shortly.');
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
        geo_lat: addrDraft.geo_lat, geo_lng: addrDraft.geo_lng,
        geocode_confidence: addrDraft.geo_lat != null ? 'GPS' : null,
      });
      toast.success('Address saved');
      setAddrDraft({ label: 'Home', line1: '', city: '', pincode: '', geo_lat: null, geo_lng: null });
      setAddrGeoStatus('');
      await loadAddresses(true);
      setShowAddrPanel(false);
      window.dispatchEvent(new Event('zippzo:addresses-changed'));
      if (created?.address_id) setAddressId(created.address_id);
    } catch (e) {
      setAddrErr(e.message || 'Could not save that address.');
    }
    setAddrBusy(false);
  };

  const updateCheckoutAddress = async (action) => {
    setAddrBusy(true);
    setAddrErr('');
    try {
      await action();
      await loadAddresses(true);
    } catch (error) {
      setAddrErr(error.message || 'Could not update that address.');
    } finally {
      setAddrBusy(false);
    }
  };

  const pinCheckoutAddress = () => {
    if (!navigator.geolocation) {
      setAddrGeoStatus('Location is not available on this device.');
      return;
    }
    setAddrGeoBusy(true);
    setAddrGeoStatus('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setAddrDraft((draft) => ({ ...draft, geo_lat: coords.latitude, geo_lng: coords.longitude }));
      setAddrGeoStatus('Map pin added from this device.');
      setAddrGeoBusy(false);
    }, () => {
      setAddrGeoStatus('Could not get your location. Check permission or continue without a map pin.');
      setAddrGeoBusy(false);
    }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 12000 });
  };

  /* receipt */
  if (placed) {
    return <ReceiptScreen placed={placed} onDone={() => setPlaced(null)} />;
  }

  const addr = addresses.find((a) => a.address_id === addressId);

  /* ── cart panel (shared desktop sidebar / mobile sheet) ── */
  const cartPanel = (
    <>
      {cartOpen && (
        <div className="shop-cart-backdrop" aria-hidden="true"
          onClick={() => setCartOpen(false)} />
      )}
    <aside className={`shop-cart-panel ${cartOpen ? 'shop-cart--open' : ''}`}>
      <div className="shop-cart-panel__head">
        <h2>
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
          <ul className="shop-cart-lines" data-testid="basket-lines">
            {lines.map((l) => (
              <li key={l.item.sku_id} className="shop-cart-line" data-testid="basket-line">
                <ProductImg item={l.item} className="shop-cart-line__img" />
                <div className="shop-cart-line__body">
                  <span className="shop-cart-line__name">{l.item.name}</span>
                  <span className="shop-cart-line__unit">
                    {l.item.pack_size ? `${l.item.pack_size} · ` : ''}{rupees(l.item.price)} each
                  </span>
                </div>
                <div className="shop-cart-line__side">
                  <span className="shop-cart-line__total" data-testid="basket-line-total">
                    {rupees(Number(l.item.price) * l.qty)}
                  </span>
                  <div className="shop-step shop-step--sm">
                    <button onClick={() => dec(l.item)} aria-label="Less">
                      {l.qty === 1 ? <Trash2 size={12} /> : <Minus size={12} />}
                    </button>
                    <span className="shop-step__qty">{l.qty}</span>
                    <button onClick={() => inc(l.item)}
                      disabled={l.qty >= l.item.available} aria-label="More"><Plus size={12} /></button>
                  </div>
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
                  <span>Coupon {appliedCoupon?.code || 'savings'}</span>
                  <span className="num">−{rupees(discount)}</span>
                </div>
              )}
              {comboSavings.total > 0 && (
                <div className="shop-bill__row shop-bill__row--discount">
                  <span>Combo deals</span>
                  <span className="num">−{rupees(comboSavings.total)}</span>
                </div>
              )}
              <div className="shop-bill__row">
                <span>Handling charge</span>
                <span className="num" data-testid="basket-fee-value">
                  {feeWaived
                    ? <><s style={{ color: 'var(--shop-ink-3)', marginRight: 6 }}>{rupees(deliveryFee)}</s>FREE</>
                    : rupees(fee)}
                </span>
              </div>
              {freeAbove > 0 && !feeWaived && (
                <div style={{ fontSize: 11.5, color: 'var(--shop-ink-3)', marginTop: -2, marginBottom: 6 }}>
                  Free handling above {rupees(freeAbove)}
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
                  {subtotal < Number(appliedCoupon.min_order)
                    ? `${appliedCoupon.code} needs ${rupees(Number(appliedCoupon.min_order) - subtotal)} more`
                    : `${appliedCoupon.code} applied · −${rupees(discount)}`}
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
                  { id: 'CASHFREE', icon: Smartphone, title: 'UPI or Card', sub: 'Secure checkout by Cashfree' },
                ].map((p) => {
                  const Icon = p.icon;
                  return (
                    <button key={p.id} className="shop-choice"
                      aria-pressed={payMethod === p.id}
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

            <div className="shop-note" style={{ marginTop: 14 }}>
              <Clock size={16} />
              <span>Estimated delivery: about {shop?.promise_minutes || 10} minutes</span>
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
                      <button disabled={addrBusy} onClick={() => updateCheckoutAddress(() => setDefaultAddress(a.address_id))}>Default</button>
                        )}
                        <button disabled={addrBusy} onClick={() => updateCheckoutAddress(() => removeAddress(a.address_id))}>Remove</button>
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
                      <button type="button" className="shop-btn shop-btn--ghost" style={{ marginTop: 8 }}
                        onClick={pinCheckoutAddress} disabled={addrGeoBusy}>
                        <LocateFixed size={14} /> {addrGeoBusy ? 'Finding location…' : 'Use current location for map pin'}
                      </button>
                      {addrGeoStatus && <div role="status" className="shop-address-pin-status">{addrGeoStatus}</div>}
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

            {pendingPayment && (
              <div className="alert" style={{ marginTop: 12, fontSize: 12.5 }}>
                Payment for {pendingPayment.orderNo || 'your order'} is awaiting confirmation.
                <button className="btn btn-secondary" style={{ marginLeft: 8 }}
                  onClick={refreshPendingPayment} disabled={placing}>
                  {placing ? 'Checking…' : 'Check payment status'}
                </button>
              </div>
            )}

            {refusal && (
              <div className="alert alert-error" style={{ marginTop: 12, fontSize: 12.5 }}>
                <AlertTriangle size={14} /> {refusal}
              </div>
            )}

            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }}
              data-testid="place-order" onClick={submit}
              disabled={placing || Boolean(pendingPayment) || lines.length === 0 || !addressId || !serviceable}>
              {placing ? 'Placing…' : `Place order · ${rupees(total)}`}
            </button>
          </div>
        </>
      )}
    </aside>
    </>
  );

  /* ── main ── */
  if (sheetItem) {
    // Clicking a product opens the dedicated detail page instead of the
    // old bottom sheet — same information model as the app.
    return (
      <ProductPage
        item={sheetItem}
        qty={basket[sheetItem.sku_id] || 0}
        onAdd={add} onInc={inc} onDec={dec}
        siteName={shop?.name}
        onBack={() => setSheetItem(null)}
        onBuyNow={buyNow}
        placing={placing}
        refusal={refusal}
        clearRefusal={Boolean(refusal)}
      />
    );
  }

  return (
    <div className="view-container shop-cart-layout">
      <div className="shop-cart-main">
      <div className="shop-location-check">
        <MapPin size={18} color="var(--shop-accent)" />
        <div style={{ flex: '1 1 180px' }}>
          <strong style={{ display: 'block', fontSize: 13 }}>Delivering to</strong>
          <span style={{ fontSize: 12, color: 'var(--shop-ink-3)' }}>
            {deliveryAddress ? `${deliveryAddress.label || 'Saved address'} · ${addressPincode || 'add pincode'}` : 'Enter your pincode to check nearby dark stores'}
          </span>
        </div>
        {!addressPincode && (
          <input aria-label="Delivery pincode" inputMode="numeric" maxLength={6}
            value={manualPincode}
            onChange={(event) => setManualPincode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit pincode" className="shop-location-check__pincode" />
        )}
        {addressPincode && <button className="shop-location-check__change" onClick={() => { setShowAddrPanel(true); setCartOpen(true); }}>Change address</button>}
        {!addressPincode && <span aria-live="polite" style={{ fontSize: 12, color: 'var(--shop-ink-3)' }}>{coverageLoading ? 'Checking service area…' : coverageChecked ? `${coveredStores.length} serving store${coveredStores.length === 1 ? '' : 's'}` : 'Enter a valid 6-digit pincode'}</span>}
      </div>
      {locationError && (
        <div className="shop-location-error" role="status">{locationError}</div>
      )}
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

      {!siteCode && !coverageLoading && coverageChecked && (
        <div className="alert alert-error" role="status" style={{ marginBottom: 14 }}>
          <AlertTriangle size={16} />
          {deliveryPincode
            ? `Delivery is not available to ${deliveryPincode} yet. No products are shown because no dark store is serving this pincode.`
            : 'Add or select a delivery address with a pincode to check which dark stores can serve you.'}
        </div>
      )}

      {(shop?.banners || []).length > 0 && (
        <div className="shop-promos">
          {(shop.banners || []).map((banner) => (
            <button key={banner.sku_id} type="button" className="shop-promo"
              onClick={() => setCat(banner.subtitle || '')}>
              {banner.image ? (
                <img src={banner.image} alt="" className="shop-promo__img" />
              ) : (
                <span className="shop-promo__icon"><Tag size={20} /></span>
              )}
              <span className="shop-promo__body">
                <span className="shop-promo__title">{banner.title}</span>
                {banner.subtitle && <span className="shop-promo__sub">{banner.subtitle}</span>}
              </span>
              <ChevronRight size={16} className="shop-promo__arrow" />
            </button>
          ))}
        </div>
      )}

      {/* search lives in the top bar now (zippzo:search) */}

      {/* category rail — above the offers so the shelf is one tap away */}
      {categories.length > 1 && (
        <div className="shop-cats">
          <button className="shop-cat" aria-pressed={cat === ''} onClick={() => setCat('')}>
            <span className="shop-cat__disc shop-cat__disc--img">
              <img src="/zippzo-logo-192.png" alt="" className="shop-cat__img" />
            </span>
            <span className="shop-cat__label">All</span>
          </button>
          {categories.map(([name]) => {
            const m = catMeta(name);
            const Icon = m.Icon;
            const img = catImages[name];
            return (
              <button key={name} className="shop-cat" aria-pressed={cat === name}
                onClick={() => setCat(cat === name ? '' : name)}>
                <span className="shop-cat__disc shop-cat__disc--img">
                  {img
                    ? <img src={img} alt="" className="shop-cat__img" loading="lazy" />
                    : <Icon size={24} />}
                </span>
                <span className="shop-cat__label">{name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* offers */}
      {(coupons.length > 0 || comboOffers.length > 0) && (
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
          {comboOffers.map((offer, i) => {
            const tint = ['shop-offer--violet', 'shop-offer--green', 'shop-offer--amber'][i % 3];
            return (
              <article key={offer.offer_id} className={`shop-offer shop-combo-offer ${tint}`}>
                <span className="shop-offer__code">{offer.title}</span>
                <span className="shop-offer__desc">{offer.description
                  || offer.items.map((item) => `${item.quantity} × ${item.name}`).join(' + ')}</span>
                <div className="shop-combo-offer__products">
                  {offer.items.map((item) => (
                    <figure key={item.sku_id} className="shop-combo-offer__product">
                      <ProductImg
                        item={{ name: item.name, image: item.image, category: '' }}
                        className="shop-combo-offer__image"
                      />
                      <figcaption>{item.name}</figcaption>
                    </figure>
                  ))}
                </div>
                <span className="shop-offer__min">
                  Combo {rupees(offer.fixed_price)} · Save {rupees(offer.savings)}
                </span>
                <button type="button" className="shop-combo-offer__add" onClick={() => addCombo(offer)}>
                  Add combo
                </button>
              </article>
            );
          })}
        </div>
      )}

      {/* shelf */}
      <div className="shop-cart-shelf">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--shop-ink-3)' }}>Loading the shelf…</div>
          ) : loadError ? (
            /* A failed read is not an empty shelf. Saying "nothing on its
               shelves" here made a dropped connection look like a store
               with no stock, and nothing on the screen could retry it. */
            <div className="shop-empty-card" data-testid="storefront-error">
              <AlertTriangle size={36} />
              <div className="shop-empty-card__title">The shelf could not be loaded</div>
              <div className="shop-empty-card__sub">{loadError}</div>
              <button className="shop-empty-card__cta" onClick={() => loadShop(true)}>
                Try again
              </button>
            </div>
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
                  {list.length > 1 && (
                    <span className="shop-section__meta">{list.length} items</span>
                  )}
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
      </div>

      {cartPanel}

      {/* mobile cart bar */}
      {basketCount > 0 && !cartOpen && (
        <button className="shop-cartbar" onClick={() => setCartOpen(true)} aria-label="Open basket">
          <span className="shop-cartbar__left">
            <span className="shop-cartbar__count">{basketCount} item{basketCount === 1 ? '' : 's'} · {rupees(total)}</span>
            <span className="shop-cartbar__total">Plus delivery{freeAbove > 0 && !feeWaived ? ` · free above ${rupees(freeAbove)}` : ''}</span>
          </span>
          <span className="shop-cartbar__cta">View basket <ArrowRight size={15} /></span>
        </button>
      )}
    </div>
  );
}
