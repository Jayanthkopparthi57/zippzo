import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Tag, Layers, Users, Plus, ArrowLeft, PackagePlus, Barcode, Trash2, Pencil,
  ImagePlus, Store, RefreshCw, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import DataTable from '../components/ui/DataTable';
import ProductBarcodeModal from '../components/ui/ProductBarcodeModal';
import { useAuth } from '../context/AuthContext';
import {
  fetchApi, postApi, patchApi, deleteApi, uploadFile, describeError,
} from '../api/client';

const SUBTABS = ['skus', 'categories', 'vendors', 'listings', 'vehicle-types'];

const ZONE_OPTIONS = [
  ['DRY', 'Ambient / Dry'],
  ['COLD', 'Cold Chain / Chilled (2-8°C)'],
  ['FROZEN', 'Frozen (-18°C)'],
];
const SKU_STATUSES = ['DRAFT', 'SAMPLE_QC', 'APPROVED', 'ACTIVE', 'DELISTED', 'DISCONTINUED'];
const VENDOR_STATUSES = ['ACTIVE', 'BLOCKED', 'BLACKLISTED'];

/** Client-generated codes are unique per save; deletes never cause a collision. */
const genSkuCode = () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const salt = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SKU-${stamp}-${salt}`;
};

const blankSku = () => ({
  sku_id: null,
  sku_code: genSkuCode(),
  name: '',
  category: '',
  ean: '',
  brand: '',
  pack_size: '',
  storage_zone: 'DRY',
  mrp: '',
  weight_g: '',
  status: 'ACTIVE',
  image_url: '',
});

const blankVendor = () => ({
  vendor_id: null,
  code: '',
  name: '',
  org_entity: '',
  gstin: '',
  pan: '',
  contact_name: '',
  contact_phone: '',
  email: '',
  address: '',
  over_delivery_pct: '5.00',
  under_delivery_pct: '5.00',
  status: 'ACTIVE',
});

const blankListing = () => ({
  sku: '',
  site: '',
  price: '',
  mrp: '',
  discount_pct: '0',
  is_listed: true,
  is_available: true,
  low_stock_threshold: '',
});

const statusBadge = (status) => {
  const s = String(status || '').toUpperCase();
  const cls = s === 'ACTIVE' || s === 'AVAILABLE'
    ? 'badge-success'
    : s === 'BLOCKED' || s === 'BLACKLISTED' || s === 'DISCONTINUED' || s === 'DELISTED'
      ? 'badge-danger'
      : 'badge-warning';
  return <span className={`badge ${cls}`}>{status || '—'}</span>;
};

const money = (v) => (v === null || v === undefined || v === '' ? '—' : `₹${v}`);

function Field({ label, children, span }) {
  return (
    <div className="form-group" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label className="form-label" style={{ fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function FormShell({ title, hint, icon, onBack, children }) {
  return (
    <div className="animate-fade" style={{ padding: '24px 32px', maxWidth: 880, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <button className="btn-secondary" onClick={onBack} data-testid="mc-form-back"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', fontWeight: 600 }}>
          <ArrowLeft size={16} /> Back to Master Data
        </button>
        <span className="badge badge-purple" style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700 }}>
          Master Data Registry
        </span>
      </div>
      <div style={{
        background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0',
        boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)', padding: 28,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, background: '#f5f3ff', color: '#7c3aed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {icon}
          </div>
          <div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>{title}</h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '3px 0 0 0' }}>{hint}</p>
          </div>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0' }} />
        {children}
      </div>
    </div>
  );
}

export default function MasterCatalogView({ initialTab = 'skus' }) {
  const { user } = useAuth();
  const canWrite = Boolean(user?.is_admin);

  const [activeSubtab, setActiveSubtab] = useState(
    SUBTABS.includes(initialTab) ? initialTab : 'skus'
  );
  const [skus, setSkus] = useState([]);
  const [categories, setCategories] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [listings, setListings] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Dedicated pages
  const [skuDraft, setSkuDraft] = useState(null);
  const [skuBusy, setSkuBusy] = useState(false);
  const [skuError, setSkuError] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [vendorDraft, setVendorDraft] = useState(null);
  const [vendorBusy, setVendorBusy] = useState(false);
  const [vendorError, setVendorError] = useState('');
  const [barcodeSku, setBarcodeSku] = useState(null);

  // Inline forms
  const [catOpen, setCatOpen] = useState(false);
  const [catDraft, setCatDraft] = useState({ name: '', parent: '' });
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState('');
  const [lstDraft, setLstDraft] = useState(null);
  const [lstBusy, setLstBusy] = useState(false);
  const [lstError, setLstError] = useState('');

  useEffect(() => {
    setActiveSubtab(SUBTABS.includes(initialTab) ? initialTab : 'skus');
  }, [initialTab]);

  // The catalog is an operator's home screen, and its tables are the only
  // place a transient outage shows up as "0 records". A database blip used to
  // leave every panel silently empty, so retry a few times with backoff and
  // keep the error banner for a real outage. Only transient failures (network
  // errors, 5xx) are retried; a 400/403 is reported immediately.
  const fetchWithRetry = useCallback(async (endpoint, attempts = 5) => {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await fetchApi(endpoint);
      } catch (err) {
        lastError = err;
        const transient = !err?.status || err.status >= 500;
        if (!transient || attempt === attempts - 1) throw err;
        await new Promise((resolve) => { setTimeout(resolve, 800 * (attempt + 1)); });
      }
    }
    throw lastError;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const requests = [
      fetchWithRetry('/catalog/skus/?page_size=500'),
      fetchWithRetry('/catalog/categories/?page_size=500'),
      fetchWithRetry('/supply/vendors/?page_size=500'),
      fetchWithRetry('/catalog/listings/?page_size=500'),
      fetchWithRetry('/network/vehicle-types/?page_size=500'),
      // SiteViewSet is admin-only on reads too, so non-admins get no site list.
      canWrite ? fetchWithRetry('/network/sites/?page_size=500') : Promise.resolve([]),
    ];
    const results = await Promise.allSettled(requests);
    const setters = [setSkus, setCategories, setVendors, setListings, setVehicleTypes, setSites];
    const failures = [];
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        setters[i](Array.isArray(res.value) ? res.value : []);
      } else {
        failures.push(describeError(res.reason));
      }
    });
    if (failures.length) setLoadError([...new Set(failures)].join(' • '));
    setLoading(false);
  }, [canWrite, fetchWithRetry]);

  useEffect(() => { loadData(); }, [loadData]);

  const categoryName = useMemo(() => {
    const map = {};
    categories.forEach((c) => { map[String(c.category_id)] = c.name; });
    return map;
  }, [categories]);

  /* ── SKU create / edit ── */

  const openSkuForm = (row) => {
    setSkuError('');
    setUploadError('');
    setSkuDraft(row ? {
      sku_id: row.sku_id,
      sku_code: row.sku_code || '',
      name: row.name || '',
      category: row.category ? String(row.category) : '',
      ean: row.ean || '',
      brand: row.brand || '',
      pack_size: row.pack_size || '',
      storage_zone: row.storage_zone || 'DRY',
      mrp: row.mrp ?? '',
      weight_g: row.weight_g ?? '',
      status: row.status || 'ACTIVE',
      image_url: row.image_url || '',
    } : blankSku());
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadBusy(true);
    setUploadError('');
    try {
      const res = await uploadFile('/catalog/skus/image-upload/', file);
      setSkuDraft((prev) => (prev ? { ...prev, image_url: res.image_url } : prev));
    } catch (err) {
      setUploadError(describeError(err));
    } finally {
      setUploadBusy(false);
    }
  };

  const submitSku = async (e) => {
    e.preventDefault();
    const d = skuDraft;
    if (!d) return;
    if (!d.name.trim()) { setSkuError('Product name is required.'); return; }
    if (!d.sku_code.trim()) { setSkuError('SKU code is required.'); return; }
    if (d.mrp === '' || Number.isNaN(Number(d.mrp))) { setSkuError('MRP is required.'); return; }
    const payload = {
      sku_code: d.sku_code.trim(),
      name: d.name.trim(),
      category: d.category || null,
      ean: d.ean.trim() || null,
      brand: d.brand.trim(),
      pack_size: d.pack_size.trim(),
      storage_zone: d.storage_zone,
      mrp: d.mrp,
      weight_g: d.weight_g === '' ? null : Number(d.weight_g),
      status: d.status,
      image_url: d.image_url || '',
    };
    setSkuBusy(true);
    setSkuError('');
    try {
      if (d.sku_id) await patchApi(`/catalog/skus/${d.sku_id}/`, payload);
      else await postApi('/catalog/skus/', payload);
      setSkuDraft(null);
      await loadData();
    } catch (err) {
      setSkuError(describeError(err));
    } finally {
      setSkuBusy(false);
    }
  };

  const removeSku = async (row) => {
    if (!window.confirm(`Delete SKU ${row.sku_code}? Its listings and barcodes are removed too.`)) return;
    try {
      await deleteApi(`/catalog/skus/${row.sku_id}/`);
      await loadData();
    } catch (err) {
      setLoadError(describeError(err));
    }
  };

  /* ── Vendors ── */

  const openVendorForm = (row) => {
    setVendorError('');
    setVendorDraft(row ? {
      vendor_id: row.vendor_id,
      code: row.code || '',
      name: row.name || '',
      org_entity: row.org_entity || '',
      gstin: row.gstin || '',
      pan: row.pan || '',
      contact_name: row.contact_name || '',
      contact_phone: row.contact_phone || '',
      email: row.email || '',
      address: row.address || '',
      over_delivery_pct: row.over_delivery_pct ?? '5.00',
      under_delivery_pct: row.under_delivery_pct ?? '5.00',
      status: row.status || 'ACTIVE',
    } : blankVendor());
  };

  const submitVendor = async (e) => {
    e.preventDefault();
    const d = vendorDraft;
    if (!d) return;
    if (!d.code.trim()) { setVendorError('Vendor code is required.'); return; }
    if (!d.name.trim()) { setVendorError('Vendor name is required.'); return; }
    const payload = {
      code: d.code.trim(),
      name: d.name.trim(),
      org_entity: d.org_entity.trim(),
      gstin: d.gstin.trim(),
      pan: d.pan.trim(),
      contact_name: d.contact_name.trim(),
      contact_phone: d.contact_phone.trim(),
      email: d.email.trim(),
      address: d.address.trim(),
      over_delivery_pct: d.over_delivery_pct === '' ? '0' : d.over_delivery_pct,
      under_delivery_pct: d.under_delivery_pct === '' ? '0' : d.under_delivery_pct,
      status: d.status,
    };
    setVendorBusy(true);
    setVendorError('');
    try {
      if (d.vendor_id) await patchApi(`/supply/vendors/${d.vendor_id}/`, payload);
      else await postApi('/supply/vendors/', payload);
      setVendorDraft(null);
      await loadData();
    } catch (err) {
      setVendorError(describeError(err));
    } finally {
      setVendorBusy(false);
    }
  };

  const removeVendor = async (row) => {
    if (!window.confirm(`Delete vendor ${row.code}?`)) return;
    try {
      await deleteApi(`/supply/vendors/${row.vendor_id}/`);
      await loadData();
    } catch (err) {
      setLoadError(describeError(err));
    }
  };

  /* ── Categories ── */

  const submitCategory = async (e) => {
    e.preventDefault();
    if (!catDraft.name.trim()) { setCatError('Category name is required.'); return; }
    setCatBusy(true);
    setCatError('');
    try {
      await postApi('/catalog/categories/', {
        name: catDraft.name.trim(),
        parent: catDraft.parent || null,
      });
      setCatDraft({ name: '', parent: '' });
      setCatOpen(false);
      await loadData();
    } catch (err) {
      setCatError(describeError(err));
    } finally {
      setCatBusy(false);
    }
  };

  const removeCategory = async (row) => {
    if (!window.confirm(`Delete category "${row.name}"? Products in it become uncategorised.`)) return;
    try {
      await deleteApi(`/catalog/categories/${row.category_id}/`);
      await loadData();
    } catch (err) {
      setLoadError(describeError(err));
    }
  };

  /* ── Store listings ── */

  const submitListing = async (e) => {
    e.preventDefault();
    const d = lstDraft;
    if (!d) return;
    if (!d.sku) { setLstError('Pick a SKU to list.'); return; }
    if (!d.site) { setLstError('Pick the site this listing belongs to.'); return; }
    if (d.price === '' || d.mrp === '') { setLstError('Price and MRP are required.'); return; }
    setLstBusy(true);
    setLstError('');
    try {
      await postApi('/catalog/listings/', {
        sku: d.sku,
        site: d.site,
        price: d.price,
        mrp: d.mrp,
        discount_pct: d.discount_pct === '' ? '0' : d.discount_pct,
        is_listed: Boolean(d.is_listed),
        is_available: Boolean(d.is_available),
        low_stock_threshold: d.low_stock_threshold === '' ? null : Number(d.low_stock_threshold),
      });
      setLstDraft(null);
      await loadData();
    } catch (err) {
      setLstError(describeError(err));
    } finally {
      setLstBusy(false);
    }
  };

  const toggleListing = async (row, field) => {
    try {
      await patchApi(`/catalog/listings/${row.listing_id}/`, { [field]: !row[field] });
      await loadData();
    } catch (err) {
      setLoadError(describeError(err));
    }
  };

  const removeListing = async (row) => {
    if (!window.confirm(`Remove the listing for ${row.sku_code || 'this SKU'} at ${row.site_code || 'this site'}?`)) return;
    try {
      await deleteApi(`/catalog/listings/${row.listing_id}/`);
      await loadData();
    } catch (err) {
      setLoadError(describeError(err));
    }
  };

  /* ── dedicated SKU page ── */

  if (skuDraft) {
    const editing = Boolean(skuDraft.sku_id);
    return (
      <FormShell
        title={editing ? `Edit SKU · ${skuDraft.sku_code}` : 'Register New SKU Product Item'}
        hint="Master product record: code, taxonomy, EAN barcode, pricing and a product photo"
        icon={<PackagePlus size={22} />}
        onBack={() => setSkuDraft(null)}
      >
        <form onSubmit={submitSku} data-testid="sku-form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Product Title / Name" span={2}>
              <input className="form-input" data-testid="sku-name" required
                value={skuDraft.name}
                onChange={(e) => setSkuDraft({ ...skuDraft, name: e.target.value })}
                placeholder="e.g. Heritage Toned Milk 500ml" />
            </Field>
            <Field label="SKU Code">
              <input className="form-input" data-testid="sku-code" required
                value={skuDraft.sku_code}
                onChange={(e) => setSkuDraft({ ...skuDraft, sku_code: e.target.value })} />
            </Field>
            <Field label="EAN / UPC Barcode (optional)">
              <input className="form-input" data-testid="sku-ean"
                value={skuDraft.ean}
                onChange={(e) => setSkuDraft({ ...skuDraft, ean: e.target.value })}
                placeholder="e.g. 8901234567890" />
            </Field>
            <Field label="Category Taxonomy">
              <select className="form-input" data-testid="sku-category"
                value={skuDraft.category}
                onChange={(e) => setSkuDraft({ ...skuDraft, category: e.target.value })}>
                <option value="">— Uncategorised —</option>
                {categories.map((c) => (
                  <option key={c.category_id} value={String(c.category_id)}>{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Brand">
              <input className="form-input" data-testid="sku-brand"
                value={skuDraft.brand}
                onChange={(e) => setSkuDraft({ ...skuDraft, brand: e.target.value })} />
            </Field>
            <Field label="Pack Size">
              <input className="form-input" data-testid="sku-pack-size"
                value={skuDraft.pack_size}
                onChange={(e) => setSkuDraft({ ...skuDraft, pack_size: e.target.value })}
                placeholder="e.g. 500 ml" />
            </Field>
            <Field label="Weight (g)">
              <input type="number" min="0" className="form-input" data-testid="sku-weight"
                value={skuDraft.weight_g}
                onChange={(e) => setSkuDraft({ ...skuDraft, weight_g: e.target.value })} />
            </Field>
            <Field label="Maximum Retail Price (MRP ₹)">
              <input type="number" min="0" step="0.01" className="form-input" data-testid="sku-mrp" required
                value={skuDraft.mrp}
                onChange={(e) => setSkuDraft({ ...skuDraft, mrp: e.target.value })} />
            </Field>
            <Field label="Storage Requirements">
              <select className="form-input" data-testid="sku-zone"
                value={skuDraft.storage_zone}
                onChange={(e) => setSkuDraft({ ...skuDraft, storage_zone: e.target.value })}>
                {ZONE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label="Lifecycle Status">
              <select className="form-input" data-testid="sku-status"
                value={skuDraft.status}
                onChange={(e) => setSkuDraft({ ...skuDraft, status: e.target.value })}>
                {SKU_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Product Photo (PNG / JPEG / WebP, max 2 MB)">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label className="btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <ImagePlus size={14} /> {uploadBusy ? 'Uploading…' : 'Choose image'}
                  <input type="file" accept="image/png,image/jpeg,image/webp"
                    data-testid="sku-image-input" onChange={onPickImage} style={{ display: 'none' }} />
                </label>
                {skuDraft.image_url && (
                  <img data-testid="sku-image-preview" src={skuDraft.image_url} alt=""
                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                )}
                {skuDraft.image_url && (
                  <button type="button" className="btn-ghost" style={{ fontSize: 12 }}
                    onClick={() => setSkuDraft({ ...skuDraft, image_url: '' })}>
                    Remove
                  </button>
                )}
              </div>
              {uploadBusy && <div className="form-hint" data-testid="sku-upload-status">Uploading photo…</div>}
              {uploadError && (
                <div className="scan-feedback scan-feedback--error" data-testid="sku-upload-error">
                  <AlertTriangle size={14} /> <span>{uploadError}</span>
                </div>
              )}
            </Field>
          </div>

          {skuError && (
            <div className="scan-feedback scan-feedback--error" data-testid="sku-error">
              <AlertTriangle size={14} /> <span>{skuError}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={() => setSkuDraft(null)}
              style={{ padding: '10px 20px', fontWeight: 600 }} data-testid="sku-cancel">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={skuBusy || uploadBusy}
              data-testid="sku-save"
              style={{ background: '#7c3aed', color: '#fff', padding: '10px 24px', fontWeight: 700, fontSize: 14 }}>
              {skuBusy ? 'Saving…' : editing ? 'Save Changes' : 'Save SKU to Master'}
            </button>
          </div>
        </form>
      </FormShell>
    );
  }

  /* ── dedicated vendor page ── */

  if (vendorDraft) {
    const editing = Boolean(vendorDraft.vendor_id);
    return (
      <FormShell
        title={editing ? `Edit Vendor · ${vendorDraft.code}` : 'Register New Vendor'}
        hint="Supplier master: statutory IDs (GSTIN / PAN), contact details and delivery tolerances"
        icon={<Users size={22} />}
        onBack={() => setVendorDraft(null)}
      >
        <form onSubmit={submitVendor} data-testid="ven-form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Vendor Code">
              <input className="form-input" data-testid="ven-code" required
                value={vendorDraft.code}
                onChange={(e) => setVendorDraft({ ...vendorDraft, code: e.target.value })}
                placeholder="e.g. V-ACME" />
            </Field>
            <Field label="Legal / Trade Name">
              <input className="form-input" data-testid="ven-name" required
                value={vendorDraft.name}
                onChange={(e) => setVendorDraft({ ...vendorDraft, name: e.target.value })} />
            </Field>
            <Field label="Organisation Entity">
              <input className="form-input" data-testid="ven-org"
                value={vendorDraft.org_entity}
                onChange={(e) => setVendorDraft({ ...vendorDraft, org_entity: e.target.value })}
                placeholder="e.g. Acme Foods Pvt Ltd" />
            </Field>
            <Field label="GSTIN">
              <input className="form-input" data-testid="ven-gstin" maxLength={15}
                value={vendorDraft.gstin}
                onChange={(e) => setVendorDraft({ ...vendorDraft, gstin: e.target.value.toUpperCase() })}
                placeholder="27AABCU9603R1ZM" />
            </Field>
            <Field label="PAN">
              <input className="form-input" data-testid="ven-pan" maxLength={10}
                value={vendorDraft.pan}
                onChange={(e) => setVendorDraft({ ...vendorDraft, pan: e.target.value.toUpperCase() })}
                placeholder="AABCU9603R" />
            </Field>
            <Field label="Contact Name">
              <input className="form-input" data-testid="ven-contact-name"
                value={vendorDraft.contact_name}
                onChange={(e) => setVendorDraft({ ...vendorDraft, contact_name: e.target.value })} />
            </Field>
            <Field label="Contact Phone">
              <input className="form-input" data-testid="ven-contact-phone"
                value={vendorDraft.contact_phone}
                onChange={(e) => setVendorDraft({ ...vendorDraft, contact_phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <input type="email" className="form-input" data-testid="ven-email"
                value={vendorDraft.email}
                onChange={(e) => setVendorDraft({ ...vendorDraft, email: e.target.value })} />
            </Field>
            <Field label="Address" span={2}>
              <textarea className="form-input" data-testid="ven-address" rows={2}
                value={vendorDraft.address}
                onChange={(e) => setVendorDraft({ ...vendorDraft, address: e.target.value })} />
            </Field>
            <Field label="Over-delivery tolerance (%)">
              <input type="number" min="0" max="100" step="0.01" className="form-input" data-testid="ven-over"
                value={vendorDraft.over_delivery_pct}
                onChange={(e) => setVendorDraft({ ...vendorDraft, over_delivery_pct: e.target.value })} />
            </Field>
            <Field label="Under-delivery tolerance (%)">
              <input type="number" min="0" max="100" step="0.01" className="form-input" data-testid="ven-under"
                value={vendorDraft.under_delivery_pct}
                onChange={(e) => setVendorDraft({ ...vendorDraft, under_delivery_pct: e.target.value })} />
            </Field>
            <Field label="Status">
              <select className="form-input" data-testid="ven-status"
                value={vendorDraft.status}
                onChange={(e) => setVendorDraft({ ...vendorDraft, status: e.target.value })}>
                {VENDOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          {vendorError && (
            <div className="scan-feedback scan-feedback--error" data-testid="ven-error">
              <AlertTriangle size={14} /> <span>{vendorError}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
            <button type="button" className="btn-secondary" onClick={() => setVendorDraft(null)}
              style={{ padding: '10px 20px', fontWeight: 600 }} data-testid="ven-cancel">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={vendorBusy} data-testid="ven-save"
              style={{ background: '#7c3aed', color: '#fff', padding: '10px 24px', fontWeight: 700, fontSize: 14 }}>
              {vendorBusy ? 'Saving…' : editing ? 'Save Changes' : 'Save Vendor'}
            </button>
          </div>
        </form>
      </FormShell>
    );
  }

  const tabBtn = (id, label) => (
    <button
      key={id}
      className={`subtab-btn ${activeSubtab === id ? 'active' : ''}`}
      data-testid={`mc-tab-${id}`}
      onClick={() => setActiveSubtab(id)}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="subtabs-bar">
        {tabBtn('skus', 'SKUs Catalog')}
        {tabBtn('categories', 'Categories')}
        {tabBtn('vendors', 'Vendors')}
        {tabBtn('listings', 'Store Listings')}
        {tabBtn('vehicle-types', 'Vehicle Types')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn-secondary" onClick={loadData} disabled={loading} data-testid="mc-refresh"
          style={{ height: 30, padding: '0 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={13} /> Refresh
        </button>
        {!canWrite && (
          <span className="badge badge-default" data-testid="mc-readonly">
            Read-only — catalog changes need SUPER_ADMIN or OPS_MANAGER
          </span>
        )}
        {loading && <span className="form-hint" data-testid="mc-loading">Loading master data…</span>}
      </div>

      {loadError && (
        <div className="scan-feedback scan-feedback--error" data-testid="mc-load-error">
          <AlertTriangle size={14} /> <span>{loadError}</span>
        </div>
      )}

      {activeSubtab === 'skus' && (
        <DataTable
          data-testid="sku-table"
          title="Product SKUs Master Catalog"
          subtitle="Master product records, EAN barcodes, MRP, storage requirements and photos"
          onAdd={canWrite ? () => openSkuForm(null) : undefined}
          addLabel="Add New SKU"
          columns={[
            {
              header: 'Image', key: 'image_url',
              render: r => (
                <div style={{
                  width: 34, height: 34, borderRadius: 6, overflow: 'hidden', background: '#f1f5f9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0',
                }}>
                  {r.image_url ? (
                    <img src={r.image_url} alt="" data-testid={`sku-image-${r.sku_code}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  ) : <ImagePlus size={15} color="#94a3b8" />}
                </div>
              ),
            },
            { header: 'SKU Code', key: 'sku_code', render: r => <span className="code-cell">{r.sku_code}</span> },
            { header: 'Product Name', key: 'name', render: r => <strong>{r.name}</strong> },
            { header: 'Category', key: 'category_name', render: r => <span>{r.category_name || 'Uncategorised'}</span> },
            { header: 'EAN Barcode', key: 'ean', render: r => <span style={{ fontFamily: 'monospace' }}>{r.ean || '—'}</span> },
            { header: 'MRP', key: 'mrp', render: r => money(r.mrp) },
            { header: 'Brand', key: 'brand', render: r => r.brand || '—' },
            { header: 'Storage Zone', key: 'storage_zone' },
            { header: 'Status', key: 'status', render: r => statusBadge(r.status) },
            {
              header: 'Actions',
              render: r => (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }}
                    onClick={e => { e.stopPropagation(); setBarcodeSku(r); }}>
                    <Barcode size={12} /> {r.ean ? 'Add / Print' : 'Generate'}
                  </button>
                  {canWrite && (
                    <>
                      <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }}
                        data-testid={`sku-edit-${r.sku_code}`}
                        onClick={e => { e.stopPropagation(); openSkuForm(r); }}>
                        <Pencil size={12} /> Edit
                      </button>
                      <button className="btn-danger" style={{ fontSize: 11, padding: '4px 8px' }}
                        data-testid={`sku-del-${r.sku_code}`}
                        onClick={e => { e.stopPropagation(); removeSku(r); }}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
          data={skus}
        />
      )}

      {activeSubtab === 'categories' && (
        <>
          {canWrite && (
            <div className="wf-panel" style={{ marginBottom: 12 }}>
              <div className="wf-panel__header">
                <div>
                  <div className="wf-panel__title"><Tag size={16} /> Product categories</div>
                  <div className="wf-panel__hint">Taxonomy used by the SKU master and storefront browse.</div>
                </div>
                <div className="wf-panel__actions">
                  <button className="btn-primary" data-testid="cat-add"
                    onClick={() => { setCatOpen(v => !v); setCatError(''); }}>
                    <Plus size={14} /> Add Category
                  </button>
                </div>
              </div>
              {catOpen && (
                <form onSubmit={submitCategory} data-testid="cat-form"
                  style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', padding: '0 16px 16px' }}>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: 220 }}>
                    <label className="form-label">Category name</label>
                    <input className="form-input" data-testid="cat-name" required
                      value={catDraft.name}
                      onChange={e => setCatDraft({ ...catDraft, name: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
                    <label className="form-label">Parent (optional)</label>
                    <select className="form-input" data-testid="cat-parent"
                      value={catDraft.parent}
                      onChange={e => setCatDraft({ ...catDraft, parent: e.target.value })}>
                      <option value="">— Top level —</option>
                      {categories.map(c => (
                        <option key={c.category_id} value={String(c.category_id)}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn-primary" disabled={catBusy} data-testid="cat-save">
                    {catBusy ? 'Saving…' : 'Save Category'}
                  </button>
                </form>
              )}
              {catError && (
                <div className="scan-feedback scan-feedback--error" data-testid="cat-error">
                  <AlertTriangle size={14} /> <span>{catError}</span>
                </div>
              )}
            </div>
          )}
          <DataTable
            data-testid="cat-table"
            title="Product Categories"
            subtitle="Product taxonomy for storage zone mapping"
            columns={[
              { header: 'Category ID', key: 'category_id', render: r => <span className="code-cell">{String(r.category_id).slice(0, 8)}</span> },
              { header: 'Category Name', key: 'name', render: r => <strong>{r.name}</strong> },
              { header: 'Parent', key: 'parent', render: r => (r.parent ? categoryName[String(r.parent)] || '—' : '—') },
              {
                header: 'SKUs', key: 'sku_count',
                render: r => String(skus.filter(s => String(s.category) === String(r.category_id)).length),
              },
              ...(canWrite ? [{
                header: 'Actions',
                render: r => (
                  <button className="btn-danger" style={{ fontSize: 11, padding: '4px 8px' }}
                    data-testid={`cat-del-${r.category_id}`}
                    onClick={e => { e.stopPropagation(); removeCategory(r); }}>
                    <Trash2 size={12} /> Delete
                  </button>
                ),
              }] : []),
            ]}
            data={categories}
          />
        </>
      )}

      {activeSubtab === 'vendors' && (
        <DataTable
          data-testid="ven-table"
          title="Vendors & Supplier Master"
          subtitle="Approved suppliers, GSTIN / PAN tax details and delivery tolerances"
          onAdd={canWrite ? () => openVendorForm(null) : undefined}
          addLabel="Add Vendor"
          columns={[
            { header: 'Vendor Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
            { header: 'Legal Name', key: 'name', render: r => <strong>{r.name}</strong> },
            { header: 'GSTIN', key: 'gstin', render: r => <span style={{ fontFamily: 'monospace' }}>{r.gstin || '—'}</span> },
            { header: 'PAN', key: 'pan', render: r => <span style={{ fontFamily: 'monospace' }}>{r.pan || '—'}</span> },
            {
              header: 'Contact', key: 'contact_name',
              render: r => (
                <span>
                  {r.contact_name || '—'}
                  {r.contact_phone ? <span className="wf-panel__hint"> · {r.contact_phone}</span> : null}
                </span>
              ),
            },
            { header: 'Status', key: 'status', render: r => statusBadge(r.status) },
            ...(canWrite ? [{
              header: 'Actions',
              render: r => (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }}
                    data-testid={`ven-edit-${r.code}`}
                    onClick={e => { e.stopPropagation(); openVendorForm(r); }}>
                    <Pencil size={12} /> Edit
                  </button>
                  <button className="btn-danger" style={{ fontSize: 11, padding: '4px 8px' }}
                    data-testid={`ven-del-${r.code}`}
                    onClick={e => { e.stopPropagation(); removeVendor(r); }}>
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              ),
            }] : []),
          ]}
          data={vendors}
        />
      )}

      {activeSubtab === 'listings' && (
        <>
          {canWrite && (
            <div className="wf-panel" style={{ marginBottom: 12 }}>
              <div className="wf-panel__header">
                <div>
                  <div className="wf-panel__title"><Store size={16} /> Store listings</div>
                  <div className="wf-panel__hint">
                    A SKU only reaches a storefront once it is listed at that site with a price.
                  </div>
                </div>
                <div className="wf-panel__actions">
                  <button className="btn-primary" data-testid="lst-add"
                    onClick={() => { setLstDraft(blankListing()); setLstError(''); }}>
                    <Plus size={14} /> Add Listing
                  </button>
                </div>
              </div>
              {lstDraft && (
                <form onSubmit={submitListing} data-testid="lst-form"
                  style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.8fr 0.8fr 0.8fr auto', gap: 12, padding: '0 16px 16px', alignItems: 'end' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">SKU</label>
                    <select className="form-input" data-testid="lst-sku" required
                      value={lstDraft.sku}
                      onChange={e => setLstDraft({ ...lstDraft, sku: e.target.value })}>
                      <option value="">— Select SKU —</option>
                      {skus.map(s => (
                        <option key={s.sku_id} value={String(s.sku_id)}>{s.sku_code} · {s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Site</label>
                    <select className="form-input" data-testid="lst-site" required
                      value={lstDraft.site}
                      onChange={e => setLstDraft({ ...lstDraft, site: e.target.value })}>
                      <option value="">— Select site —</option>
                      {sites.map(s => (
                        <option key={s.site_id} value={String(s.site_id)}>{s.code} · {s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Price ₹</label>
                    <input type="number" min="0" step="0.01" className="form-input" data-testid="lst-price" required
                      value={lstDraft.price}
                      onChange={e => setLstDraft({ ...lstDraft, price: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">MRP ₹</label>
                    <input type="number" min="0" step="0.01" className="form-input" data-testid="lst-mrp" required
                      value={lstDraft.mrp}
                      onChange={e => setLstDraft({ ...lstDraft, mrp: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Discount %</label>
                    <input type="number" min="0" max="100" step="0.01" className="form-input" data-testid="lst-discount"
                      value={lstDraft.discount_pct}
                      onChange={e => setLstDraft({ ...lstDraft, discount_pct: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" data-testid="lst-listed" checked={lstDraft.is_listed}
                        onChange={e => setLstDraft({ ...lstDraft, is_listed: e.target.checked })} />
                      Listed
                    </label>
                    <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" data-testid="lst-available" checked={lstDraft.is_available}
                        onChange={e => setLstDraft({ ...lstDraft, is_available: e.target.checked })} />
                      In stock
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn-secondary" onClick={() => setLstDraft(null)}
                      data-testid="lst-cancel">Cancel</button>
                    <button type="submit" className="btn-primary" disabled={lstBusy} data-testid="lst-save">
                      {lstBusy ? 'Saving…' : 'Save Listing'}
                    </button>
                  </div>
                </form>
              )}
              {lstError && (
                <div className="scan-feedback scan-feedback--error" data-testid="lst-error">
                  <AlertTriangle size={14} /> <span>{lstError}</span>
                </div>
              )}
            </div>
          )}
          <DataTable
            data-testid="lst-table"
            title="Store Listings"
            subtitle="Which SKUs are sellable, at what price, at which site"
            columns={[
              { header: 'SKU', key: 'sku_code', render: r => <span className="code-cell">{r.sku_code || String(r.sku).slice(0, 8)}</span> },
              { header: 'Product', key: 'sku_name', render: r => r.sku_name || '—' },
              { header: 'Site', key: 'site_code', render: r => <span className="code-cell">{r.site_code || String(r.site).slice(0, 8)}</span> },
              { header: 'Price', key: 'price', render: r => money(r.price) },
              { header: 'MRP', key: 'mrp', render: r => money(r.mrp) },
              { header: 'Discount', key: 'discount_pct', render: r => `${r.discount_pct ?? 0}%` },
              {
                header: 'Listed', key: 'is_listed',
                render: r => (
                  <button className={`badge ${r.is_listed ? 'badge-success' : 'badge-default'}`}
                    style={{ border: 'none', cursor: canWrite ? 'pointer' : 'default' }}
                    disabled={!canWrite} data-testid={`lst-toggle-listed-${r.listing_id}`}
                    onClick={e => { e.stopPropagation(); toggleListing(r, 'is_listed'); }}>
                    {r.is_listed ? 'LISTED' : 'HIDDEN'}
                  </button>
                ),
              },
              {
                header: 'Availability', key: 'is_available',
                render: r => (
                  <button className={`badge ${r.is_available ? 'badge-success' : 'badge-warning'}`}
                    style={{ border: 'none', cursor: canWrite ? 'pointer' : 'default' }}
                    disabled={!canWrite} data-testid={`lst-toggle-available-${r.listing_id}`}
                    onClick={e => { e.stopPropagation(); toggleListing(r, 'is_available'); }}>
                    {r.is_available ? 'AVAILABLE' : 'SOLD OUT'}
                  </button>
                ),
              },
              ...(canWrite ? [{
                header: 'Actions',
                render: r => (
                  <button className="btn-danger" style={{ fontSize: 11, padding: '4px 8px' }}
                    data-testid={`lst-del-${r.listing_id}`}
                    onClick={e => { e.stopPropagation(); removeListing(r); }}>
                    <Trash2 size={12} /> Remove
                  </button>
                ),
              }] : []),
            ]}
            data={listings}
          />
        </>
      )}

      {activeSubtab === 'vehicle-types' && (
        <DataTable
          data-testid="vt-table"
          title="Vehicle Types & Specifications"
          subtitle="Transport fleet vehicle specifications"
          columns={[
            { header: 'Type Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
            { header: 'LPN Capacity', key: 'capacity_lpns', render: r => `${r.capacity_lpns} LPNs` },
            { header: 'Temp Controlled', key: 'temp_controlled', render: r => (
              <span className={`badge ${r.temp_controlled ? 'badge-success' : 'badge-info'}`}>{r.temp_controlled ? 'YES' : 'NO'}</span>
            )},
          ]}
          data={vehicleTypes}
        />
      )}

      {barcodeSku && (
        <ProductBarcodeModal
          onClose={() => setBarcodeSku(null)}
          skus={[{ ...barcodeSku, sku_id: barcodeSku.sku_id ?? barcodeSku.id }]}
          preselectedSku={String(barcodeSku.sku_id ?? barcodeSku.id ?? '')}
        />
      )}
    </div>
  );
}
