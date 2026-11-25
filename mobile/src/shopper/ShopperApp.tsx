import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, API_BASE, errMsg } from '../api';

// The product's brand mark. The JPEG in assets carries the same artwork as the
// web consoles; it is used wherever the storefront/opening screens show the
// wordmark, so the brand stays identical across apps.
const zippzoLogo = require('../assets/zippzo-logo.png');
// Operator-supplied category artwork for departments with no product photos.
const categoryArt: Record<string, any> = {
  'Fruits & Vegetables': require('../assets/categories/fruits-vegetables.jpg'),
  'Atta, Rice & Dal': require('../assets/categories/atta-rice-dal.png'),
  'Oil, Ghee & Masala': require('../assets/categories/oil-ghee-masala.png'),
  'Dairy & Eggs': require('../assets/categories/dairy-eggs.webp'),
  'Bakery': require('../assets/categories/bakery.jpg'),
  'Snacks & Munchies': require('../assets/categories/snacks-munchies.jpg'),
  'Cold Drinks & Beverages': require('../assets/categories/cold-drinks-beverages.webp'),
};
import { useAuth } from '../auth';
import { CFEnvironment, CFSession } from 'cashfree-pg-api-contract';
import { CFPaymentGatewayService } from 'react-native-cashfree-pg-sdk';
import * as Location from 'expo-location';

type Store = { code: string; name: string; delivery_fee?: string };
type Product = {
  sku_id: string; sku_code?: string; name: string; brand?: string; pack_size?: string;
  price: string; mrp?: string; available: number; image?: string; category?: string;
  rating?: number; review_count?: number;
};
type Address = {
  address_id: string; label?: string; line1: string; line2?: string;
  landmark?: string; city: string; pincode: string; is_default: boolean;
  geo_lat?: number | string | null; geo_lng?: number | string | null;
  geocode_confidence?: string | null;
};
type AddressDraft = {
  label: string; line1: string; line2: string; landmark: string;
  city: string; pincode: string;
  geo_lat: number | null; geo_lng: number | null;
};
type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Tab = 'home' | 'categories' | 'cart' | 'orders' | 'profile';
type Screen = Tab | 'listing' | 'product' | 'checkout' | 'success' | 'track'
  | 'orderDetail' | 'addresses' | 'offers' | 'notifications' | 'wishlist' | 'about';
type OrderFilter = 'ALL' | 'PROCESSING' | 'OUT' | 'DELIVERED';

const C = {
  purple: '#6d4aff',
  purpleDeep: '#5b39f0',
  purpleMid: '#8b5cf6',
  purpleSoft: '#ede9fe',
  gold: '#6d4aff',
  goldDeep: '#5b39f0',
  goldSoft: '#ede9fe',
  ink: '#18181b',
  ink2: '#52525b',
  ink3: '#a1a1aa',
  line: '#e4e4e7',
  canvas: '#ffffff',
  panel: '#f4f4f7',
  green: '#15803d',
  greenSoft: '#f0fdf4',
  bad: '#dc2626',
  badSoft: '#fdecec',
  warn: '#92400e',
  warnSoft: '#fff6e0',
};

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

const CAT_PASTELS = ['#fff6d9', '#e3f0ff', '#ffe4ec', '#ede9fe', '#f0fdf4', '#ffe9e3', '#e4e4e7'];

const CAT_STYLES: { words: string[]; icon: IconName; bg: string; fg: string }[] = [
  { words: ['beverage', 'drink', 'juice', 'water', 'coffee', 'tea', 'soda'], icon: 'cafe', bg: '#e3f0ff', fg: '#1f6fd0' },
  { words: ['snack', 'chip', 'biscuit', 'namkeen', 'chocolate', 'sweet'], icon: 'fast-food', bg: '#ffe4ec', fg: '#dc2626' },
  { words: ['personal', 'care', 'beauty', 'hygiene', 'soap', 'shampoo'], icon: 'sparkles', bg: '#ede9fe', fg: '#7b2bd6' },
  { words: ['home', 'kitchen', 'clean', 'utensil', 'detergent'], icon: 'home', bg: '#f0fdf4', fg: '#15803d' },
  { words: ['baby', 'diaper', 'infant'], icon: 'happy', bg: '#ffe9e3', fg: '#c2410c' },
  { words: ['electronic', 'mobile', 'gadget', 'appliance'], icon: 'phone-portrait', bg: '#e4e4e7', fg: '#3f3f46' },
  { words: ['fruit', 'vegetable', 'fresh', 'produce'], icon: 'leaf', bg: '#f0fdf4', fg: '#15803d' },
  { words: ['dairy', 'milk', 'egg', 'butter', 'cheese'], icon: 'water', bg: '#e3f0ff', fg: '#1f6fd0' },
  { words: ['grain', 'rice', 'atta', 'flour', 'pulse', 'dal', 'oil', 'cereal', 'breakfast'], icon: 'nutrition', bg: '#fff6d9', fg: '#92400e' },
];

function catStyle(name: string) {
  const lower = String(name || '').toLowerCase();
  const found = CAT_STYLES.find((style) => style.words.some((word) => lower.includes(word)));
  return found || { icon: 'basket' as IconName, bg: CAT_PASTELS[0], fg: C.purple };
}

function money(value: number | string) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

const MEDIA_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

function mediaUrl(url?: string | null) {
  if (!url) return '';
  if (/^(https?:|data:|file:)/i.test(url)) return url;
  return `${MEDIA_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
}

function pretty(status: string) {
  return String(status || '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initials(name: string) {
  const parts = String(name || 'Z').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || 'Z') + (parts[1]?.[0] || '')).toUpperCase();
}

/* Product image with a graceful, on-brand fallback tile. */
function Picture({ item, size, radius = 14 }: { item: Product; size: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  const uri = mediaUrl(item.image);
  const tint = catStyle(item.category || item.name);
  if (uri && !failed) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Image
          source={{ uri }}
          style={{ width: size * 0.86, height: size * 0.86 }}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={tint.icon} size={size * 0.4} color={tint.fg} />
    </View>
  );
}

const CANCELLED = ['CANCELLED', 'REFUNDED', 'EXPIRED', 'FAILED'];
const PROCESSING = ['PAYMENT_PENDING', 'PLACED', 'CONFIRMED', 'PICKING', 'PICKED', 'PACKED', 'STAGED', 'RIDER_ASSIGNED'];
const OUT_FOR_DELIVERY = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'];
const LIVE_TRACK = [...PROCESSING, ...OUT_FOR_DELIVERY];
const TRACK_STEPS = ['Order Placed', 'Preparing', 'Out for Delivery', 'Delivered'];

function stepFor(status: string) {
  if (status === 'DELIVERED') return 3;
  if (OUT_FOR_DELIVERY.includes(status)) return 2;
  if (PROCESSING.includes(status)) return 1;
  return 0;
}

export default function ShopperApp() {
  const { loading, user, login, logout } = useAuth();

  /* navigation */
  const [screen, setScreen] = useState<Screen>('home');
  const [stack, setStack] = useState<Screen[]>([]);
  const [listingTitle, setListingTitle] = useState('All Products');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('ALL');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [placedOrder, setPlacedOrder] = useState<any>(null);

  /* auth + profile */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessMode, setAccessMode] = useState<'login' | 'register' | 'reset' | 'reset-confirm'>('login');
  const [accessName, setAccessName] = useState('');
  const [accessPhone, setAccessPhone] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountLoading, setAccountLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  /* shop */
  const [pincode, setPincode] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [store, setStore] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [promiseMinutes, setPromiseMinutes] = useState(10);
  const [freeDeliveryAbove, setFreeDeliveryAbove] = useState(0);
  const [shopBanners, setShopBanners] = useState<any[]>([]);
  const [comboOffers, setComboOffers] = useState<any[]>([]);
  const [coupons, setCoupons] = useState<any[]>([]);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [couponError, setCouponError] = useState('');
  const [wishlist, setWishlist] = useState<any[]>([]);
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [cartReady, setCartReady] = useState(false);

  /* addresses + checkout */
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState('');
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressDraft, setAddressDraft] = useState<AddressDraft>({
    label: 'Home', line1: '', line2: '', landmark: '', city: '', pincode: '',
    geo_lat: null, geo_lng: null,
  });
  const [geoStatus, setGeoStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'CASHFREE'>('COD');

  /* orders */
  const [orders, setOrders] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [returnFor, setReturnFor] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const [reorderBusy, setReorderBusy] = useState('');
  const [orderDetails, setOrderDetails] = useState<Record<string, any>>({});

  const [pendingPayment, setPendingPayment] = useState<any>(null);

  /* inbox + tracking */
  const [notifications, setNotifications] = useState<any[]>([]);
  const [trackingOrderId, setTrackingOrderId] = useState('');
  const [tracking, setTracking] = useState<any>(null);
  const [trackingError, setTrackingError] = useState('');

  const loadAccount = useCallback(async () => {
    const [p, a, o, w, r] = await Promise.all([
      api.shopperProfile(), api.shopperAddresses(), api.shopperOrders(), api.shopperWishlist(), api.shopperReturns(),
    ]);
    setProfile(p);
    setName(p.name || user?.full_name || '');
    setPhone(p.phone || '');
    setAddresses(a);
    const selectedAddress = a.find((row: Address) => row.is_default) || a[0];
    setAddressId(selectedAddress?.address_id || '');
    setPincode(selectedAddress?.pincode || '');
    setOrders(o);
    setWishlist(w);
    setReturns(r);
    setPendingPayment(o.find((row: any) => row.payment_method === 'CASHFREE'
      && row.payment_status === 'PENDING' && row.status === 'PAYMENT_PENDING') || null);
  }, [user?.full_name]);

  const loadStores = useCallback(async (pin: string) => {
    if (!/^\d{6}$/.test(pin)) { setStores([]); setStore(''); setProducts([]); return; }
    const result = await api.deliveryCoverage(pin);
    const available = (result.sites || []) as Store[];
    setStores(available);
    setStore((old) => (available.some((row) => row.code === old) ? old : available[0]?.code || ''));
  }, []);

  const loadProducts = useCallback(async () => {
    if (!store || !pincode) { setProducts([]); return; }
    const data = await api.shopperStorefront(store, pincode);
    setProducts(data.items || []);
    setComboOffers(data.combo_offers || []);
    setShopBanners(data.banners || []);
    setFreeDeliveryAbove(Number(data.free_above || 0));
    if (data.promise_minutes) setPromiseMinutes(Number(data.promise_minutes));
  }, [store, pincode]);

  useEffect(() => {
    if (!user) { setProfile(null); setAccountLoading(false); return; }
    setAccountLoading(true);
    setBusy(true);
    loadAccount()
      .catch((err) => setError(errMsg(err, 'Could not load your account.')))
      .finally(() => { setBusy(false); setAccountLoading(false); });
  }, [user?.user_id, loadAccount]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const refreshInboxAndOrders = async () => {
      const [nextOrders, nextNotifications, nextReturns] = await Promise.all([
        api.shopperOrders(), api.shopperNotifications(), api.shopperReturns(),
      ]);
      if (!active) return;
      setOrders(nextOrders);
      setNotifications(nextNotifications);
      setReturns(nextReturns);
      setPendingPayment(nextOrders.find((row: any) => row.payment_method === 'CASHFREE'
        && row.payment_status === 'PENDING' && row.status === 'PAYMENT_PENDING') || null);
    };
    const timer = setInterval(() => { void refreshInboxAndOrders().catch(() => {}); }, 20000);
    return () => { active = false; clearInterval(timer); };
  }, [user?.user_id]);

  const cartKey = user?.user_id ? `zippzo:shopper-cart:${user.user_id}:${store || 'unselected'}` : '';
  useEffect(() => {
    let active = true;
    setCartReady(false);
    if (!cartKey) { setBasket({}); return () => { active = false; }; }
    setBasket({});
    AsyncStorage.getItem(cartKey).then((raw) => {
      if (active && raw) {
        try { setBasket(JSON.parse(raw)); } catch { setBasket({}); }
      }
    }).catch(() => {}).finally(() => { if (active) setCartReady(true); });
    return () => { active = false; };
  }, [cartKey]);

  useEffect(() => {
    if (!cartReady || !cartKey) return;
    AsyncStorage.setItem(cartKey, JSON.stringify(basket)).catch(() => {});
  }, [basket, cartKey, cartReady]);

  useEffect(() => {
    if (!user || !/^\d{6}$/.test(pincode)) return;
    loadStores(pincode).catch((err) => {
      setStores([]);
      setError(errMsg(err, 'Could not check delivery coverage.'));
    });
  }, [user, pincode, loadStores]);

  useEffect(() => {
    if (!store || !pincode) return;
    loadProducts().catch((err) => setError(errMsg(err, 'Could not load products.')));
  }, [store, pincode, loadProducts]);

  useEffect(() => {
    if (!products.length) return;
    setBasket((old) => {
      let changed = false;
      const next: Record<string, number> = {};
      Object.entries(old).forEach(([skuId, qty]) => {
        const item = products.find((product) => product.sku_id === skuId);
        if (!item || item.available < 1) { changed = true; return; }
        next[skuId] = Math.min(qty, item.available);
        if (next[skuId] !== qty) changed = true;
      });
      if (changed) setNotice('Your basket was updated because store stock changed. Please review the quantities.');
      return changed ? next : old;
    });
  }, [products]);

  useEffect(() => { setCategory('All'); }, [store]);

  useEffect(() => {
    if (!store) { setCoupons([]); setAppliedCoupon(null); return; }
    api.shopperCoupons(store).then(setCoupons).catch(() => setCoupons([]));
  }, [store]);

  useEffect(() => {
    if (!trackingOrderId) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const next = await api.orderTracking(trackingOrderId);
        if (active) { setTracking(next); setTrackingError(''); }
      } catch (err) {
        if (active) setTrackingError(errMsg(err, 'Could not refresh delivery location.'));
      }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); };
  }, [trackingOrderId]);

  /* navigation */
  const go = (next: Screen) => {
    setError('');
    setNotice('');
    setStack((old) => [...old, screen]);
    setScreen(next);
  };
  const back = () => {
    setError('');
    setNotice('');
    if (!stack.length) { setScreen('home'); return; }
    const next = [...stack];
    const previous = next.pop() as Screen;
    setStack(next);
    setScreen(previous);
  };
  const selectTab = (tab: Tab) => {
    setError('');
    setNotice('');
    setSearch('');
    setStack([]);
    setScreen(tab);
  };

  /* derived */
  const quantityTotal = Object.values(basket).reduce((sum, n) => sum + n, 0);
  const categories = useMemo(
    () => Array.from(new Set(products.map((item) => item.category || 'Others'))),
    [products],
  );
  const categoryCards = useMemo(
    () => categories.map((name) => {
      const rows = products.filter((item) => (item.category || 'Others') === name);
      const productImages = rows.slice(0, 4)
        .map((item) => mediaUrl(item.image))
        .filter((value): value is string => !!value);
      const art = categoryArt[name];
      const artUri = art ? Image.resolveAssetSource(art)?.uri : undefined;
      return {
        name,
        count: rows.length,
        images: productImages.length ? productImages : (artUri ? [artUri] : []),
      };
    }),
    [categories, products],
  );
  const productsFor = useCallback(
    (name: string) => products.filter((item) => (item.category || 'Others') === name),
    [products],
  );
  const basketRows = useMemo(() => products.filter((item) => basket[item.sku_id]), [products, basket]);
  const subtotal = basketRows.reduce((sum, item) => sum + Number(item.price) * basket[item.sku_id], 0);

  const comboSavings = useMemo(() => {
    const remaining: Record<string, number> = { ...basket };
    let savings = 0;
    [...comboOffers]
      .sort((a, b) => Number(b.savings) - Number(a.savings) || String(a.offer_id).localeCompare(String(b.offer_id)))
      .forEach((offer) => {
        const requirements = offer.items || [];
        if (!requirements.length) return;
        const count = Math.min(...requirements.map((item: any) =>
          Math.floor((remaining[item.sku_id] || 0) / Number(item.quantity || 1))));
        if (count <= 0) return;
        requirements.forEach((item: any) => {
          remaining[item.sku_id] -= Number(item.quantity) * count;
        });
        savings += Number(offer.savings || 0) * count;
      });
    return Math.min(savings, subtotal);
  }, [basket, comboOffers, subtotal]);

  const couponDiscount = appliedCoupon && subtotal >= Number(appliedCoupon.min_order || 0)
    ? Math.min(
      appliedCoupon.discount_type === 'FLAT'
        ? Number(appliedCoupon.discount_value)
        : subtotal * Number(appliedCoupon.discount_value) / 100,
      Number(appliedCoupon.max_discount || Number.POSITIVE_INFINITY),
      Math.max(0, subtotal - comboSavings),
    )
    : 0;
  const deliveryFee = freeDeliveryAbove > 0 && subtotal >= freeDeliveryAbove
    ? 0
    : Number(stores.find((row) => row.code === store)?.delivery_fee || 20);
  const total = Math.max(0, subtotal - comboSavings - couponDiscount) + deliveryFee;

  const currentAddress = addresses.find((row) => row.address_id === addressId) || addresses[0] || null;
  const storeName = stores.find((row) => row.code === store)?.name || store || 'your dark store';
  const unread = notifications.filter((row) => !row.read_at).length;
  const liveOrders = orders.filter((order) => !CANCELLED.includes(order.status) && order.status !== 'DELIVERED');
  const selectedOrder = orders.find((order) => order.order_id === selectedOrderId) || placedOrder;
  const savedCount = wishlist.length;

  const deals = useMemo(() => {
    const pct = (item: Product) => (Number(item.mrp) > Number(item.price)
      ? 1 - Number(item.price) / Number(item.mrp) : 0);
    return products
      .filter((item) => pct(item) > 0)
      .sort((a, b) => pct(b) - pct(a))
      .slice(0, 10);
  }, [products]);

  const visibleProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((item) => (category === 'All' || (item.category || 'Others') === category)
      && (!needle || [item.name, item.brand, item.pack_size, item.sku_code, item.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))));
  }, [products, category, search]);

  const promoImages = useMemo(() => {
    const fromBanners = shopBanners.map((banner: any) => mediaUrl(banner.image)).filter(Boolean);
    const fromProducts = products.map((item) => mediaUrl(item.image)).filter(Boolean);
    return [...fromBanners, ...fromProducts].slice(0, 2) as string[];
  }, [shopBanners, products]);

  /* cart actions */
  const setQuantity = (item: Product, qty: number) => {
    setBasket((old) => {
      const next = Math.max(0, Math.min(item.available, qty));
      const result = { ...old };
      if (next === 0) delete result[item.sku_id]; else result[item.sku_id] = next;
      return result;
    });
  };
  const updateQuantity = (item: Product, delta: number) => {
    setQuantity(item, (basket[item.sku_id] || 0) + delta);
  };
  const addToCart = (item: Product) => {
    setQuantity(item, (basket[item.sku_id] || 0) + 1);
  };
  const addCombo = (offer: any) => {
    setBasket((old) => {
      const next = { ...old };
      (offer.items || []).forEach((line: any) => {
        const item = products.find((product) => product.sku_id === line.sku_id);
        if (item) next[item.sku_id] = Math.min(item.available, (next[item.sku_id] || 0) + Number(line.quantity || 1));
      });
      return next;
    });
    selectTab('cart');
    setNotice(`${offer.title} was added to your basket.`);
  };
  const clearCart = () => Alert.alert(
    'Clear your basket?', 'All items will be removed. Coupons will be released.',
    [
      { text: 'Keep items', style: 'cancel' },
      {
        text: 'Clear basket', style: 'destructive', onPress: () => {
          setBasket({}); setAppliedCoupon(null); setCouponInput(''); setCouponError('');
        },
      },
    ],
  );

  /* account actions */
  const signIn = async () => {
    setError('');
    setBusy(true);
    try { await login(email.trim(), password); }
    catch (err) { setError(errMsg(err, 'Sign in failed.')); }
    finally { setBusy(false); }
  };

  const submitAccess = async () => {
    setError('');
    setBusy(true);
    try {
      if (accessMode === 'register') {
        await api.shopperRegister({ email: email.trim(), name: accessName.trim(), phone: accessPhone.trim(), password });
        // Email verification is removed for launch: the account is active the
        // moment it is created, so sign straight in like the web storefront.
        await login(email.trim(), password);
        setNotice('Account created — you are signed in.');
      } else if (accessMode === 'reset') {
        const result = await api.shopperPasswordReset(email.trim());
        setNotice(result.message || 'If the account exists, a reset code has been sent.');
        setAccessMode('reset-confirm');
      } else if (accessMode === 'reset-confirm') {
        await api.shopperPasswordResetConfirm(email.trim(), accessCode.trim(), password);
        setNotice('Password changed. Sign in with your new password.');
        setAccessMode('login');
        setAccessCode('');
        setPassword('');
      }
    } catch (err) { setError(errMsg(err, 'Could not complete this account request.')); }
    finally { setBusy(false); }
  };

  const saveProfile = async () => {
    setError('');
    setBusy(true);
    try {
      const next = await api.updateShopperProfile({ name: name.trim(), phone: phone.trim() });
      setProfile(next);
      setEditingProfile(false);
      setNotice('Your profile was saved.');
    } catch (err) { setError(errMsg(err, 'Could not save your profile.')); }
    finally { setBusy(false); }
  };

  // The web storefront offers the same GPS pin. Nothing is sent until the
  // shopper saves the address, and permission is only asked on this tap.
  const pinAddress = async () => {
    setError('');
    setGeoStatus('');
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setGeoStatus('Location permission is off. Enable it in phone settings to add a pin.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setAddressDraft((old) => ({
        ...old,
        geo_lat: pos.coords.latitude,
        geo_lng: pos.coords.longitude,
      }));
      setGeoStatus('Map pin added from this device. Save the address to keep it.');
    } catch (err) {
      setGeoStatus(errMsg(err, 'Could not get your location. You can still save without a pin.'));
    } finally { setLocating(false); }
  };

  const saveAddress = async () => {
    setError('');
    setBusy(true);
    try {
      const saved = await api.createShopperAddress({
        ...addressDraft,
        pincode: addressDraft.pincode.trim(),
        geocode_confidence: addressDraft.geo_lat != null ? 'GPS' : null,
        is_default: addresses.length === 0,
      });
      setAddresses((old) => [saved, ...old]);
      setAddressId(saved.address_id);
      setPincode(saved.pincode);
      setShowAddressForm(false);
      setAddressDraft({
        label: 'Home', line1: '', line2: '', landmark: '', city: '', pincode: saved.pincode,
        geo_lat: null, geo_lng: null,
      });
      setGeoStatus('');
      setNotice('Your delivery address was saved.');
    } catch (err) { setError(errMsg(err, 'Could not save this address.')); }
    finally { setBusy(false); }
  };

  const makeDefaultAddress = async (address: Address) => {
    setBusy(true);
    setError('');
    try {
      await api.updateShopperAddress(address.address_id, { is_default: true });
      setAddresses((old) => old.map((row) => ({ ...row, is_default: row.address_id === address.address_id })));
      setAddressId(address.address_id);
      setPincode(address.pincode);
    } catch (err) { setError(errMsg(err, 'Could not update the default address.')); }
    finally { setBusy(false); }
  };

  const deleteAddress = (address: Address) => Alert.alert(
    'Remove this address?', 'An address used by an order may not be removable.',
    [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: () => {
          api.removeShopperAddress(address.address_id).then(async () => {
            const remaining = addresses.filter((row) => row.address_id !== address.address_id);
            let next = remaining.find((row) => row.is_default) || remaining[0];
            if (address.is_default && next && !next.is_default) {
              await api.updateShopperAddress(next.address_id, { is_default: true });
              next = { ...next, is_default: true };
            }
            setAddresses(remaining.map((row) => ({ ...row, is_default: row.address_id === next?.address_id })));
            if (addressId === address.address_id) {
              setAddressId(next?.address_id || '');
              setPincode(next?.pincode || '');
            }
          }).catch((err) => setError(errMsg(err, 'This address could not be removed.')));
        },
      },
    ],
  );

  /* wishlist + coupons */
  const toggleWishlist = async (item: Product) => {
    const existing = wishlist.find((row) => row.sku === item.sku_id || row.sku_detail?.sku_id === item.sku_id);
    try {
      if (existing) {
        await api.removeWishlist(existing.wishlist_id);
        setWishlist((old) => old.filter((row) => row.wishlist_id !== existing.wishlist_id));
      } else {
        const saved = await api.addWishlist(item.sku_id);
        setWishlist((old) => [saved, ...old]);
      }
    } catch (err) { setError(errMsg(err, 'Could not update your saved products.')); }
  };

  const isSaved = (item: Product) =>
    wishlist.some((row) => row.sku === item.sku_id || row.sku_detail?.sku_id === item.sku_id);

  const applyCoupon = () => {
    const found = coupons.find((coupon) => coupon.code.toUpperCase() === couponInput.trim().toUpperCase());
    if (!found) { setCouponError('That coupon is not available for this store.'); return; }
    if (subtotal < Number(found.min_order || 0)) {
      setCouponError(`Add ${money(Number(found.min_order) - subtotal)} more to use this coupon.`);
      return;
    }
    setAppliedCoupon(found);
    setCouponInput(found.code);
    setCouponError('');
  };

  const applyCouponFromOffer = (coupon: any) => {
    if (subtotal < Number(coupon.min_order || 0)) {
      Alert.alert('Basket too small', `Add ${money(Number(coupon.min_order) - subtotal)} more to use ${coupon.code}.`);
      return;
    }
    setAppliedCoupon(coupon);
    setCouponInput(coupon.code);
    setCouponError('');
    selectTab('cart');
    setNotice(`Coupon ${coupon.code} applied.`);
  };

  /* checkout + payments */
  const payWithCashfree = (payment: any, orderId: string): Promise<void> => new Promise((resolve, reject) => {
    try {
      CFPaymentGatewayService.setCallback({
        onVerify: () => resolve(),
        onError: (err: any) => reject(new Error(err?.message || 'Payment was not completed.')),
      });
      const environment = payment.environment === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
      const session = new CFSession(payment.payment_session_id, payment.order_id, environment);
      CFPaymentGatewayService.doWebPayment(session);
      void orderId;
    } catch (err) { reject(err); }
  });

  const refreshOrdersQuietly = async () => {
    try {
      const next = await api.shopperOrders();
      setOrders(next);
      setPendingPayment(next.find((row: any) => row.payment_method === 'CASHFREE'
        && row.payment_status === 'PENDING' && row.status === 'PAYMENT_PENDING') || null);
    } catch {
      // Refreshing the list is not part of checkout: the order is already placed.
    }
  };

  const placeOrder = async (overrideItems?: { sku_id: string; qty: number }[]) => {
    setError('');
    setNotice('');
    if (!currentAddress) { setError('Add a delivery address before placing the order.'); return; }
    const orderItems = overrideItems ?? basketRows.map((item) => ({ sku_id: item.sku_id, qty: basket[item.sku_id] }));
    const totalItems = overrideItems ? orderItems.reduce((sum, item) => sum + item.qty, 0) : quantityTotal;
    if (!totalItems) { setError('Your basket is empty.'); return; }
    const coupon = overrideItems ? '' : appliedCoupon?.code || '';
    setBusy(true);
    try {
      const response = await api.placeShopperOrder({
        site: store,
        address_id: currentAddress.address_id,
        payment_method: paymentMethod,
        coupon_code: coupon,
        items: orderItems,
      });
      // A cart order puts the customer back on the storefront; a Buy Now order
      // never touched their basket.
      if (!overrideItems) {
        setBasket({});
        setAppliedCoupon(null);
        setCouponInput('');
      }
      if (paymentMethod === 'CASHFREE') {
        setPendingPayment({
          order_id: response.order_id, order_no: response.order_no,
          payment_method: 'CASHFREE', payment_status: 'PENDING', status: 'PAYMENT_PENDING',
        });
        try {
          await payWithCashfree(response.cashfree, response.order_id);
        } catch {
          await refreshOrdersQuietly();
          selectTab('orders');
          setNotice(`Payment was not completed. Order ${response.order_no} is saved — check it in My Orders.`);
          return;
        }
        let verified: any;
        try {
          verified = await api.paymentStatus(response.order_id);
        } catch {
          await refreshOrdersQuietly();
          selectTab('orders');
          setNotice(`Order ${response.order_no} was placed. We could not confirm the payment yet; check My Orders in a moment.`);
          return;
        }
        if (verified.payment_status !== 'CAPTURED') {
          await refreshOrdersQuietly();
          selectTab('orders');
          setNotice(`Payment is ${String(verified.attempt_status || 'processing').toLowerCase()}. Check My Orders before trying again.`);
        } else {
          setPendingPayment(null);
          setPlacedOrder({
            order_id: response.order_id, order_no: verified.order_no || response.order_no,
            grand_total: verified.grand_total || response.grand_total, promise_minutes: promiseMinutes,
            status: 'PLACED', payment_method: 'CASHFREE', payment_status: 'CAPTURED',
            total_items: totalItems,
          });
          setScreen('success');
          setStack([]);
          await refreshOrdersQuietly();
        }
      } else {
        setPlacedOrder({
          order_id: response.order_id, order_no: response.order_no,
          grand_total: response.grand_total, promise_minutes: promiseMinutes,
          status: 'PLACED', payment_method: 'COD', payment_status: 'PENDING',
          total_items: totalItems,
        });
        setScreen('success');
        setStack([]);
        await refreshOrdersQuietly();
      }
    } catch (err) {
      setError(errMsg(err, 'Checkout could not be completed.'));
    } finally { setBusy(false); }
  };

  const buyNow = async (item: Product, qty = 1) => {
    setError('');
    if (!currentAddress) { setError('Add a delivery address before buying.'); go('addresses'); return; }
    await placeOrder([{ sku_id: item.sku_id, qty }]);
  };

  const checkPayment = async (orderId: string) => {
    setBusy(true);
    setError('');
    try {
      const status = await api.paymentStatus(orderId);
      setNotice(status.payment_status === 'CAPTURED'
        ? `Payment confirmed for ${status.order_no}.`
        : `Payment status: ${status.attempt_status}.`);
      if (status.payment_status === 'CAPTURED') setPendingPayment(null);
      if (status.payment_status === 'FAILED') setPendingPayment(null);
      setOrders(await api.shopperOrders());
    } catch (err) { setError(errMsg(err, 'Could not verify payment status.')); }
    finally { setBusy(false); }
  };

  /* orders */
  const loadOrderDetails = useCallback(async (orderId: string) => {
    try {
      const [lines, history] = await Promise.all([
        api.shopperOrderLines(orderId), api.shopperOrderHistory(orderId),
      ]);
      setOrderDetails((old) => ({ ...old, [orderId]: { lines, history } }));
    } catch (err) { setError(errMsg(err, 'Could not load order details.')); }
  }, []);

  const openOrder = (order: any) => {
    setSelectedOrderId(order.order_id);
    go('orderDetail');
    if (!orderDetails[order.order_id]) void loadOrderDetails(order.order_id);
  };

  const openTrack = (order: any) => {
    setSelectedOrderId(order.order_id);
    setTrackingOrderId(order.order_id);
    setTracking(null);
    setTrackingError('');
    go('track');
  };



  const submitReturn = async (orderId: string) => {
    if (!returnReason.trim()) { setError('Tell us what went wrong before requesting a return.'); return; }
    setBusy(true);
    setError('');
    try {
      await api.requestShopperReturn(orderId, returnReason.trim());
      setReturns(await api.shopperReturns());
      setReturnFor('');
      setReturnReason('');
      setNotice('Your return request was sent.');
    } catch (err) { setError(errMsg(err, 'This return request could not be submitted.')); }
    finally { setBusy(false); }
  };

  const reorder = async (orderId: string) => {
    setReorderBusy(orderId);
    setError('');
    try {
      const lines = await api.shopperOrderLines(orderId);
      const next = { ...basket };
      let added = 0;
      lines.forEach((line: any) => {
        const item = products.find((product) => product.sku_id === line.sku);
        if (!item || item.available < 1) return;
        next[item.sku_id] = Math.min(item.available, (next[item.sku_id] || 0) + Number(line.qty));
        added += 1;
      });
      setBasket(next);
      selectTab('cart');
      setNotice(added
        ? `${added} available product(s) were added to your basket.`
        : 'No products from this order are available at your selected store.');
    } catch (err) { setError(errMsg(err, 'Could not reorder this purchase.')); }
    finally { setReorderBusy(''); }
  };

  const cancelOrder = (order: any) => Alert.alert(
    'Cancel this order?', 'This is available only before store picking begins.',
    [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Cancel order', style: 'destructive', onPress: () => {
          setBusy(true);
          api.cancelShopperOrder(order.order_id).then(async () => {
            setNotice(`Order ${order.order_no} was cancelled.`);
            setOrders(await api.shopperOrders());
          }).catch((err) => setError(errMsg(err, 'This order can no longer be cancelled.')))
            .finally(() => setBusy(false));
        },
      },
    ],
  );

  /* notifications */
  const markNotificationRead = async (notification: any) => {
    try {
      await api.markShopperNotificationRead(notification.notification_id);
      setNotifications((old) => old.map((row) => (row.notification_id === notification.notification_id
        ? { ...row, read_at: new Date().toISOString() } : row)));
    } catch (err) { setError(errMsg(err, 'Could not update your notifications.')); }
  };

  const markAllNotificationsRead = async () => {
    try {
      await api.markAllShopperNotificationsRead();
      setNotifications((old) => old.map((row) => ({ ...row, read_at: row.read_at || new Date().toISOString() })));
    } catch (err) { setError(errMsg(err, 'Could not update your notifications.')); }
  };

  const filteredOrders = useMemo(() => {
    if (orderFilter === 'PROCESSING') return orders.filter((order) => PROCESSING.includes(order.status));
    if (orderFilter === 'OUT') return orders.filter((order) => OUT_FOR_DELIVERY.includes(order.status));
    if (orderFilter === 'DELIVERED') return orders.filter((order) => order.status === 'DELIVERED');
    return orders;
  }, [orders, orderFilter]);

  /* splash / auth / guards */
  if (loading || (user && accountLoading)) {
    return (
      <SafeAreaView style={s.splash}>
        <StatusBar barStyle="light-content" />
        <View style={s.splashGlow} />
        <View style={s.splashGlow2} />
        <View style={s.splashCenter}>
          <Image source={zippzoLogo} style={s.splashLogoImg} resizeMode="contain" accessibilityLabel="Zippzo" />
        </View>
        <View style={s.splashFoot}>
          <ActivityIndicator color={C.gold} />
          <Text style={s.splashLoading}>Loading your store…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    const title = accessMode === 'login' ? 'Welcome back'
      : accessMode === 'register' ? 'Create your account'
        : accessMode === 'reset' ? 'Reset your password' : 'Choose a new password';
    const subtitle = accessMode === 'login'
      ? 'Groceries and daily essentials, delivered to your door in minutes.'
      : accessMode === 'register'
        ? 'One step — your account is live the moment you submit.'
        : accessMode === 'reset'
          ? 'We will email a six-digit code if the account exists.'
          : 'Enter the code from your email and pick a new password.';
    return (
      <SafeAreaView style={s.splash}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={s.authBrand}>
              <Image source={zippzoLogo} style={s.authLogoImg} resizeMode="contain" accessibilityLabel="Zippzo" />
            </View>

            <View style={s.authCard}>
              <Text style={s.authTitle}>{title}</Text>
              <Text style={s.authSub}>{subtitle}</Text>

              {accessMode === 'register' && (
                <>
                  <Text style={s.fieldLabel}>Full name</Text>
                  <TextInput style={s.input} placeholder="Your name" placeholderTextColor={C.ink3}
                    value={accessName} onChangeText={setAccessName} />
                  <Text style={s.fieldLabel}>Mobile number</Text>
                  <TextInput style={s.input} placeholder="10-digit mobile number" placeholderTextColor={C.ink3}
                    keyboardType="phone-pad" value={accessPhone} onChangeText={setAccessPhone} />
                </>
              )}

              <Text style={s.fieldLabel}>Email</Text>
              <TextInput style={s.input} placeholder="you@example.com" placeholderTextColor={C.ink3}
                autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />

              {['login', 'register', 'reset-confirm'].includes(accessMode) && (
                <>
                  <Text style={s.fieldLabel}>{accessMode === 'login' ? 'Password' : 'New password'}</Text>
                  <TextInput style={s.input} placeholder="At least 12 characters" placeholderTextColor={C.ink3}
                    secureTextEntry value={password} onChangeText={setPassword} />
                </>
              )}

              {accessMode === 'reset-confirm' && (
                <>
                  <Text style={s.fieldLabel}>Email code</Text>
                  <TextInput style={s.input} placeholder="6-digit code" placeholderTextColor={C.ink3}
                    keyboardType="number-pad" maxLength={6} value={accessCode} onChangeText={setAccessCode} />
                </>
              )}

              {!!error && <Text style={s.error}>{error}</Text>}
              {!!notice && <Text style={s.success}>{notice}</Text>}

              <TouchableOpacity style={[s.goldBtn, busy && s.btnDisabled]} disabled={busy}
                onPress={accessMode === 'login' ? signIn : submitAccess}>
                <Text style={s.goldBtnText}>
                  {busy ? 'Please wait…' : accessMode === 'login' ? 'Sign in'
                    : accessMode === 'register' ? 'Create account'
                      : accessMode === 'reset' ? 'Send reset code' : 'Change password'}
                </Text>
              </TouchableOpacity>

              {accessMode === 'login' ? (
                <View style={s.authLinks}>
                  <TouchableOpacity onPress={() => { setAccessMode('register'); setError(''); setNotice(''); }}>
                    <Text style={s.authLink}>Create account</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { setAccessMode('reset'); setError(''); setNotice(''); }}>
                    <Text style={s.authLink}>Forgot password?</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={s.authBack} onPress={() => { setAccessMode('login'); setError(''); setNotice(''); }}>
                  <Ionicons name="chevron-back" size={15} color={C.purple} />
                  <Text style={s.authLink}>Back to sign in</Text>
                </TouchableOpacity>
              )}
              <Text style={s.authHint}>Shopper accounts only. Staff consoles use their own sign-in.</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (!['CUSTOMER', 'SENDER'].includes(user.role)) {
    return (
      <SafeAreaView style={s.splash}>
        <StatusBar barStyle="light-content" />
        <View style={s.guardWrap}>
          <View style={s.guardCard}>
            <View style={s.guardIcon}><Ionicons name="basket-outline" size={30} color={C.purple} /></View>
            <Text style={s.authTitle}>Shopper account required</Text>
            <Text style={s.authSub}>This app is for customer accounts. Sign in with a shopper account to continue.</Text>
            <TouchableOpacity style={s.goldBtn} onPress={() => logout()}>
              <Text style={s.goldBtnText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={s.splash}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={s.authScroll} keyboardShouldPersistTaps="handled">
            <View style={s.authBrand}>
              <Image source={zippzoLogo} style={s.authLogoImg} resizeMode="contain" accessibilityLabel="Zippzo" />
            </View>
            <View style={s.authCard}>
              <Text style={s.authTitle}>Your shopper profile</Text>
              <Text style={s.authSub}>Add your name and mobile number to continue. Cashfree uses this number for payment.</Text>
              <Text style={s.fieldLabel}>Full name</Text>
              <TextInput style={s.input} placeholder="Your name" placeholderTextColor={C.ink3}
                value={name} onChangeText={setName} />
              <Text style={s.fieldLabel}>Mobile number</Text>
              <TextInput style={s.input} placeholder="10-digit mobile number" placeholderTextColor={C.ink3}
                keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
              {!!error && <Text style={s.error}>{error}</Text>}
              <TouchableOpacity style={[s.goldBtn, busy && s.btnDisabled]} onPress={saveProfile} disabled={busy}>
                <Text style={s.goldBtnText}>{busy ? 'Saving…' : 'Save and continue'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.authBack} onPress={() => logout()}>
                <Text style={s.authLink}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  /* shared UI */
  const header = (title: string, opts: { back?: boolean; right?: React.ReactNode; children?: React.ReactNode } = {}) => (
    <View style={s.header}>
      <View style={s.headerRow}>
        {opts.back && (
          <TouchableOpacity style={s.headerBtn} onPress={back} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={22} color={C.purple} />
          </TouchableOpacity>
        )}
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        {opts.right}
      </View>
      {opts.children}
    </View>
  );

  const searchField = (placeholder: string, onSubmit?: () => void) => (
    <View style={s.searchBox}>
      <Ionicons name="search-outline" size={18} color={C.ink3} />
      <TextInput
        style={s.searchInput}
        placeholder={placeholder}
        placeholderTextColor={C.ink3}
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
      />
      {!!search && (
        <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close-circle" size={17} color={C.ink3} />
        </TouchableOpacity>
      )}
    </View>
  );

  const picture = (item: Product, size: number) => <Picture item={item} size={size} />;

  const discountPct = (item: Product) => (Number(item.mrp) > Number(item.price)
    ? Math.round((1 - Number(item.price) / Number(item.mrp)) * 100)
    : 0);

  const quantityStep = (item: Product, qty: number, small = false) => (
    <View style={[s.step, small && s.stepSm]}>
      <TouchableOpacity style={s.stepBtn} onPress={() => updateQuantity(item, -1)}
        accessibilityLabel={`Remove one ${item.name}`}>
        <Text style={s.stepBtnText}>{qty === 1 ? '×' : '−'}</Text>
      </TouchableOpacity>
      <Text style={s.stepQty}>{qty}</Text>
      <TouchableOpacity style={s.stepBtn} disabled={qty >= item.available}
        onPress={() => updateQuantity(item, 1)} accessibilityLabel={`Add one ${item.name}`}>
        <Text style={s.stepBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );

  const addControl = (item: Product, small = false) => {
    const qty = basket[item.sku_id] || 0;
    if (qty > 0) return quantityStep(item, qty, small);
    return (
      <TouchableOpacity style={[s.addPill, small && s.addPillSm]} disabled={item.available < 1}
        onPress={() => addToCart(item)} accessibilityLabel={`Add ${item.name} to basket`}>
        <Text style={s.addPillText}>ADD</Text>
      </TouchableOpacity>
    );
  };

  const productRow = (item: Product) => {
    const pct = discountPct(item);
    return (
      <View key={item.sku_id} style={s.rowCard}>
        <TouchableOpacity style={s.rowTap} activeOpacity={0.85}
          onPress={() => { setSelectedProduct(item); go('product'); }}>
          <View style={s.rowImg}>{picture(item, 62)}</View>
          <View style={s.rowBody}>
            <Text style={s.rowName} numberOfLines={2}>{item.name}</Text>
            <View style={s.rowPriceLine}>
              <Text style={s.priceText}>{money(item.price)}</Text>
              {pct > 0 && <Text style={s.mrpText}>{money(item.mrp || 0)}</Text>}
              {pct > 0 && <Text style={s.offText}>{pct}% OFF</Text>}
            </View>
          </View>
          <TouchableOpacity style={[s.addPill, s.addPillList]} disabled={item.available < 1}
            onPress={() => addToCart(item)} accessibilityLabel={`Add ${item.name} to basket`}>
            <Text style={s.addPillText}>Add</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  };

  const productCard = (item: Product) => {
    const pct = discountPct(item);
    const qty = basket[item.sku_id] || 0;
    return (
      <View key={item.sku_id} style={s.gridCard}>
        <TouchableOpacity activeOpacity={0.9} onPress={() => { setSelectedProduct(item); go('product'); }}>
          <View style={s.gridImg}>
            {picture(item, 116)}
            {pct > 0 && <View style={s.gridOff}><Text style={s.gridOffText}>{pct}% OFF</Text></View>}
            {item.available < 1 && (
              <View style={s.gridSoldOut}><Text style={s.gridSoldOutText}>SOLD OUT</Text></View>
            )}
          </View>
          <View style={s.gridEta}>
            <Ionicons name="flash" size={9} color={C.purple} />
            <Text style={s.gridEtaText}>{promiseMinutes} MIN</Text>
          </View>
          <Text style={s.gridName} numberOfLines={2}>{item.name}</Text>
          <Text style={s.gridPack} numberOfLines={1}>{item.pack_size || item.brand || 'Each'}</Text>
        </TouchableOpacity>
        <View style={s.gridFoot}>
          <View style={s.gridPriceCol}>
            <Text style={s.gridPrice}>{money(item.price)}</Text>
            {pct > 0 && <Text style={s.gridMrp}>{money(item.mrp || 0)}</Text>}
          </View>
          {qty > 0 ? quantityStep(item, qty, true) : (
            <TouchableOpacity
              style={[s.gridAdd, item.available < 1 && s.btnDisabled]}
              disabled={item.available < 1}
              onPress={() => addToCart(item)}
              accessibilityLabel={`Add ${item.name} to basket`}
            >
              <Ionicons name="add" size={16} color={C.ink} />
              <Text style={s.gridAddText}>ADD</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const dealCard = (item: Product) => {
    const pct = discountPct(item);
    return (
      <TouchableOpacity key={item.sku_id} style={s.dealCard} activeOpacity={0.85}
        onPress={() => { setSelectedProduct(item); go('product'); }}>
        <View style={s.dealImg}>
          {picture(item, 84)}
          {pct > 0 && <View style={s.dealOff}><Text style={s.dealOffText}>{pct}% OFF</Text></View>}
        </View>
        <Text style={s.dealName} numberOfLines={2}>{item.name}</Text>
        <View style={s.dealPriceRow}>
          <Text style={s.dealPrice}>{money(item.price)}</Text>
          {pct > 0 && <Text style={s.dealMrp}>{money(item.mrp || 0)}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  const sectionHead = (title: string, onViewAll?: () => void) => (
    <View style={s.sectionHead}>
      <Text style={s.sectionTitle}>{title}</Text>
      {onViewAll && (
        <TouchableOpacity onPress={onViewAll} style={s.viewAllBtn}>
          <Text style={s.viewAllText}>View All</Text>
          <Ionicons name="chevron-forward" size={13} color={C.purple} />
        </TouchableOpacity>
      )}
    </View>
  );

  const timeline = (status: string) => {
    const active = stepFor(status);
    return (
      <View style={s.timeline}>
        {TRACK_STEPS.map((label, index) => (
          <View key={label} style={s.timelineStep}>
            <View style={s.timelineRow}>
              <View style={[s.timelineConnector, index === 0 && s.timelineConnectorHidden, index > 0 && index <= active && s.timelineConnectorOn]} />
              <View style={[s.timelineDot, index <= active && s.timelineDotOn]}>
                {index < active
                  ? <Ionicons name="checkmark" size={11} color={C.purple} />
                  : index === active ? <View style={s.timelineDotCore} /> : null}
              </View>
              <View style={[s.timelineConnector, index === TRACK_STEPS.length - 1 && s.timelineConnectorHidden, index < active && s.timelineConnectorOn]} />
            </View>
            <Text style={[s.timelineLabel, index <= active && s.timelineLabelOn]} numberOfLines={2}>{label}</Text>
          </View>
        ))}
      </View>
    );
  };

  const menuRow = (icon: IconName, label: string, onPress: () => void, opts: { badge?: number; danger?: boolean } = {}) => (
    <TouchableOpacity style={s.menuRow} onPress={onPress}>
      <View style={[s.menuIcon, opts.danger && s.menuIconDanger]}>
        <Ionicons name={icon} size={18} color={opts.danger ? C.bad : C.purple} />
      </View>
      <Text style={[s.menuLabel, opts.danger && { color: C.bad }]}>{label}</Text>
      {!!opts.badge && <View style={s.menuBadge}><Text style={s.menuBadgeText}>{opts.badge > 9 ? '9+' : opts.badge}</Text></View>}
      {!opts.danger && <Ionicons name="chevron-forward" size={16} color={C.ink3} />}
    </TouchableOpacity>
  );

  const feedback = () => (
    <>
      {!!error && <View style={[s.banner, s.bannerBad]}><Text style={s.bannerBadText}>{error}</Text></View>}
      {!!notice && <View style={[s.banner, s.bannerOk]}><Text style={s.bannerOkText}>{notice}</Text></View>}
    </>
  );

  const emptyState = (icon: IconName, title: string, text: string, ctaLabel?: string, onPress?: () => void) => (
    <View style={s.emptyCard}>
      <View style={s.emptyIcon}><Ionicons name={icon} size={30} color={C.purple} /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
      {ctaLabel && onPress && (
        <TouchableOpacity style={s.goldBtn} onPress={onPress}>
          <Text style={s.goldBtnText}>{ctaLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const billCard = () => (
    <View style={s.billCard}>
      <Text style={s.blockTitle}>Bill Details</Text>
      <View style={s.billRow}><Text style={s.billLabel}>Item total</Text><Text style={s.billValue}>{money(subtotal)}</Text></View>
      {comboSavings > 0 && (
        <View style={s.billRow}><Text style={s.billLabel}>Combo savings</Text><Text style={s.billGood}>− {money(comboSavings)}</Text></View>
      )}
      {couponDiscount > 0 && (
        <View style={s.billRow}>
          <Text style={s.billLabel}>Coupon {appliedCoupon?.code || ''}</Text>
          <Text style={s.billGood}>− {money(couponDiscount)}</Text>
        </View>
      )}
      <View style={s.billRow}>
        <Text style={s.billLabel}>Delivery fee</Text>
        <Text style={deliveryFee === 0 ? s.billGood : s.billValue}>{deliveryFee === 0 ? 'FREE' : money(deliveryFee)}</Text>
      </View>
      <View style={s.billDivider} />
      <View style={s.billRow}><Text style={s.billTotalLabel}>Total</Text><Text style={s.billTotal}>{money(total)}</Text></View>
      {deliveryFee === 0 && (
        <View style={s.freeNote}>
          <Ionicons name="checkmark-circle" size={13} color={C.green} />
          <Text style={s.freeNoteText}>Free delivery on this order</Text>
        </View>
      )}
    </View>
  );

  const couponBox = () => (
    <View style={s.couponCard}>
      <View style={s.couponHead}>
        <Ionicons name="pricetag-outline" size={16} color={C.purple} />
        <Text style={s.couponTitle}>Coupons &amp; offers</Text>
      </View>
      {appliedCoupon ? (
        <View style={s.couponApplied}>
          <View style={{ flex: 1 }}>
            <Text style={s.couponAppliedCode}>{appliedCoupon.code} applied</Text>
            <Text style={s.couponAppliedSub}>You saved {money(couponDiscount)}</Text>
          </View>
          <TouchableOpacity onPress={() => { setAppliedCoupon(null); setCouponInput(''); setCouponError(''); }}>
            <Text style={s.removeLink}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.couponRow}>
          <TextInput
            style={s.couponInput}
            placeholder="Enter coupon code"
            placeholderTextColor={C.ink3}
            autoCapitalize="characters"
            value={couponInput}
            onChangeText={(value) => { setCouponInput(value); setCouponError(''); }}
          />
          <TouchableOpacity style={s.couponApply} onPress={applyCoupon}>
            <Text style={s.couponApplyText}>Apply</Text>
          </TouchableOpacity>
        </View>
      )}
      {!!couponError && <Text style={s.error}>{couponError}</Text>}
      {!appliedCoupon && coupons.length > 0 && (
        <TouchableOpacity style={s.couponBrowse} onPress={() => go('offers')}>
          <Text style={s.couponBrowseText}>{coupons.length} coupon{coupons.length === 1 ? '' : 's'} available for this store</Text>
          <Ionicons name="chevron-forward" size={13} color={C.purple} />
        </TouchableOpacity>
      )}
    </View>
  );

  /* home */
  const homeScreen = (
    <View style={s.screen}>
      <View style={s.homeHeader}>
        <View style={s.headerRow}>
          <View style={s.brandLockup}>
            <View style={s.brandLine}>
              <Image source={zippzoLogo} style={s.brandMarkImg} resizeMode="contain" accessibilityLabel="Zippzo" />
              <View style={s.brandTagPill}>
                <Text style={s.brandTagPillText}>{promiseMinutes} MIN</Text>
              </View>
            </View>
          </View>
          <TouchableOpacity style={s.headerBtn} onPress={() => go('notifications')} accessibilityLabel="Notifications">
            <Ionicons name="notifications-outline" size={20} color={C.purple} />
            {unread > 0 && <View style={s.bellDot} />}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={s.locationRow} onPress={() => go('addresses')} activeOpacity={0.8}>
          <View style={s.locationPin}><Ionicons name="location" size={15} color={C.purple} /></View>
          <View style={s.locationBody}>
            <Text style={s.locationKicker}>DELIVERING TO</Text>
            <View style={s.locationValueRow}>
              <Text style={s.locationValue} numberOfLines={1}>
                {currentAddress
                  ? `${currentAddress.label || 'Home'} · ${currentAddress.line1}, ${currentAddress.pincode}`
                  : 'Add your delivery address'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={C.ink2} />
            </View>
          </View>
        </TouchableOpacity>

        {searchField('Search for products, brands…', () => {
          setCategory('All');
          setListingTitle(search.trim() ? `Search: ${search.trim()}` : 'All Products');
          go('listing');
        })}
      </View>

      <ScrollView
        contentContainerStyle={s.homePage}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {feedback()}

        {!currentAddress && (
          <View style={s.card}>
            <Text style={s.blockTitle}>Where should we deliver?</Text>
            <Text style={s.blockSub}>Enter your area pincode to see what is stocked nearby.</Text>
            <TextInput
              style={s.input}
              placeholder="6-digit pincode"
              placeholderTextColor={C.ink3}
              keyboardType="number-pad"
              maxLength={6}
              value={pincode}
              onChangeText={setPincode}
            />
            {pincode.length === 6 && stores.length === 0 && (
              <Text style={s.error}>No active dark store serves this pincode yet.</Text>
            )}
            <TouchableOpacity
              style={s.purpleBtn}
              onPress={() => {
                setAddressDraft((old) => ({ ...old, pincode: /^\d{6}$/.test(pincode) ? pincode : old.pincode }));
                setShowAddressForm(true);
                go('addresses');
              }}
            >
              <Text style={s.purpleBtnText}>Add delivery address</Text>
            </TouchableOpacity>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRail}>
          {([
            ['Beauty', 'sparkles'], ['Gifting', 'gift'], ['Decor', 'cube'],
            ['Kids', 'happy'], ['Imported', 'cart-outline'],
          ] as Array<[string, string]>).map(([label, icon]) => (
            <TouchableOpacity
              key={label}
              style={s.quickChip}
              onPress={() => { setCategory('All'); setListingTitle(label); go('listing'); }}
            >
              <Ionicons name={icon as any} size={16} color={C.ink2} />
              <Text style={s.quickChipText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={s.promo}>
          <View style={s.promoBody}>
            <View style={s.promoPill}>
              <Ionicons name="time-outline" size={11} color={C.purple} />
              <Text style={s.promoPillText}>{promiseMinutes} Min Delivery</Text>
            </View>
            <Text style={s.promoTitle}>Groceries &amp; Essentials{'\n'}Delivered in Minutes</Text>
            <TouchableOpacity
              style={s.promoBtn}
              onPress={() => { setCategory('All'); setListingTitle('All Products'); go('listing'); }}
            >
              <Text style={s.promoBtnText}>Shop Now</Text>
              <Ionicons name="arrow-forward" size={13} color={C.ink} />
            </TouchableOpacity>
          </View>
          <View style={s.promoArt}>
            {promoImages[0] && (
              <Image source={{ uri: promoImages[0] }} style={s.promoImg} resizeMode="contain" />
            )}
            {promoImages[1] && (
              <Image source={{ uri: promoImages[1] }} style={s.promoImg2} resizeMode="contain" />
            )}
            {!promoImages.length && <Ionicons name="basket" size={54} color={C.gold} />}
          </View>
        </View>

        {!!pendingPayment && (
          <TouchableOpacity style={s.warnCard} activeOpacity={0.85}
            onPress={() => checkPayment(pendingPayment.order_id)} disabled={busy}>
            <Ionicons name="alert-circle-outline" size={20} color={C.warn} />
            <View style={s.warnBody}>
              <Text style={s.warnTitle}>Payment pending</Text>
              <Text style={s.warnText}>
                Payment for {pendingPayment.order_no || 'your order'} is awaiting confirmation. Tap to check.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.warn} />
          </TouchableOpacity>
        )}

        {categoryCards.length > 0 && (
          <View style={s.section}>
            {sectionHead('Bestsellers', () => { setCategory('All'); setListingTitle('All Products'); go('listing'); })}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.bestRail}>
              {categoryCards.slice(0, 12).map((card) => (
                <TouchableOpacity
                  key={card.name}
                  style={s.bestCard}
                  onPress={() => { setCategory(card.name); setListingTitle(card.name); go('listing'); }}
                >
                  <View style={s.bestCollage}>
                    {card.images.length ? card.images.map((uri, i) => (
                      <Image key={uri + i} source={{ uri }} style={s.bestImg} resizeMode="cover" />
                    )) : (
                      <View style={s.bestPlaceholder}>
                        <Ionicons name="grid-outline" size={22} color={C.ink3} />
                        <Text style={s.bestPlaceholderText} numberOfLines={2}>{card.name}</Text>
                      </View>
                    )}
                    {card.count > 4 && (
                      <View style={s.bestMore}><Text style={s.bestMoreText}>+{card.count - 4} more</Text></View>
                    )}
                  </View>
                  <Text style={s.bestLabel} numberOfLines={2}>{card.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {deals.length > 0 && (
          <View style={s.section}>
            {sectionHead('Top Deals', () => { setCategory('All'); setListingTitle('Top Deals'); go('listing'); })}
            <View style={s.dealGrid}>{deals.map(dealCard)}</View>
          </View>
        )}

        {comboOffers.length > 0 && (
          <View style={s.section}>
            {sectionHead('Combo Offers')}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dealRail}>
              {comboOffers.map((offer) => (
                <View key={offer.offer_id} style={s.comboCard}>
                  <View style={s.comboTop}>
                    <Ionicons name="layers-outline" size={14} color={C.purple} />
                    <Text style={s.comboSave}>Save {money(offer.savings)}</Text>
                  </View>
                  <Text style={s.comboTitle} numberOfLines={2}>{offer.title}</Text>
                  <Text style={s.comboSub} numberOfLines={2}>{offer.description}</Text>
                  <View style={s.comboFoot}>
                    <Text style={s.comboPrice}>{money(offer.fixed_price)}</Text>
                    <TouchableOpacity style={s.comboAdd} onPress={() => addCombo(offer)}>
                      <Text style={s.comboAddText}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        {products.length === 0 ? (
          currentAddress ? emptyState('basket-outline', 'Nothing stocked yet', 'This store has no listed items right now. Try another pincode.') : null
        ) : (
          <View style={s.section}>
            {sectionHead('Popular near you', () => {
              setCategory('All');
              setListingTitle('All Products');
              go('listing');
            })}
            <View style={s.grid}>{products.map(productCard)}</View>
            <Text style={s.homeFoot}>Showing items stocked at {storeName}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );

  /* categories + listing + product */
  const shownCategories = categories.filter((name) =>
    name.toLowerCase().includes(search.trim().toLowerCase()));

  const categoriesScreen = (
    <View style={s.screen}>
      {header('Categories', { children: searchField('Search categories…') })}
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {feedback()}
        {shownCategories.map((name) => {
          const info = catStyle(name);
          const sample = productsFor(name).slice(0, 3).map((item) => item.name).join(', ');
          return (
            <TouchableOpacity
              key={name}
              style={s.catRow}
              onPress={() => { setCategory(name); setListingTitle(name); go('listing'); }}
            >
              <View style={[s.catRowIcon, { backgroundColor: info.bg }]}>
                <Ionicons name={info.icon} size={24} color={info.fg} />
              </View>
              <View style={s.catRowBody}>
                <Text style={s.catRowName}>{name}</Text>
                <Text style={s.catRowSub} numberOfLines={1}>{sample || 'Explore this aisle'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.ink3} />
            </TouchableOpacity>
          );
        })}
        {categories.length === 0 && emptyState(
          'grid-outline', 'No categories yet',
          'This store has no listed aisles right now. Try another delivery pincode.',
        )}
        {categories.length > 0 && shownCategories.length === 0 && emptyState(
          'search-outline', 'No matching category',
          `Nothing matches “${search.trim()}”.`, 'Clear search', () => setSearch(''),
        )}
      </ScrollView>
    </View>
  );

  const listingScreen = (
    <View style={s.screen}>
      {header(listingTitle, { back: true, children: searchField('Search in this aisle…') })}
      <View style={s.chipsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {['All', ...categories].map((name) => (
            <TouchableOpacity
              key={name}
              style={[s.chip, category === name && s.chipOn]}
              onPress={() => { setCategory(name); setListingTitle(name === 'All' ? 'All Products' : name); }}
            >
              <Text style={[s.chipText, category === name && s.chipTextOn]}>{name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {feedback()}
        {visibleProducts.length === 0 ? emptyState(
          'search-outline', 'No products found',
          search.trim() ? `Nothing matches “${search.trim()}”.` : 'This aisle is empty right now.',
          'Clear filters', () => { setSearch(''); setCategory('All'); },
        ) : visibleProducts.map(productRow)}
      </ScrollView>
    </View>
  );

  const activeProduct = selectedProduct;
  const activeQty = activeProduct ? basket[activeProduct.sku_id] || 0 : 0;
  const activePct = activeProduct ? discountPct(activeProduct) : 0;

  const productScreen = activeProduct ? (
    <View style={s.screen}>
      <View style={s.lightHeader}>
        <TouchableOpacity style={s.lightHeaderBtn} onPress={back} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={C.ink} />
        </TouchableOpacity>
        <Text style={s.lightHeaderTitle}>Product Details</Text>
        <TouchableOpacity style={s.lightHeaderBtn} onPress={() => toggleWishlist(activeProduct)}
          accessibilityLabel={isSaved(activeProduct) ? 'Remove from saved items' : 'Save this product'}>
          <Ionicons name={isSaved(activeProduct) ? 'heart' : 'heart-outline'} size={21} color={isSaved(activeProduct) ? C.bad : C.ink} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.productPage} showsVerticalScrollIndicator={false}>
        {feedback()}
        <View style={s.productHero}>
          {picture(activeProduct, 240)}
          {activePct > 0 && (
            <View style={s.productOff}><Text style={s.productOffText}>{activePct}% OFF</Text></View>
          )}
        </View>

        <View style={s.productInfo}>
          <Text style={s.productBrand}>
            {(activeProduct.brand || activeProduct.category || 'Zippzo').toUpperCase()}
          </Text>
          <Text style={s.productName}>{activeProduct.name}</Text>
          <View style={s.productRating}>
            {activeProduct.rating ? (
              <>
                <Ionicons name="star" size={14} color={C.goldDeep} />
                <Text style={s.productRatingText}>{activeProduct.rating.toFixed(1)}</Text>
                {activeProduct.review_count && (
                  <Text style={s.productReviewText}>({activeProduct.review_count} reviews)</Text>
                )}
              </>
            ) : null}
          </View>
          <Text style={s.productMeta}>
            {[activeProduct.pack_size, activeProduct.category].filter(Boolean).join(' · ') || 'Each'}
          </Text>

          <View style={s.productPriceRow}>
            <Text style={s.productPrice}>{money(activeProduct.price)}</Text>
            {activePct > 0 && <Text style={s.productMrp}>{money(activeProduct.mrp || 0)}</Text>}
            {activePct > 0 && (
              <View style={s.productSave}>
                <Text style={s.productSaveText}>
                  Save {money(Number(activeProduct.mrp) - Number(activeProduct.price))} ({activePct}% OFF)
                </Text>
              </View>
            )}
          </View>

          <View style={s.badgesRow}>
            {[
              { icon: 'shield-checkmark-outline' as IconName, label: 'Quality checked' },
              { icon: 'pricetag-outline' as IconName, label: 'Best price' },
              { icon: 'refresh-outline' as IconName, label: 'Easy returns' },
            ].map((badge) => (
              <View key={badge.label} style={s.badge}>
                <View style={s.badgeIcon}><Ionicons name={badge.icon} size={17} color={C.purple} /></View>
                <Text style={s.badgeText} numberOfLines={2}>{badge.label}</Text>
              </View>
            ))}
          </View>

          <View style={s.buyRow}>
            <View style={s.qtyBox}>
              <TouchableOpacity
                style={s.qtyBtn}
                onPress={() => { if (activeQty > 0) updateQuantity(activeProduct, -1); }}
                disabled={activeQty === 0}
              >
                <Text style={s.qtyBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={s.qtyValue}>{activeQty || 1}</Text>
              <TouchableOpacity
                style={s.qtyBtn}
                onPress={() => addToCart(activeProduct)}
                disabled={activeQty >= activeProduct.available}
              >
                <Text style={s.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[s.addCartBtn, activeProduct.available < 1 && s.btnDisabled]}
              disabled={activeProduct.available < 1}
              onPress={() => {
                if (activeQty === 0) addToCart(activeProduct);
                selectTab('cart');
              }}
              accessibilityLabel="Add to cart"
            >
              <Ionicons name="cart" size={16} color={C.ink} />
              <Text style={s.addCartText}>Add to Cart</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.buyNowBtn, activeProduct.available < 1 && s.btnDisabled]}
              disabled={activeProduct.available < 1}
              onPress={() => buyNow(activeProduct, activeQty || 1)}
              accessibilityLabel="Buy now — pay and place order immediately"
            >
              <Text style={s.buyNowText}>Buy Now</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.detailCard}>
          <Text style={s.blockTitle}>Product Details</Text>
          {[
            ['Brand', activeProduct.brand || '—'],
            ['Pack size', activeProduct.pack_size || 'Each'],
            ['Category', activeProduct.category || 'Others'],
            ['Availability', activeProduct.available > 0 ? `${activeProduct.available} in stock` : 'Out of stock'],
            ['Sold by', storeName],
          ].map(([label, value]) => (
            <View key={label} style={s.detailRow}>
              <Text style={s.detailLabel}>{label}</Text>
              <Text style={s.detailValue} numberOfLines={2}>{value}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  ) : null;

  /* cart + checkout + orders */
  const cartScreen = (
    <View style={s.screen}>
      {header('My Cart', {
        right: quantityTotal > 0 ? (
          <TouchableOpacity style={s.headerBtn} onPress={clearCart} accessibilityLabel="Clear cart">
            <Ionicons name="trash-outline" size={19} color={C.purple} />
          </TouchableOpacity>
        ) : undefined,
      })}
      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        {feedback()}
        {basketRows.length === 0 ? emptyState(
          'cart-outline', 'Your cart is empty',
          'Add groceries and essentials to see them here.',
          'Start Shopping', () => selectTab('home'),
        ) : (
          <>
            <View style={s.cartCard}>
              {basketRows.map((item) => (
                <View key={item.sku_id} style={s.cartLine}>
                  <TouchableOpacity style={s.cartLineTap} activeOpacity={0.85}
                    onPress={() => { setSelectedProduct(item); go('product'); }}>
                    <View style={s.cartImg}>{picture(item, 56)}</View>
                    <View style={s.cartBody}>
                      <Text style={s.cartName} numberOfLines={2}>{item.name}</Text>
                      <Text style={s.cartPack} numberOfLines={1}>{item.pack_size || 'Each'}</Text>
                      <Text style={s.cartEach}>{money(item.price)} each</Text>
                    </View>
                  </TouchableOpacity>
                  <View style={s.cartSide}>
                    <View style={s.cartLineRight}>
                      <Text style={s.cartTotal}>{money(Number(item.price) * basket[item.sku_id])}</Text>
                      {quantityStep(item, basket[item.sku_id], true)}
                    </View>
                  </View>
                </View>
              ))}
            </View>

            {couponBox()}
            {billCard()}

            <View style={s.deliveryNote}>
              <Ionicons name="flash" size={14} color={C.purple} />
              <Text style={s.deliveryNoteText}>Delivery in about {promiseMinutes} minutes from {storeName}</Text>
            </View>
          </>
        )}
      </ScrollView>

      {basketRows.length > 0 && (
        <View style={s.footerBar}>
          <View>
            <Text style={s.footerTotal}>{money(total)}</Text>
            <Text style={s.footerSub}>{quantityTotal} item{quantityTotal === 1 ? '' : 's'} · incl. delivery</Text>
          </View>
          <TouchableOpacity style={s.footerBtn} onPress={() => go('checkout')}>
            <Text style={s.footerBtnText}>Proceed to Checkout</Text>
            <Ionicons name="arrow-forward" size={15} color={C.ink} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const checkoutScreen = (
    <View style={s.screen}>
      {header('Checkout', { back: true })}
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {feedback()}

        <Text style={s.blockLabel}>Delivery Address</Text>
        {currentAddress ? (
          <View style={s.addressCard}>
            <View style={s.addressIcon}><Ionicons name="location" size={18} color={C.purple} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.addressLabel}>{currentAddress.label || 'Home'}</Text>
              <Text style={s.addressText} numberOfLines={3}>
                {currentAddress.line1}{currentAddress.line2 ? `, ${currentAddress.line2}` : ''}, {currentAddress.city} {currentAddress.pincode}
              </Text>
            </View>
            <TouchableOpacity onPress={() => go('addresses')}><Text style={s.changeLink}>Change</Text></TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={s.addressCard} onPress={() => go('addresses')}>
            <View style={s.addressIcon}><Ionicons name="add" size={18} color={C.purple} /></View>
            <Text style={s.addressLabel}>Add a delivery address</Text>
          </TouchableOpacity>
        )}

        <Text style={s.blockLabel}>Delivery Time</Text>
        <View style={[s.slotCard, s.slotOn]}>
          <View style={s.slotIcon}><Ionicons name="flash" size={16} color={C.purple} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.slotTitle}>Today (Now)</Text>
            <Text style={s.slotSub}>Within {promiseMinutes} minutes</Text>
          </View>
          <Ionicons name="checkmark-circle" size={20} color={C.purple} />
        </View>

        <Text style={s.blockLabel}>Payment Method</Text>
        {[
          { id: 'CASHFREE' as const, icon: 'card-outline' as IconName, title: 'UPI / Cards / Netbanking', sub: 'Secure payment via Cashfree' },
          { id: 'COD' as const, icon: 'cash-outline' as IconName, title: 'Cash on Delivery', sub: 'Pay the rider when your order arrives' },
        ].map((option) => (
          <TouchableOpacity
            key={option.id}
            style={[s.payCard, paymentMethod === option.id && s.payCardOn]}
            onPress={() => setPaymentMethod(option.id)}
          >
            <View style={[s.radio, paymentMethod === option.id && s.radioOn]}>
              {paymentMethod === option.id && <View style={s.radioDot} />}
            </View>
            <Ionicons name={option.icon} size={19} color={C.ink2} />
            <View style={{ flex: 1 }}>
              <Text style={s.payTitle}>{option.title}</Text>
              <Text style={s.paySub}>{option.sub}</Text>
            </View>
          </TouchableOpacity>
        ))}

        {billCard()}

        {!!pendingPayment && (
          <View style={s.warnCard}>
            <Ionicons name="alert-circle-outline" size={20} color={C.warn} />
            <View style={s.warnBody}>
              <Text style={s.warnTitle}>Payment pending</Text>
              <Text style={s.warnText}>Order {pendingPayment.order_no} is awaiting confirmation.</Text>
            </View>
            <TouchableOpacity onPress={() => checkPayment(pendingPayment.order_id)} disabled={busy}>
              <Text style={s.changeLink}>{busy ? 'Checking…' : 'Check'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <View style={s.footerBar}>
        <View>
          <Text style={s.footerTotal}>{money(total)}</Text>
          <Text style={s.footerSub}>{quantityTotal} item{quantityTotal === 1 ? '' : 's'}</Text>
        </View>
        <TouchableOpacity
          style={[s.footerBtn, (busy || !currentAddress || !quantityTotal) && s.btnDisabled]}
          disabled={busy || !currentAddress || !quantityTotal}
          onPress={() => placeOrder()}
        >
          <Text style={s.footerBtnText}>{busy ? 'Placing…' : 'Place Order'}</Text>
          {!busy && <Ionicons name="arrow-forward" size={15} color={C.ink} />}
        </TouchableOpacity>
      </View>
    </View>
  );

  const successScreen = (
    <ScrollView contentContainerStyle={s.successPage} showsVerticalScrollIndicator={false}>
      <View style={s.successBubble}><Ionicons name="checkmark" size={40} color={C.purple} /></View>
      <Text style={s.successTitle}>Order Placed!</Text>
      <Text style={s.successSub}>Thank you for shopping with Zippzo. Your order is being prepared.</Text>

      <View style={s.successCard}>
        <View style={s.successRow}><Text style={s.successLabel}>Order ID</Text><Text style={s.successValue}>{placedOrder?.order_no || '—'}</Text></View>
        <View style={s.successRow}><Text style={s.successLabel}>Delivery</Text><Text style={s.successValue}>In about {placedOrder?.promise_minutes || promiseMinutes} min</Text></View>
        <View style={s.successRow}><Text style={s.successLabel}>Amount</Text><Text style={s.successValue}>{money(placedOrder?.grand_total || 0)}</Text></View>
        <View style={s.successRow}>
          <Text style={s.successLabel}>Payment</Text>
          <Text style={s.successValue}>{paymentMethod === 'COD' ? 'Cash on Delivery' : 'Paid online'}</Text>
        </View>
      </View>

      <TouchableOpacity style={[s.goldBtn, { width: '100%' }]} onPress={() => { if (placedOrder) openTrack(placedOrder); }}>
        <Text style={s.goldBtnText}>Track Order</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.outlineBtn} onPress={() => selectTab('home')}>
        <Text style={s.outlineBtnText}>Continue Shopping</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const ordersScreen = (
    <View style={s.screen}>
      {header('My Orders', {
        right: liveOrders.length > 0 ? (
          <View style={s.headerPill}><Text style={s.headerPillText}>{liveOrders.length} live</Text></View>
        ) : undefined,
      })}
      <View style={s.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
          {([
            ['ALL', 'All'],
            ['PROCESSING', 'Processing'],
            ['OUT', 'Out for Delivery'],
            ['DELIVERED', 'Delivered'],
          ] as [OrderFilter, string][]).map(([id, label]) => (
            <TouchableOpacity
              key={id}
              style={[s.tab, orderFilter === id && s.tabOn]}
              onPress={() => setOrderFilter(id)}
            >
              <Text style={[s.tabText, orderFilter === id && s.tabTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        {feedback()}
        {filteredOrders.length === 0 ? emptyState(
          'receipt-outline', 'No orders here',
          'Your orders will appear in this tab once you place one.',
          'Start Shopping', () => selectTab('home'),
        ) : filteredOrders.map((order) => {
          const live = !CANCELLED.includes(order.status) && order.status !== 'DELIVERED';
          return (
            <View key={order.order_id} style={s.orderCard}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => openOrder(order)}>
                <View style={s.orderTop}>
                  <Text style={s.orderNo}>{order.order_no}</Text>
                  <View style={[
                    s.statusPill,
                    live ? s.statusPillLive : order.status === 'DELIVERED' ? s.statusPillDone : s.statusPillMuted,
                  ]}>
                    <Text style={[s.statusText, (live || order.status === 'DELIVERED') ? { color: C.green } : { color: C.ink3 }]}>
                      {pretty(order.status)}
                    </Text>
                  </View>
                </View>
                <Text style={s.orderMeta}>
                  {new Date(order.placed_at || Date.now()).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {new Date(order.placed_at || Date.now()).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </Text>
                <View style={s.orderMid}>
                  <Text style={s.orderItems}>{order.total_items || 0} item{Number(order.total_items) === 1 ? '' : 's'}</Text>
                  <Text style={s.orderAmount}>{money(order.grand_total)}</Text>
                </View>
              </TouchableOpacity>
              <View style={s.orderActionsRow}>
                {order.payment_method === 'CASHFREE' && order.payment_status !== 'CAPTURED' && (
                  <TouchableOpacity onPress={() => checkPayment(order.order_id)}>
                    <Text style={s.orderLink}>Check payment</Text>
                  </TouchableOpacity>
                )}
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={s.orderViewBtn} onPress={() => openOrder(order)}>
                  <Text style={s.orderViewText}>View Details</Text>
                  <Ionicons name="chevron-forward" size={12} color="#ffffff" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );

  const detail = selectedOrder;
  const detailLines = detail ? (orderDetails[detail.order_id]?.lines || []) : [];
  const detailHistory = detail ? (orderDetails[detail.order_id]?.history || []) : [];
  const detailAddress = detail ? addresses.find((row) => row.address_id === detail.address) : null;
  const orderReturn = detail ? returns.find((row) => row.order === detail.order_id) : null;
  const detailLive = detail ? !CANCELLED.includes(detail.status) && detail.status !== 'DELIVERED' : false;

  const orderDetailScreen = detail ? (
    <View style={s.screen}>
      {header('Order Details', { back: true })}
      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        {feedback()}

        <View style={s.statusCard}>
          <View style={[s.statusPill, detailLive ? s.statusPillLive : s.statusPillMuted, { alignSelf: 'flex-start' }]}>
            <Text style={[s.statusText, { color: detailLive ? C.green : C.ink3 }]}>{pretty(detail.status)}</Text>
          </View>
          <Text style={s.statusTitle}>{pretty(detail.status)}</Text>
          <Text style={s.statusSub}>
            Placed {new Date(detail.placed_at || Date.now()).toLocaleString()}
          </Text>
          {!CANCELLED.includes(detail.status) && timeline(detail.status)}
        </View>

        <View style={s.detailCard}>
          <Text style={s.blockTitle}>Items in this order</Text>
          {detailLines.length === 0 ? (
            <Text style={s.small}>Loading items…</Text>
          ) : detailLines.map((line: any) => {
            const item = products.find((product) => product.sku_id === line.sku);
            return (
              <View key={line.line_id} style={s.detailItem}>
                <View style={s.detailItemImg}>
                  {item ? picture(item, 38) : <Ionicons name="cube-outline" size={18} color={C.ink3} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.detailItemName} numberOfLines={2}>{item?.name || line.sku_name || line.sku_code || 'Item'}</Text>
                  <Text style={s.detailItemQty}>Qty {line.qty} · {money(line.unit_price)} each</Text>
                </View>
                <Text style={s.detailItemTotal}>{money(line.line_total)}</Text>
              </View>
            );
          })}
        </View>

        <View style={s.detailCard}>
          <Text style={s.blockTitle}>Bill Details</Text>
          <View style={s.detailRow}><Text style={s.billLabel}>Item total</Text><Text style={s.billValue}>{money(detail.subtotal)}</Text></View>
          {Number(detail.combo_discount) > 0 && (
            <View style={s.detailRow}><Text style={s.billLabel}>Combo savings</Text><Text style={s.billGood}>− {money(detail.combo_discount)}</Text></View>
          )}
          {Number(detail.coupon_discount) > 0 && (
            <View style={s.detailRow}><Text style={s.billLabel}>Coupon {detail.coupon_code || ''}</Text><Text style={s.billGood}>− {money(detail.coupon_discount)}</Text></View>
          )}
          <View style={s.detailRow}>
            <Text style={s.billLabel}>Delivery fee</Text>
            <Text style={Number(detail.delivery_fee) === 0 ? s.billGood : s.billValue}>
              {Number(detail.delivery_fee) === 0 ? 'FREE' : money(detail.delivery_fee)}
            </Text>
          </View>
          <View style={s.billDivider} />
          <View style={s.detailRow}><Text style={s.billTotalLabel}>Total paid</Text><Text style={s.billTotal}>{money(detail.grand_total)}</Text></View>
        </View>

        <View style={s.detailCard}>
          <Text style={s.blockTitle}>Delivery &amp; payment</Text>
          {detailAddress ? (
            <Text style={s.addressText}>
              {detailAddress.label || 'Home'} · {detailAddress.line1}{detailAddress.line2 ? `, ${detailAddress.line2}` : ''}, {detailAddress.city} {detailAddress.pincode}
            </Text>
          ) : <Text style={s.small}>Address not available on this device.</Text>}
          <View style={s.detailRow}>
            <Text style={s.detailLabel}>Payment</Text>
            <Text style={s.detailValue}>{pretty(detail.payment_method)} · {pretty(detail.payment_status)}</Text>
          </View>
        </View>

        {detailHistory.length > 0 && (
          <View style={s.detailCard}>
            <Text style={s.blockTitle}>Order timeline</Text>
            {detailHistory.map((event: any) => (
              <View key={event.history_id} style={s.historyRow}>
                <View style={s.historyDot} />
                <View style={{ flex: 1 }}>
                  <Text style={s.historyText}>{pretty(event.to_status)}</Text>
                  <Text style={s.historyTime}>{new Date(event.created_at).toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={s.detailActions}>
          {['PLACED', 'CONFIRMED'].includes(detail.status) && (
            <TouchableOpacity style={s.outlineBtn} onPress={() => cancelOrder(detail)}>
              <Text style={s.outlineBtnText}>Cancel Order</Text>
            </TouchableOpacity>
          )}
          {LIVE_TRACK.includes(detail.status) && (
            <TouchableOpacity style={s.purpleBtn} onPress={() => openTrack(detail)}>
              <Text style={s.purpleBtnText}>Track Order</Text>
            </TouchableOpacity>
          )}
          {['DELIVERED', ...CANCELLED].includes(detail.status) && (
            <TouchableOpacity style={[s.goldBtn, reorderBusy === detail.order_id && s.btnDisabled]}
              disabled={reorderBusy === detail.order_id} onPress={() => reorder(detail.order_id)}>
              <Text style={s.goldBtnText}>{reorderBusy === detail.order_id ? 'Adding…' : 'Reorder'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {detail.status === 'DELIVERED' && (
          <View style={s.detailCard}>
            <Text style={s.blockTitle}>Need help with this order?</Text>
            {orderReturn ? (
              <Text style={s.small}>Return status: {pretty(orderReturn.status)}</Text>
            ) : returnFor === detail.order_id ? (
              <>
                <TextInput
                  style={s.input}
                  placeholder="What went wrong?"
                  placeholderTextColor={C.ink3}
                  multiline
                  value={returnReason}
                  onChangeText={setReturnReason}
                />
                <TouchableOpacity style={[s.outlineBtn, busy && s.btnDisabled]} disabled={busy}
                  onPress={() => submitReturn(detail.order_id)}>
                  <Text style={s.outlineBtnText}>{busy ? 'Sending…' : 'Request Return'}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={s.outlineBtn} onPress={() => setReturnFor(detail.order_id)}>
                <Text style={s.outlineBtnText}>Report a Problem</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  ) : null;

  const trackScreen = detail ? (
    <View style={s.screen}>
      {header('Track Order', { back: true })}
      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        {feedback()}
        {timeline(detail.status)}

        <View style={s.trackEtaCard}>
          <Text style={s.trackEtaLabel}>{detail.status === 'DELIVERED' ? 'DELIVERED' : 'ARRIVING IN'}</Text>
          <Text style={s.trackEta}>
            {detail.status === 'DELIVERED' ? 'Delivered to your door' : `${tracking?.eta_minutes ?? promiseMinutes} minutes`}
          </Text>
          <Text style={s.trackOrderNo}>Order {detail.order_no}</Text>
        </View>

        {trackingError ? <Text style={s.error}>{trackingError}</Text> : tracking ? (
          <View style={s.detailCard}>
            <Text style={s.blockTitle}>
              {tracking.live ? (tracking.stale ? 'Last known rider location' : 'Rider is on the way') : 'Delivery partner'}
            </Text>
            {tracking.rider ? (
              <View style={s.riderRow}>
                <View style={s.riderAvatar}><Ionicons name="person" size={19} color="#ffffff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.riderName}>{tracking.rider.name || 'Zippzo rider'}</Text>
                  <Text style={s.riderSub}>
                    {[tracking.rider.vehicle_type, tracking.rider.phone_masked].filter(Boolean).join(' · ') || 'Delivery partner'}
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={s.small}>No rider yet — you will hear the moment they pick it up.</Text>
            )}
            {tracking.location ? (
              <TouchableOpacity
                style={s.outlineBtn}
                onPress={() => Linking.openURL(`https://maps.google.com/?q=${tracking.location.lat},${tracking.location.lng}`)}
              >
                <Text style={s.outlineBtnText}>Open in Maps</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : <Text style={s.small}>Loading delivery updates…</Text>}

        <TouchableOpacity style={s.purpleBtn} onPress={() => openOrder(detail)}>
          <Text style={s.purpleBtnText}>View Order Details</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  ) : null;

  /* profile + account screens */
  const profileScreen = (
    <View style={s.screen}>
      <View style={s.profileHeader}>
        <View style={s.profileRow}>
          <View style={s.profileAvatar}>
            <Text style={s.profileAvatarText}>{initials(profile.name || user.full_name || 'Z')}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.profileName}>{profile.name || user.full_name || 'Shopper'}</Text>
            <Text style={s.profileEmail} numberOfLines={1}>{user.email || profile.phone || 'Signed in'}</Text>
          </View>
          <TouchableOpacity style={s.profileEdit} onPress={() => setEditingProfile((value) => !value)}
            accessibilityLabel="Edit profile">
            <Ionicons name={editingProfile ? 'close' : 'pencil'} size={15} color={C.purple} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {feedback()}

        {editingProfile && (
          <View style={s.card}>
            <Text style={s.blockTitle}>Account details</Text>
            <Text style={s.fieldLabel}>Full name</Text>
            <TextInput style={s.input} placeholder="Your name" placeholderTextColor={C.ink3}
              value={name} onChangeText={setName} />
            <Text style={s.fieldLabel}>Mobile number</Text>
            <TextInput style={s.input} placeholder="10-digit mobile number" placeholderTextColor={C.ink3}
              keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
            <TouchableOpacity style={[s.goldBtn, busy && s.btnDisabled]} disabled={busy} onPress={saveProfile}>
              <Text style={s.goldBtnText}>{busy ? 'Saving…' : 'Save details'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.menuCard}>
          {menuRow('receipt-outline', 'My Orders', () => selectTab('orders'), { badge: liveOrders.length })}
          {menuRow('pricetag-outline', 'Offers &amp; Coupons', () => go('offers'), { badge: coupons.length })}
          {menuRow('location-outline', 'Delivery Addresses', () => go('addresses'))}
          {menuRow('heart-outline', 'Saved Items', () => go('wishlist'), { badge: savedCount })}
          {menuRow('notifications-outline', 'Notifications', () => go('notifications'), { badge: unread })}
          {menuRow('help-circle-outline', 'Help &amp; Support', () => Alert.alert(
            'Help &amp; Support', 'Our team is available 8am–11pm every day.',
            [
              { text: 'Call', onPress: () => Linking.openURL('tel:+914000000000') },
              { text: 'Email', onPress: () => Linking.openURL('mailto:support@zippzo.in') },
              { text: 'Close', style: 'cancel' },
            ],
          ))}
          {menuRow('information-circle-outline', 'About Zippzo', () => go('about'))}
        </View>

        <View style={s.menuCard}>
          {menuRow('log-out-outline', 'Logout', () => Alert.alert(
            'Sign out?', 'You can sign back in any time.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: () => logout() },
            ],
          ), { danger: true })}
        </View>

        <Text style={s.versionText}>Zippzo Shopper · v0.2.0</Text>
      </ScrollView>
    </View>
  );

  const addressesScreen = (
    <View style={s.screen}>
      {header('Delivery Addresses', {
        back: true,
        right: (
          <TouchableOpacity style={s.headerBtn} onPress={() => setShowAddressForm((value) => !value)}
            accessibilityLabel="Add address">
            <Ionicons name={showAddressForm ? 'close' : 'add'} size={21} color={C.purple} />
          </TouchableOpacity>
        ),
      })}
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {feedback()}

        {addresses.length === 0 && !showAddressForm && emptyState(
          'location-outline', 'No addresses yet',
          'Add a delivery address to start shopping.', 'Add Address', () => setShowAddressForm(true),
        )}

        {addresses.map((address) => (
          <View key={address.address_id} style={[s.addressCard, s.addressCardCol, address.address_id === addressId && s.addressCardOn]}>
            <TouchableOpacity style={s.addressTap} activeOpacity={0.85}
              onPress={() => { setAddressId(address.address_id); setPincode(address.pincode); back(); }}>
              <View style={[s.radio, address.address_id === addressId && s.radioOn]}>
                {address.address_id === addressId && <View style={s.radioDot} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.addressTitleRow}>
                  <Text style={s.addressLabel}>{address.label || 'Address'}</Text>
                  {address.is_default && (
                    <View style={s.defaultPill}><Text style={s.defaultPillText}>Default</Text></View>
                  )}
                </View>
                <Text style={s.addressText} numberOfLines={2}>
                  {address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.city} {address.pincode}
                </Text>
                {address.geo_lat != null && address.geo_lng != null ? (
                  <View style={s.pinnedRow}>
                    <Ionicons name="locate" size={11} color={C.purple} />
                    <Text style={s.pinnedText}>Map pin set</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
            <View style={s.addressActions}>
              {!address.is_default && (
                <TouchableOpacity onPress={() => makeDefaultAddress(address)}>
                  <Text style={s.addressAction}>Make default</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => deleteAddress(address)}>
                <Text style={[s.addressAction, { color: C.bad }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {showAddressForm && (
          <View style={s.card}>
            <Text style={s.blockTitle}>Add a new address</Text>
            <TouchableOpacity style={[s.pinBtn, (locating || busy) && s.btnDisabled]} disabled={locating || busy} onPress={pinAddress}>
              <Ionicons name="locate" size={17} color={C.purple} />
              <Text style={s.pinBtnText}>{locating ? 'Getting your location…' : 'Use my current location'}</Text>
            </TouchableOpacity>
            {geoStatus ? <Text style={s.pinStatus}>{geoStatus}</Text> : null}
            {([
              ['label', 'Label (Home, Work…)'],
              ['line1', 'House / flat and street'],
              ['line2', 'Area (optional)'],
              ['landmark', 'Landmark (optional)'],
              ['city', 'City'],
              ['pincode', '6-digit pincode'],
            ] as const).map(([key, hint]) => (
              <TextInput
                key={key}
                style={s.input}
                placeholder={hint}
                placeholderTextColor={C.ink3}
                keyboardType={key === 'pincode' ? 'number-pad' : 'default'}
                maxLength={key === 'pincode' ? 6 : undefined}
                value={(addressDraft as any)[key]}
                onChangeText={(value) => setAddressDraft((old) => ({ ...old, [key]: value }))}
              />
            ))}
            <TouchableOpacity style={[s.goldBtn, busy && s.btnDisabled]} disabled={busy} onPress={saveAddress}>
              <Text style={s.goldBtnText}>{busy ? 'Saving…' : 'Save address'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );

  const offersScreen = (
    <View style={s.screen}>
      {header('Offers &amp; Coupons', { back: true })}
      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        {feedback()}
        {coupons.length === 0 && comboOffers.length === 0 && emptyState(
          'pricetag-outline', 'No offers right now',
          'Coupons and combos from this store will appear here.',
        )}

        {coupons.length > 0 && <Text style={s.blockLabel}>Coupons</Text>}
        {coupons.map((coupon) => (
          <View key={coupon.coupon_id} style={s.offerCard}>
            <View style={s.offerTop}>
              <View style={s.offerCodePill}><Text style={s.offerCode}>{coupon.code}</Text></View>
              <Text style={s.offerTitle} numberOfLines={1}>
                {coupon.title || (coupon.discount_type === 'FLAT'
                  ? `Flat ${money(coupon.discount_value)} off`
                  : `${coupon.discount_value}% off`)}
              </Text>
            </View>
            <Text style={s.offerDesc}>{coupon.description || `Use ${coupon.code} on this store.`}</Text>
            <Text style={s.offerMeta}>
              Min order {money(coupon.min_order || 0)}
              {coupon.max_discount ? ` · up to ${money(coupon.max_discount)}` : ''}
            </Text>
            {appliedCoupon?.coupon_id === coupon.coupon_id ? (
              <Text style={s.offerApplied}>Applied to your cart</Text>
            ) : (
              <TouchableOpacity style={s.offerApply} onPress={() => applyCouponFromOffer(coupon)}>
                <Text style={s.offerApplyText}>Apply</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {comboOffers.length > 0 && <Text style={s.blockLabel}>Combo offers</Text>}
        {comboOffers.map((offer) => (
          <View key={offer.offer_id} style={s.offerCard}>
            <View style={s.offerTop}>
              <Ionicons name="layers-outline" size={16} color={C.purple} />
              <Text style={s.offerTitle} numberOfLines={2}>{offer.title}</Text>
            </View>
            <Text style={s.offerDesc}>{offer.description}</Text>
            <View style={s.comboOfferFoot}>
              <Text style={s.offerMeta}>Combo {money(offer.fixed_price)} · Save {money(offer.savings)}</Text>
              <TouchableOpacity style={s.offerApply} onPress={() => addCombo(offer)}>
                <Text style={s.offerApplyText}>Add combo</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );

  const notificationsScreen = (
    <View style={s.screen}>
      {header('Notifications', {
        back: true,
        right: unread > 0 ? (
          <TouchableOpacity onPress={markAllNotificationsRead}>
            <Text style={s.headerAction}>Mark all read</Text>
          </TouchableOpacity>
        ) : undefined,
      })}
      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        {feedback()}
        {notifications.length === 0 ? emptyState(
          'notifications-outline', 'No notifications',
          'Order updates and offers will appear here.',
        ) : notifications.map((notification) => {
          const payload = notification.payload_json || {};
          const isOtp = notification.type === 'DELIVERY_OTP';
          return (
          <TouchableOpacity
            key={notification.notification_id}
            style={[s.noticeCard, !notification.read_at && s.noticeUnread, isOtp && s.otpCard]}
            onPress={() => markNotificationRead(notification)}
          >
            <View style={s.noticeIcon}><Ionicons name={isOtp ? 'key-outline' : 'cube-outline'} size={17} color={isOtp ? C.gold : C.purple} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.noticeTitle}>
                {isOtp ? 'Your delivery code' : (payload?.title || pretty(notification.type || 'Order update'))}
              </Text>
              {isOtp ? (
                <>
                  <Text style={s.otpCode}>{payload?.otp || '——————'}</Text>
                  <Text style={s.noticeText}>Share this code with your rider at the door.</Text>
                </>
              ) : (
                <Text style={s.noticeText}>
                  {payload?.message || payload?.body
                    || payload?.order_no || 'You have a new order update.'}
                </Text>
              )}
              <Text style={s.noticeTime}>
                {notification.created_at ? new Date(notification.created_at).toLocaleString() : ''}
                {!notification.read_at ? ' · Tap to mark read' : ''}
              </Text>
            </View>
            {!notification.read_at && <View style={s.unreadDot} />}
          </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  const wishlistProducts = products.filter((item) => wishlist.some(
    (row) => row.sku === item.sku_id || row.sku_detail?.sku_id === item.sku_id,
  ));
  const wishlistElsewhere = wishlist.filter((row) => {
    const skuId = row.sku || row.sku_detail?.sku_id;
    return !products.some((item) => item.sku_id === skuId);
  });

  const wishlistScreen = (
    <View style={s.screen}>
      {header('Saved Items', { back: true })}
      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        {feedback()}
        {wishlist.length === 0 ? emptyState(
          'heart-outline', 'No saved items',
          'Tap the heart on a product to save it for later.',
          'Browse Products', () => selectTab('home'),
        ) : (
          <>
            {wishlistProducts.map(productRow)}
            {wishlistElsewhere.length > 0 && (
              <>
                <Text style={s.blockLabel}>Not at your selected store</Text>
                {wishlistElsewhere.map((row) => {
                  const saved = row.sku_detail || {};
                  return (
                    <View key={row.wishlist_id} style={s.rowCard}>
                      <View style={s.rowTap}>
                        <View style={s.rowImg}>
                          {saved.image_url
                            ? <Image source={{ uri: mediaUrl(saved.image_url) }} style={{ width: 58, height: 58 }} resizeMode="contain" />
                            : <Text style={s.picFallbackText}>{initials(saved.name || 'Z')}</Text>}
                        </View>
                        <View style={s.rowBody}>
                          <Text style={s.rowName} numberOfLines={2}>{saved.name || 'Saved item'}</Text>
                          <Text style={s.rowPack}>{saved.pack_size || 'Each'}</Text>
                          <Text style={s.small}>Not stocked at this store</Text>
                        </View>
                      </View>
                      <TouchableOpacity style={s.rowAction}
                        onPress={() => toggleWishlist({ sku_id: row.sku } as Product)}
                        accessibilityLabel="Remove from saved items">
                        <Ionicons name="trash-outline" size={18} color={C.bad} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );

  const aboutScreen = (
    <View style={s.screen}>
      {header('About Zippzo', { back: true })}
      <ScrollView contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>
        <View style={s.aboutCard}>
          <Image source={zippzoLogo} style={s.aboutLogoImg} resizeMode="contain" accessibilityLabel="Zippzo" />
          <Text style={s.aboutVersion}>Shopper app · v0.2.0</Text>
        </View>
        <View style={s.detailCard}>
          <Text style={s.blockTitle}>Groceries in minutes</Text>
          <Text style={s.aboutText}>
            Zippzo runs neighbourhood dark stores so your order is picked, packed and delivered
            within minutes — not days.
          </Text>
        </View>
        <View style={s.detailCard}>
          <Text style={s.blockTitle}>Contact</Text>
          <TouchableOpacity style={s.contactRow} onPress={() => Linking.openURL('mailto:support@zippzo.in')}>
            <Ionicons name="mail-outline" size={18} color={C.purple} />
            <Text style={s.contactText}>support@zippzo.in</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.contactRow} onPress={() => Linking.openURL('tel:+914000000000')}>
            <Ionicons name="call-outline" size={18} color={C.purple} />
            <Text style={s.contactText}>+91 40 0000 0000</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  const tabs: { id: Tab; label: string; icon: IconName; iconOn: IconName }[] = [
    { id: 'home', label: 'Home', icon: 'home-outline', iconOn: 'home' },
    { id: 'categories', label: 'Categories', icon: 'grid-outline', iconOn: 'grid' },
    { id: 'cart', label: 'Cart', icon: 'cart-outline', iconOn: 'cart' },
    { id: 'orders', label: 'Orders', icon: 'receipt-outline', iconOn: 'receipt' },
    { id: 'profile', label: 'Profile', icon: 'person-outline', iconOn: 'person' },
  ];
  const showTabs = (['home', 'categories', 'cart', 'orders', 'profile'] as Screen[]).includes(screen);
  const whiteTop = screen === 'product' || screen === 'success';

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: whiteTop ? C.canvas : C.purple }]}>
      <StatusBar barStyle={whiteTop ? 'dark-content' : 'light-content'} />
      <View style={s.body}>
        {screen === 'home' && homeScreen}
        {screen === 'categories' && categoriesScreen}
        {screen === 'listing' && listingScreen}
        {screen === 'product' && productScreen}
        {screen === 'cart' && cartScreen}
        {screen === 'checkout' && checkoutScreen}
        {screen === 'success' && successScreen}
        {screen === 'orders' && ordersScreen}
        {screen === 'orderDetail' && orderDetailScreen}
        {screen === 'track' && trackScreen}
        {screen === 'profile' && profileScreen}
        {screen === 'addresses' && addressesScreen}
        {screen === 'offers' && offersScreen}
        {screen === 'notifications' && notificationsScreen}
        {screen === 'wishlist' && wishlistScreen}
        {screen === 'about' && aboutScreen}
      </View>

      {showTabs && (
        <View style={s.nav}>
          {tabs.map((tab) => (
            <TouchableOpacity key={tab.id} style={s.navItem} onPress={() => selectTab(tab.id)}
              accessibilityLabel={tab.label} activeOpacity={0.7}>
              <View style={[s.navIconWrap, screen === tab.id && s.navIconWrapOn]}>
                <Ionicons
                  name={screen === tab.id ? tab.iconOn : tab.icon}
                  size={21}
                  color={screen === tab.id ? C.purple : C.ink3}
                />
                {tab.id === 'cart' && quantityTotal > 0 && (
                  <View style={s.navBadge}>
                    <Text style={s.navBadgeText}>{quantityTotal > 9 ? '9+' : quantityTotal}</Text>
                  </View>
                )}
              </View>
              <Text style={[s.navLabel, screen === tab.id && s.navLabelOn]}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, backgroundColor: C.canvas },
  screen: { flex: 1, backgroundColor: C.canvas },
  flex: { flex: 1 },

  splash: { flex: 1, backgroundColor: '#ffffff', justifyContent: 'space-between', paddingTop: TOP_INSET + 40, paddingBottom: 48 },
  splashGlow: { display: 'none' },
  splashGlow2: { display: 'none' },
  splashCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  splashLogoImg: { width: 240, height: 240 },
  splashLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  splashTag: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 2.6, marginTop: 10, textAlign: 'center' },
  splashFoot: { alignItems: 'center', gap: 10 },
  splashLoading: { color: C.ink3, fontSize: 12 },

  authScroll: { flexGrow: 1, backgroundColor: '#ffffff', paddingHorizontal: 18, paddingTop: TOP_INSET + 22, paddingBottom: 28 },
  authBrand: { alignItems: 'center', marginBottom: 22 },
  authLogoImg: { width: 175, height: 175 },
  authCard: { backgroundColor: '#ffffff', borderRadius: 24, padding: 22, shadowColor: '#ffffff', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  authTitle: { color: C.ink, fontSize: 23, fontWeight: '900', letterSpacing: -0.5 },
  authSub: { color: C.ink3, fontSize: 12.5, lineHeight: 18, marginTop: 5, marginBottom: 10 },
  fieldLabel: { color: C.ink2, fontSize: 11.5, fontWeight: '800', marginTop: 12, marginBottom: 5, letterSpacing: 0.2 },
  input: { height: 50, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, borderRadius: 13, paddingHorizontal: 14, color: C.ink, fontSize: 14 },
  error: { color: C.bad, fontSize: 12, marginTop: 8, lineHeight: 17 },
  success: { color: C.green, fontSize: 12, marginTop: 8, lineHeight: 17, fontWeight: '600' },
  goldBtn: { backgroundColor: C.gold, borderRadius: 14, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 18, flexDirection: 'row', gap: 7, paddingHorizontal: 16, shadowColor: C.goldDeep, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  goldBtnText: { color: C.ink, fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.55 },
  pinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: C.purple, backgroundColor: C.purpleSoft || '#f1edff', marginBottom: 10 },
  pinBtnText: { color: C.purple, fontSize: 13, fontWeight: '800' },
  pinStatus: { color: C.ink2, fontSize: 11.5, lineHeight: 16, marginBottom: 8 },
  authLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  authLink: { color: C.purple, fontSize: 12.5, fontWeight: '800' },
  authBack: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 12 },
  authHint: { color: C.ink3, fontSize: 10.5, textAlign: 'center', marginTop: 14, lineHeight: 15 },
  guardWrap: { flex: 1, justifyContent: 'center', padding: 22 },
  guardCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 22, alignItems: 'center' },
  guardIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },

  header: { backgroundColor: C.canvas, paddingHorizontal: 16, paddingTop: TOP_INSET + 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: C.ink, fontSize: 19, fontWeight: '900', letterSpacing: -0.3 },
  headerPill: { backgroundColor: C.panel, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  headerPillText: { color: C.ink, fontSize: 10, fontWeight: '800' },
  headerAction: { color: C.purple, fontSize: 11.5, fontWeight: '800' },

  homeHeader: { backgroundColor: C.canvas, paddingHorizontal: 16, paddingTop: TOP_INSET + 10, paddingBottom: 18, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 1, borderBottomColor: C.line },
  brandLockup: { flex: 1 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMarkImg: { width: 75, height: 32 },
  brandTag: { color: C.purple, fontSize: 8.5, fontWeight: '800', letterSpacing: 2, marginTop: 1, marginLeft: 2 },
  brandTagPill: { backgroundColor: C.purpleSoft, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2.5, marginLeft: 2 },
  brandTagPillText: { color: C.purple, fontSize: 8.5, fontWeight: '900', letterSpacing: 0.6 },
  bellDot: { position: 'absolute', top: 9, right: 10, width: 7, height: 7, borderRadius: 4, backgroundColor: C.purple, borderWidth: 1.5, borderColor: C.canvas },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 2 },
  locationPin: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'center' },
  locationBody: { flex: 1, minWidth: 0 },
  locationKicker: { color: C.ink2, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.9 },
  locationValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  locationValue: { flexShrink: 1, color: C.ink, fontSize: 13, fontWeight: '700' },

  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 13, paddingHorizontal: 12, height: 46, marginTop: 14, shadowColor: '#ffffff', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  searchInput: { flex: 1, color: C.ink, fontSize: 13.5, minHeight: 22, marginLeft: 7 },

  card: { backgroundColor: C.canvas, borderRadius: 12, padding: 14, marginHorizontal: 14, marginVertical: 8 },
  blockTitle: { color: C.ink, fontSize: 15, fontWeight: '800', marginBottom: 8 },
  blockSub: { color: C.ink3, fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  blockLabel: { color: C.ink2, fontSize: 12.5, fontWeight: '700', marginBottom: 6 },

  section: { marginHorizontal: 14, marginTop: 18 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { color: C.ink, fontSize: 16.5, fontWeight: '900', letterSpacing: -0.2 },
  viewAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: C.purpleSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  viewAllText: { color: C.purple, fontSize: 11, fontWeight: '800' },

  homePage: { paddingBottom: 96 },
  quickRail: { paddingRight: 6, paddingVertical: 2, marginTop: 14 },
  quickChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#ffffff', marginRight: 8 },
  quickChipText: { color: C.ink2, fontSize: 11, fontWeight: '800' },
  promo: { backgroundColor: '#f7f8f6', borderWidth: 1, borderColor: C.line, borderRadius: 16, marginHorizontal: 14, marginTop: 14, overflow: 'hidden', flexDirection: 'row', minHeight: 148 },
  promoBody: { flex: 1, padding: 16 },
  promoPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#e9ede9', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, alignSelf: 'flex-start', marginBottom: 9 },
  promoPillText: { color: '#4b5a50', fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  promoTitle: { color: C.ink, fontSize: 20, fontWeight: '900', lineHeight: 25, letterSpacing: -0.4 },
  promoBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12, backgroundColor: C.ink, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, alignSelf: 'flex-start' },
  promoBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  promoArt: { width: 122, padding: 10, justifyContent: 'center', alignItems: 'center' },
  promoImg: { width: 104, height: 104 },
  promoImg2: { width: 78, height: 78 },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  catChip: { width: '25%', padding: 6, alignItems: 'center' },
  catChipIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  catChipLabel: { color: C.ink, fontSize: 11, fontWeight: '800', textAlign: 'center', maxWidth: 48 },

  catRail: { paddingRight: 6, paddingVertical: 2 },
  catItem: { alignItems: 'center', marginRight: 16, width: 62 },
  catDisc: { width: 60, height: 60, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  catLabel: { color: C.ink2, fontSize: 10.5, fontWeight: '700', textAlign: 'center', width: 62, lineHeight: 14 },
  bestRail: { paddingRight: 6, paddingVertical: 2 },
  bestCard: { width: 140, marginRight: 12 },
  bestCollage: { width: 140, height: 140, borderRadius: 12, overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#f3f5f2', borderWidth: 1, borderColor: C.line, position: 'relative' },
  bestImg: { width: 68, height: 68 },
  bestPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10 },
  bestPlaceholderText: { color: C.ink3, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  bestMore: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: C.line },
  bestMoreText: { color: C.ink2, fontSize: 9, fontWeight: '800' },
  bestLabel: { color: C.ink, fontSize: 12, fontWeight: '800', marginTop: 7, lineHeight: 16 },

  dealGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  dealCard: { width: '33.33%', padding: 6, alignItems: 'center' },
  dealImg: { width: 80, height: 80, borderRadius: 10, overflow: 'hidden', position: 'relative', marginBottom: 6 },
  dealOff: { position: 'absolute', top: 4, right: 4, backgroundColor: C.bad, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  dealOffText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  dealName: { color: C.ink, fontSize: 11.5, fontWeight: '800', textAlign: 'center', marginBottom: 4, lineHeight: 15 },
  dealPriceRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  dealPrice: { color: C.ink, fontSize: 12.5, fontWeight: '900' },
  dealMrp: { color: C.ink3, fontSize: 10, fontWeight: '700', textDecorationLine: 'line-through' },

  catRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.canvas, borderRadius: 10, padding: 10, marginHorizontal: 14, marginVertical: 5, borderWidth: 1, borderColor: C.line },
  catRowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  catRowBody: { flex: 1, minWidth: 0 },
  catRowName: { color: C.ink, fontSize: 14, fontWeight: '800' },
  catRowSub: { color: C.ink3, fontSize: 11.5, marginTop: 1 },

  chipsWrap: { paddingHorizontal: 14, marginTop: 4 },
  chips: { paddingHorizontal: 14 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.line, marginRight: 8, backgroundColor: C.canvas },
  chipOn: { borderColor: C.purple, backgroundColor: C.purpleSoft },
  chipText: { color: C.ink2, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: C.purple },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 14 },
  gridCard: { width: '48.3%', backgroundColor: C.canvas, borderRadius: 18, padding: 10, borderWidth: 1, borderColor: '#f4f4f7', marginBottom: 12, shadowColor: '#f4f4f7', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  gridImg: { width: '100%', height: 120, borderRadius: 14, backgroundColor: '#f4f4f7', overflow: 'hidden', position: 'relative', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  gridOff: { position: 'absolute', top: 7, left: 7, backgroundColor: C.purple, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2.5 },
  gridOffText: { color: C.gold, fontSize: 9, fontWeight: '900', letterSpacing: 0.2 },
  gridSoldOut: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(23,23,39,0.55)', paddingVertical: 3, alignItems: 'center' },
  gridSoldOutText: { color: '#ffffff', fontSize: 8.5, fontWeight: '900', letterSpacing: 0.8 },
  gridEta: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', backgroundColor: C.purpleSoft, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, marginTop: 7, marginBottom: 4 },
  gridEtaText: { color: C.purple, fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  gridName: { color: C.ink, fontSize: 12.5, fontWeight: '800', lineHeight: 16.5, marginBottom: 2, minHeight: 33 },
  gridPack: { color: C.ink3, fontSize: 10.5, marginBottom: 8 },
  gridFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' },
  gridPriceCol: { flexShrink: 1 },
  gridPrice: { color: C.ink, fontSize: 14, fontWeight: '900' },
  gridMrp: { color: C.ink3, fontSize: 10.5, fontWeight: '700', textDecorationLine: 'line-through' },
  gridAdd: { flexDirection: 'row', alignItems: 'center', gap: 1, backgroundColor: C.gold, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5, minWidth: 52, justifyContent: 'center' },
  gridAddText: { color: C.ink, fontSize: 10.5, fontWeight: '900' },
  addPill: { backgroundColor: C.gold, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 5, alignItems: 'center', justifyContent: 'center', minWidth: 52 },
  addPillSm: { minWidth: 38, paddingHorizontal: 6, paddingVertical: 3 },
  addPillList: { backgroundColor: C.gold, minWidth: 58 },
  addPillText: { color: C.ink, fontSize: 10.5, fontWeight: '900' },

  rowCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 8, marginHorizontal: 12, marginVertical: 4, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center' },
  rowImg: { width: 62, height: 62, borderRadius: 8, overflow: 'hidden', marginRight: 10 },
  rowTap: { flex: 1 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { color: C.ink, fontSize: 13.5, fontWeight: '800', lineHeight: 18, marginBottom: 2 },
  rowPack: { color: C.ink3, fontSize: 11, marginBottom: 4 },
  rowPriceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  priceText: { color: C.ink, fontSize: 13, fontWeight: '900' },
  mrpText: { color: C.ink3, fontSize: 10.5, fontWeight: '700', textDecorationLine: 'line-through' },
  offText: { color: C.green, fontSize: 10, fontWeight: '800' },
  rowAction: { paddingLeft: 6 },

  productPage: { paddingBottom: 80 },
  productHero: { alignItems: 'center', position: 'relative', marginBottom: 10 },
  productOff: { position: 'absolute', top: 12, right: 12, backgroundColor: C.purple, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  productOffText: { color: C.gold, fontSize: 10, fontWeight: '900', letterSpacing: 0.2 },
  productInfo: { paddingHorizontal: 14 },
  productBrand: { color: C.ink2, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 2 },
  productName: { color: C.ink, fontSize: 20, fontWeight: '900', letterSpacing: -0.4, lineHeight: 25, marginBottom: 4 },
  productRating: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  productRatingText: { color: C.ink2, fontSize: 12, fontWeight: '800' },
  productReviewText: { color: C.ink3, fontSize: 11, marginLeft: 4 },
  productMeta: { color: C.ink3, fontSize: 12, marginBottom: 8 },
  productPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 6 },
  productPrice: { color: C.ink, fontSize: 24, fontWeight: '900' },
  productMrp: { color: C.ink3, fontSize: 14, fontWeight: '800', textDecorationLine: 'line-through' },
  productSave: { backgroundColor: C.warnSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  productSaveText: { color: C.warn, fontSize: 11, fontWeight: '800' },
  badgesRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  badge: { backgroundColor: C.purpleSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center', flex: 1 },
  badgeIcon: { marginBottom: 2 },
  badgeText: { color: C.purple, fontSize: 9.5, fontWeight: '800', textAlign: 'center', lineHeight: 13 },
  buyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  qtyBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.canvas },
  qtyBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: C.line },
  qtyBtnText: { color: C.ink, fontSize: 16, fontWeight: '800' },
  qtyValue: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center', color: C.ink, fontSize: 15, fontWeight: '800', borderRightWidth: 1, borderColor: C.line },
  addCartBtn: { flex: 1, backgroundColor: C.gold, borderRadius: 10, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  buyNowBtn: { flex: 1, backgroundColor: C.purple, borderRadius: 10, height: 40, alignItems: 'center', justifyContent: 'center' },
  buyNowText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  addCartText: { color: C.ink, fontSize: 13, fontWeight: '900' },

  detailCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 12, marginHorizontal: 14, marginVertical: 8, borderWidth: 1, borderColor: C.line },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  detailLabel: { color: C.ink2, fontSize: 12.5, fontWeight: '700' },
  detailValue: { color: C.ink, fontSize: 12.5 },
  billDivider: { height: 1, backgroundColor: C.line, marginVertical: 4 },
  billTotalLabel: { color: C.ink2, fontSize: 12.5, fontWeight: '700' },
  billTotal: { color: C.ink, fontSize: 16, fontWeight: '900' },
  freeNote: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  freeNoteText: { color: C.green, fontSize: 11.5, fontWeight: '700' },

  cartCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 12, marginHorizontal: 14, marginVertical: 8, borderWidth: 1, borderColor: C.line },
  cartLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  cartLineTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  cartImg: { width: 56, height: 56, borderRadius: 8, overflow: 'hidden', marginRight: 10 },
  cartBody: { flex: 1, minWidth: 0 },
  cartName: { color: C.ink, fontSize: 13.5, fontWeight: '800', lineHeight: 18, marginBottom: 1 },
  cartPack: { color: C.ink3, fontSize: 11, marginBottom: 2 },
  cartEach: { color: C.ink2, fontSize: 11.5 },
  cartSide: { alignItems: 'flex-end', minWidth: 110 },
  cartLineRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cartTotal: { color: C.ink, fontSize: 14, fontWeight: '900', marginBottom: 4 },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepSm: { transform: [{ scale: 0.85 }] },
  stepBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
  stepBtnText: { color: C.ink, fontSize: 15, fontWeight: '800' },
  stepQty: { width: 28, height: 30, alignItems: 'center', justifyContent: 'center', color: C.ink, fontSize: 13, fontWeight: '800' },
  deliveryNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 14, marginTop: 6 },
  deliveryNoteText: { color: C.ink2, fontSize: 12 },
  footerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, backgroundColor: C.canvas, borderTopWidth: 1, borderTopColor: C.line },
  footerTotal: { color: C.ink, fontSize: 17, fontWeight: '900' },
  footerSub: { color: C.ink3, fontSize: 12 },
  footerBtn: { backgroundColor: C.gold, borderRadius: 10, minHeight: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 16 },
  footerBtnText: { color: C.ink, fontSize: 14, fontWeight: '900' },

  couponCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 12, marginHorizontal: 14, marginVertical: 8, borderWidth: 1, borderColor: C.line },
  couponHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  couponTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  couponRow: { flexDirection: 'row', gap: 8 },
  couponInput: { flex: 1, height: 40, borderWidth: 1, borderColor: C.line, borderRadius: 8, paddingHorizontal: 10, color: C.ink, fontSize: 13 },
  couponApply: { backgroundColor: C.purple, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
  couponApplyText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  couponApplied: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  couponAppliedCode: { color: C.ink, fontSize: 12.5, fontWeight: '800' },
  couponAppliedSub: { color: C.ink3, fontSize: 11 },
  removeLink: { color: C.purple, fontSize: 11.5, fontWeight: '800' },
  couponBrowse: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  couponBrowseText: { color: C.purple, fontSize: 12, fontWeight: '800' },

  billCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 12, marginHorizontal: 14, marginVertical: 8, borderWidth: 1, borderColor: C.line },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  billLabel: { color: C.ink2, fontSize: 12.5, fontWeight: '700' },
  billValue: { color: C.ink, fontSize: 12.5 },
  billGood: { color: C.green, fontSize: 12.5, fontWeight: '800' },
  banner: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginHorizontal: 14, marginVertical: 6 },
  bannerBad: { backgroundColor: C.badSoft, borderLeftWidth: 4, borderLeftColor: C.bad },
  bannerBadText: { color: C.bad, fontSize: 12.5, fontWeight: '700' },
  bannerOk: { backgroundColor: C.greenSoft, borderLeftWidth: 4, borderLeftColor: C.green },
  bannerOkText: { color: C.green, fontSize: 12.5, fontWeight: '700' },
  emptyCard: { alignItems: 'center', paddingVertical: 30, marginHorizontal: 24 },
  emptyIcon: { marginBottom: 10 },
  emptyTitle: { color: C.ink, fontSize: 16, fontWeight: '900', marginBottom: 4 },
  emptyText: { color: C.ink3, fontSize: 12.5, textAlign: 'center', lineHeight: 18, marginBottom: 12 },

  successPage: { padding: 24, alignItems: 'center' },
  successBubble: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  successTitle: { color: C.ink, fontSize: 22, fontWeight: '900', marginBottom: 4 },
  successSub: { color: C.ink3, fontSize: 13.5, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  successCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.line, marginBottom: 16, width: '100%' },
  successRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 5 },
  successLabel: { color: C.ink2, fontSize: 12.5, fontWeight: '700' },
  successValue: { color: C.ink, fontSize: 13.5 },
  outlineBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line, borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  outlineBtnText: { color: C.ink2, fontSize: 13, fontWeight: '800' },

  tabsWrap: { paddingHorizontal: 14 },
  tabs: { paddingHorizontal: 14 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, marginRight: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.canvas },
  tabOn: { borderColor: C.purple, backgroundColor: C.purpleSoft },
  tabText: { color: C.ink2, fontSize: 12.5, fontWeight: '700' },
  tabTextOn: { color: C.purple },

  orderCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 12, marginHorizontal: 14, marginVertical: 7, borderWidth: 1, borderColor: C.line },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  orderNo: { color: C.ink, fontSize: 15, fontWeight: '900' },
  statusPill: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 8, alignSelf: 'flex-start' },
  statusPillLive: { backgroundColor: C.greenSoft, borderColor: C.green },
  statusPillDone: { backgroundColor: C.greenSoft, borderColor: C.green },
  statusPillMuted: { backgroundColor: C.panel, borderColor: C.line },
  statusText: { fontSize: 10.5, fontWeight: '900' },
  orderMeta: { color: C.ink3, fontSize: 11.5, marginBottom: 6 },
  orderMid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  orderItems: { color: C.ink2, fontSize: 12, fontWeight: '700' },
  orderAmount: { color: C.ink, fontSize: 13, fontWeight: '900' },
  orderActionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderLink: { color: C.purple, fontSize: 12, fontWeight: '800' },
  orderViewBtn: { backgroundColor: C.purple, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  orderViewText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },

  statusCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 14, marginHorizontal: 14, marginTop: 8, borderWidth: 1, borderColor: C.line },
  statusTitle: { color: C.ink, fontSize: 17, fontWeight: '900', marginTop: 6 },
  statusSub: { color: C.ink3, fontSize: 12.5, marginBottom: 8 },
  timeline: { paddingHorizontal: 4 },
  timelineStep: { flex: 1, alignItems: 'center', position: 'relative' },
  timelineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  timelineConnector: { height: 18, width: 1, backgroundColor: C.line },
  timelineConnectorHidden: { display: 'none' },
  timelineConnectorOn: { backgroundColor: C.purple },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.line, marginHorizontal: 2 },
  timelineDotOn: { backgroundColor: C.purple, borderWidth: 2, borderColor: C.canvas },
  timelineDotCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.purple },
  timelineLabel: { color: C.ink3, fontSize: 9.5, fontWeight: '700', textAlign: 'center', marginTop: 6, lineHeight: 13, width: 70 },
  timelineLabelOn: { color: C.purple },

  riderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  riderAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  riderName: { color: C.ink, fontSize: 13.5, fontWeight: '800' },
  riderSub: { color: C.ink3, fontSize: 11 },
  trackEtaCard: { backgroundColor: C.purple, borderRadius: 12, padding: 14, marginHorizontal: 14, marginTop: 8, alignItems: 'center' },
  trackEtaLabel: { color: '#52525b', fontSize: 11, fontWeight: '900', letterSpacing: 0.8, marginBottom: 4 },
  trackEta: { color: '#ffffff', fontSize: 26, fontWeight: '900', marginBottom: 2 },
  trackOrderNo: { color: '#52525b', fontSize: 12, fontWeight: '800' },
  detailItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  detailItemImg: { width: 38, height: 38, borderRadius: 8, overflow: 'hidden', marginRight: 8 },
  detailItemName: { color: C.ink, fontSize: 13, fontWeight: '800', lineHeight: 17, marginBottom: 1 },
  detailItemQty: { color: C.ink3, fontSize: 12, marginBottom: 2 },
  detailItemTotal: { color: C.ink, fontSize: 13, fontWeight: '800', marginLeft: 'auto' },
  historyRow: { flexDirection: 'row', paddingVertical: 6 },
  historyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.purple, marginRight: 10, marginTop: 4 },
  historyText: { color: C.ink, fontSize: 12.5, fontWeight: '700' },
  historyTime: { color: C.ink3, fontSize: 11 },
  trackCard: { backgroundColor: C.purpleSoft, borderRadius: 10, padding: 12, marginHorizontal: 14, marginVertical: 8 },
  detailActions: { paddingHorizontal: 14, marginBottom: 20, flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  purpleBtn: { backgroundColor: C.purple, borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  purpleBtnText: { color: '#ffffff', fontSize: 13.5, fontWeight: '900' },

  profileHeader: { backgroundColor: C.canvas, paddingHorizontal: 16, paddingTop: TOP_INSET + 12, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: C.purpleDeep, fontSize: 20, fontWeight: '900' },
  profileName: { color: C.ink, fontSize: 17, fontWeight: '900' },
  profileEmail: { color: C.ink2, fontSize: 12.5 },
  profileEdit: { marginLeft: 'auto' },
  menuCard: { backgroundColor: C.canvas, borderRadius: 10, paddingVertical: 2, marginHorizontal: 14, marginTop: 8, borderWidth: 1, borderColor: C.line },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  menuIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  menuIconDanger: { backgroundColor: C.badSoft },
  menuLabel: { color: C.ink, fontSize: 14, fontWeight: '700', flex: 1 },
  menuBadge: { backgroundColor: C.gold, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1.5 },
  menuBadgeText: { color: C.ink, fontSize: 10.5, fontWeight: '900' },
  versionText: { color: C.ink3, fontSize: 11, textAlign: 'center', marginTop: 14 },

  addressCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 12, marginHorizontal: 14, marginTop: 8, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center' },
  addressCardCol: { flexDirection: 'column', alignItems: 'stretch' },
  addressCardOn: { borderColor: C.purple, backgroundColor: C.purpleSoft },
  addressIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  addressLabel: { color: C.ink, fontSize: 13.5, fontWeight: '800' },
  addressText: { color: C.ink2, fontSize: 12.5 },
  pinnedRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  pinnedText: { color: C.purple, fontSize: 10.5, fontWeight: '700' },
  addressTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addressTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  defaultPill: { backgroundColor: C.goldSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, marginLeft: 8 },
  defaultPillText: { color: C.warn, fontSize: 10, fontWeight: '900' },
  changeLink: { color: C.purple, fontSize: 12.5, fontWeight: '800', marginLeft: 'auto' },
  addressActions: { flexDirection: 'row', gap: 8 },
  addressAction: { color: C.ink2, fontSize: 12.5, fontWeight: '700' },

  payCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 12, marginHorizontal: 14, marginTop: 6, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center' },
  payCardOn: { borderColor: C.purple, backgroundColor: C.purpleSoft },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  radioOn: { borderColor: C.purple, backgroundColor: '#ffffff' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.purple },
  payTitle: { color: C.ink, fontSize: 13.5, fontWeight: '800' },
  paySub: { color: C.ink3, fontSize: 11 },
  warnCard: { backgroundColor: C.warnSoft, borderRadius: 10, padding: 12, marginHorizontal: 14, marginVertical: 8, flexDirection: 'row', alignItems: 'center' },
  warnTitle: { color: C.warn, fontSize: 13, fontWeight: '800' },
  warnText: { color: C.ink2, fontSize: 12.5, marginLeft: 8, flex: 1 },
  aboutCard: { alignItems: 'center', padding: 20, marginHorizontal: 14, marginTop: 8 },
  aboutLogoImg: { width: 190, height: 190, marginBottom: 10 },
  aboutVersion: { color: C.ink3, fontSize: 11, marginBottom: 16 },
  aboutText: { color: C.ink3, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  contactText: { color: C.ink, fontSize: 13 },
  offerCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 10, marginHorizontal: 14, marginTop: 7, borderWidth: 1, borderColor: C.line },
  offerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  offerCodePill: { backgroundColor: C.purpleSoft, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  offerCode: { color: C.purple, fontSize: 11.5, fontWeight: '900' },
  offerTitle: { color: C.ink, fontSize: 14, fontWeight: '800' },
  offerDesc: { color: C.ink3, fontSize: 12, marginTop: 3, lineHeight: 17 },
  offerMeta: { color: C.ink2, fontSize: 11.5, fontWeight: '700', marginTop: 4 },
  offerApplied: { color: C.green, fontSize: 12, fontWeight: '800' },
  offerApply: { backgroundColor: C.purple, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  offerApplyText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  comboOfferFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  noticeCard: { backgroundColor: C.canvas, borderRadius: 10, padding: 10, marginHorizontal: 14, marginVertical: 5, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center' },
  noticeUnread: { borderLeftWidth: 3, borderLeftColor: C.purple },
  otpCard: { backgroundColor: '#fff8e6', borderColor: '#e6c768' },
  otpCode: { color: C.ink, fontSize: 23, fontWeight: '900', letterSpacing: 4, marginVertical: 2, fontFamily: undefined },
  noticeIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.purpleSoft, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  noticeTitle: { color: C.ink, fontSize: 13.5, fontWeight: '800', marginBottom: 1 },
  noticeText: { color: C.ink3, fontSize: 11.5 },
  noticeTime: { color: C.ink3, fontSize: 10.5, marginTop: 2 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.purple, position: 'absolute', top: 10, right: 10 },
  picFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel },
  picFallbackText: { color: C.ink3, fontWeight: '800' },
  homeFoot: { color: C.ink3, fontSize: 11.5, textAlign: 'center', marginTop: 4 },
  page: { paddingHorizontal: 14, paddingBottom: 84 },
  small: { color: C.ink3, fontSize: 11.5 },
  lightHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.canvas, borderBottomWidth: 1, borderBottomColor: C.line, paddingHorizontal: 12, paddingTop: TOP_INSET + 8, paddingBottom: 8 },
  lightHeaderBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  lightHeaderTitle: { flex: 1, color: C.ink, fontSize: 17, fontWeight: '900', textAlign: 'center' },
  slotCard: { backgroundColor: C.greenSoft, borderRadius: 10, padding: 12, marginHorizontal: 14, marginTop: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(18,138,58,0.25)' },
  slotOn: { borderColor: C.green },
  slotIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(18,138,58,0.15)', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  slotTitle: { color: C.green, fontSize: 13.5, fontWeight: '800' },
  slotSub: { color: C.green, fontSize: 11.5, marginTop: 1 },
  warnBody: { flex: 1 },
  dealRail: { paddingHorizontal: 14 },
  comboCard: { width: 150, padding: 10, backgroundColor: C.canvas, borderRadius: 10, borderWidth: 1, borderColor: C.line, marginRight: 10 },
  comboTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  comboSave: { color: C.purple, fontSize: 11, fontWeight: '900' },
  comboTitle: { color: C.ink, fontSize: 13, fontWeight: '900', marginBottom: 2, lineHeight: 17 },
  comboSub: { color: C.ink3, fontSize: 10.5, lineHeight: 14, marginBottom: 8 },
  comboFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  comboPrice: { color: C.ink, fontSize: 14, fontWeight: '900' },
  comboAdd: { backgroundColor: C.purple, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  comboAddText: { color: '#ffffff', fontSize: 11, fontWeight: '900' },
  nav: { flexDirection: 'row', backgroundColor: '#ffffff', borderTopWidth: 1, borderColor: '#f4f4f7', paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 22 : 10, shadowColor: '#f4f4f7', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  navIconWrap: { width: 46, height: 30, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navIconWrapOn: { backgroundColor: C.purpleSoft },
  navBadge: { position: 'absolute', top: -2, right: 4, backgroundColor: C.bad, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#ffffff' },
  navBadgeText: { color: '#ffffff', fontSize: 9, fontWeight: '900' },
  navLabel: { color: C.ink3, fontSize: 9.5, fontWeight: '800', marginTop: 2, letterSpacing: 0.1 },
  navLabelOn: { color: C.purple },
});
