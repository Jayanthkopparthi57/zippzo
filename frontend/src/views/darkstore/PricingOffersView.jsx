import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ImagePlus, PackagePlus, RefreshCw, Save, Search, Tag, Upload } from 'lucide-react';
import { describeError, fetchApi, patchApi, postApi, uploadFile } from '../../api/client';
import { useToast } from '../../components/ui/Toast';
import { asList } from './useDarkStore';

const localInputTime = (date) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
};

const newDateRange = () => ({
  valid_from: localInputTime(new Date()),
  valid_until: localInputTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
});

const emptyCoupon = () => ({
  code: '', title: '', description: '', discount_type: 'PERCENT',
  discount_value: '', min_order: '0', max_discount: '', ...newDateRange(),
});

const emptyCombo = () => ({
  title: '', description: '', fixed_price: '', items: [], ...newDateRange(),
});

const money = (value) => `₹${Number(value || 0).toFixed(2)}`;
const endpointError = (name, error) => error?.status === 404
  ? `${name} API route not found. Restart or redeploy the Django API with the latest code.`
  : `${name}: ${describeError(error)}`;

function ProductThumbnail({ sku }) {
  const [broken, setBroken] = useState(false);
  if (!sku.image_url || broken) {
    return <span className="pricing-offers__image-placeholder"><ImagePlus size={16} /></span>;
  }
  return <img src={sku.image_url} alt="" onError={() => setBroken(true)} />;
}

export default function PricingOffersView({ site }) {
  const toast = useToast();
  const siteId = site?.site_id;
  const [section, setSection] = useState('pricing');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [comboSearch, setComboSearch] = useState('');
  const [search, setSearch] = useState('');
  const [skus, setSkus] = useState([]);
  const [categories, setCategories] = useState([]);
  const [skuCategoryEdits, setSkuCategoryEdits] = useState({});
  const [listings, setListings] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [combos, setCombos] = useState([]);
  const [couponForm, setCouponForm] = useState(emptyCoupon);
  const [editingCoupon, setEditingCoupon] = useState('');
  const [comboForm, setComboForm] = useState(emptyCombo);
  const [editingCombo, setEditingCombo] = useState('');
  const [uploadingSku, setUploadingSku] = useState('');

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError('');
    const requests = [
      // Stock & Bin Operations shows every SKU with a balance, including
      // draft/approved ones. Pricing must offer those same products, so do
      // not filter by status here.
      ['products', fetchApi('/catalog/skus/?page_size=1000'), setSkus],
      ['categories', fetchApi('/catalog/categories/?page_size=500'), setCategories],
      ['store prices', fetchApi(`/catalog/listings/?site=${encodeURIComponent(siteId)}&page_size=1000`), setListings],
      ['coupons', fetchApi(`/catalog/coupons/?management=true&site=${encodeURIComponent(siteId)}&page_size=500`), setCoupons],
      ['combo offers', fetchApi(`/catalog/combo-offers/?management=true&site=${encodeURIComponent(siteId)}&page_size=500`), setCombos],
    ];
    const results = await Promise.allSettled(requests.map(([, request]) => request));
    const messages = [];
    results.forEach((result, index) => {
      const [name, , setValue] = requests[index];
      if (result.status === 'fulfilled') {
        try {
          setValue(asList(result.value, name));
        } catch (loadError) {
          messages.push(`${name}: ${loadError.message}`);
        }
      } else {
        messages.push(endpointError(name, result.reason));
      }
    });
    setError(messages.join(' '));
    setLoading(false);
  }, [siteId]);

  useEffect(() => { load(); }, [load]);

  const listingBySku = useMemo(
    () => Object.fromEntries(listings.map((row) => [row.sku, row])),
    [listings],
  );
  const skuById = useMemo(
    () => Object.fromEntries(skus.map((sku) => [sku.sku_id, sku])),
    [skus],
  );
  const visibleSkus = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return skus.filter((sku) => !needle
      || [sku.sku_code, sku.name, sku.brand, sku.ean, sku.category_name, sku.sub_category]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));
  }, [search, skus]);
  const comboSkus = useMemo(() => {
    const needle = comboSearch.trim().toLowerCase();
    return skus.filter((sku) => !needle
      || [sku.sku_code, sku.name, sku.brand, sku.ean]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));
  }, [comboSearch, skus]);

  const saveListing = async (sku) => {
    const row = listingBySku[sku.sku_id];
    const price = row?.price ?? '';
    const mrp = row?.mrp || sku.mrp || '';
    if (!price || !mrp || Number(price) <= 0 || Number(mrp) < Number(price)) {
      toast.error('Invalid price', 'Enter a selling price above zero and an MRP at least as high.');
      return;
    }
    setSaving(`listing-${sku.sku_id}`);
    try {
      const categoryEdit = skuCategoryEdits[sku.sku_id];
      if (categoryEdit && (categoryEdit.category !== (sku.category || null) || categoryEdit.sub_category !== (sku.sub_category || ''))) {
        await patchApi(`/catalog/skus/${sku.sku_id}/`, {
          category: categoryEdit.category || null,
          sub_category: categoryEdit.sub_category || '',
        });
        setSkuCategoryEdits((current) => {
          const next = { ...current };
          delete next[sku.sku_id];
          return next;
        });
      }
      const payload = {
        sku: sku.sku_id,
        site: site.site_id,
        price: Number(price).toFixed(2),
        mrp: Number(mrp).toFixed(2),
        is_listed: row?.is_listed ?? true,
        is_available: row?.is_available ?? true,
        low_stock_threshold: row?.low_stock_threshold ?? null,
      };
      if (row?.listing_id) await patchApi(`/catalog/listings/${row.listing_id}/`, payload);
      else await postApi('/catalog/listings/', payload);
      toast.success('Price saved', sku.name);
      await load();
    } catch (saveError) {
      toast.error('Price not saved', describeError(saveError) || 'Could not save this store price.');
    } finally {
      setSaving('');
    }
  };

  const updateListing = (skuId, field, value) => {
    setListings((current) => {
      const existing = current.find((row) => row.sku === skuId);
      if (existing) return current.map((row) => row.sku === skuId ? { ...row, [field]: value } : row);
      const sku = skuById[skuId];
      return [...current, {
        sku: skuId,
        site: site.site_id,
        price: '',
        mrp: sku?.mrp || '',
        is_listed: true,
        is_available: true,
        [field]: value,
      }];
    });
  };

  const uploadProductImage = async (sku, file) => {
    if (!file) return;
    setUploadingSku(sku.sku_id);
    try {
      const uploaded = await uploadFile('/catalog/skus/image-upload/', file);
      await patchApi(`/catalog/skus/${sku.sku_id}/`, { image_url: uploaded.image_url });
      setSkus((current) => current.map((item) => item.sku_id === sku.sku_id
        ? { ...item, image_url: uploaded.image_url } : item));
      toast.success('Product photo saved', sku.name);
    } catch (uploadError) {
      toast.error('Photo not uploaded', describeError(uploadError));
    } finally {
      setUploadingSku('');
    }
  };

  const saveCoupon = async (event) => {
    event.preventDefault();
    setSaving('coupon');
    try {
      const payload = {
        ...couponForm,
        code: couponForm.code.trim().toUpperCase(),
        site: site.site_id,
        discount_value: Number(couponForm.discount_value).toFixed(2),
        min_order: Number(couponForm.min_order || 0).toFixed(2),
        max_discount: couponForm.max_discount === '' ? null : Number(couponForm.max_discount).toFixed(2),
        valid_from: new Date(couponForm.valid_from).toISOString(),
        valid_until: new Date(couponForm.valid_until).toISOString(),
      };
      if (editingCoupon) await patchApi(`/catalog/coupons/${editingCoupon}/`, payload);
      else await postApi('/catalog/coupons/', payload);
      toast.success(editingCoupon ? 'Coupon updated' : 'Coupon created');
      setCouponForm(emptyCoupon());
      setEditingCoupon('');
      await load();
    } catch (saveError) {
      toast.error('Coupon not saved', describeError(saveError) || 'Could not save this coupon.');
    } finally {
      setSaving('');
    }
  };

  const editCoupon = (coupon) => {
    setEditingCoupon(coupon.coupon_id);
    setCouponForm({
      code: coupon.code,
      title: coupon.title,
      description: coupon.description || '',
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      min_order: coupon.min_order,
      max_discount: coupon.max_discount ?? '',
      valid_from: localInputTime(new Date(coupon.valid_from)),
      valid_until: localInputTime(new Date(coupon.valid_until)),
    });
  };

  const toggleCoupon = async (coupon) => {
    setSaving(`coupon-${coupon.coupon_id}`);
    try {
      await patchApi(`/catalog/coupons/${coupon.coupon_id}/`, { is_active: !coupon.is_active });
      await load();
    } catch (saveError) {
      toast.error('Coupon status not changed', describeError(saveError) || 'Could not update coupon status.');
    } finally {
      setSaving('');
    }
  };

  const saveCombo = async (event) => {
    event.preventDefault();
    if (comboForm.items.length < 1) {
      toast.error('Combo needs products', 'Select at least one product for the combo.');
      return;
    }
    setSaving('combo');
    try {
      const payload = {
        title: comboForm.title.trim(),
        description: comboForm.description,
        site: site.site_id,
        fixed_price: Number(comboForm.fixed_price).toFixed(2),
        valid_from: new Date(comboForm.valid_from).toISOString(),
        valid_until: new Date(comboForm.valid_until).toISOString(),
        items: comboForm.items.map((item) => ({
          sku: item.sku,
          quantity: Number(item.quantity),
        })),
      };
      if (editingCombo) await patchApi(`/catalog/combo-offers/${editingCombo}/`, payload);
      else await postApi('/catalog/combo-offers/', payload);
      toast.success(editingCombo ? 'Combo offer updated' : 'Combo offer created');
      setComboForm(emptyCombo());
      setEditingCombo('');
      await load();
    } catch (saveError) {
      toast.error('Combo not saved', describeError(saveError) || 'Could not save this combo offer.');
    } finally {
      setSaving('');
    }
  };

  const editCombo = (combo) => {
    setEditingCombo(combo.offer_id);
    setComboForm({
      title: combo.title,
      description: combo.description || '',
      fixed_price: combo.fixed_price,
      valid_from: localInputTime(new Date(combo.valid_from)),
      valid_until: localInputTime(new Date(combo.valid_until)),
      items: (combo.items || []).map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
      })),
    });
  };

  const toggleCombo = async (combo) => {
    setSaving(`combo-${combo.offer_id}`);
    try {
      await patchApi(`/catalog/combo-offers/${combo.offer_id}/`, { is_active: !combo.is_active });
      await load();
    } catch (saveError) {
      toast.error('Combo status not changed', describeError(saveError) || 'Could not update combo status.');
    } finally {
      setSaving('');
    }
  };

  const setComboSku = (skuId, checked) => {
    setComboForm((current) => ({
      ...current,
      items: checked
        ? [...current.items, { sku: skuId, quantity: 1 }]
        : current.items.filter((item) => item.sku !== skuId),
    }));
  };

  if (!site?.site_id) {
    return <div className="alert alert-error">Select a dark store to manage its pricing and offers.</div>;
  }

  const sectionHint = {
    pricing: 'Set the customer price and category for every product sold at this store. Save a row and it is live immediately.',
    coupons: 'Create a coupon code, choose where it applies, then set its value and validity window.',
    combos: 'Group products into one bundled price to increase basket size at this store.',
  }[section];

  return (
    <section className="pricing-offers">
      <header className="pricing-offers__header">
        <div>
          <h1>Pricing &amp; offers</h1>
          <p>Manage {site.name || site.code} customer prices, coupons, and multi-item deals.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </header>
      <nav className="pricing-offers__tabs" aria-label="Pricing and offer sections">
        <button type="button" className={section === 'pricing' ? 'active' : ''} onClick={() => setSection('pricing')}>
          Store prices <span className="pricing-offers__count">{listings.length}</span>
        </button>
        <button type="button" className={section === 'coupons' ? 'active' : ''} onClick={() => setSection('coupons')}>
          Coupons <span className="pricing-offers__count">{coupons.length}</span>
        </button>
        <button type="button" className={section === 'combos' ? 'active' : ''} onClick={() => setSection('combos')}>
          Combo offers <span className="pricing-offers__count">{combos.length}</span>
        </button>
      </nav>
      <p className="pricing-offers__hint" aria-live="polite">{sectionHint}</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {loading && <div className="pricing-offers__loading">Loading store pricing and offers...</div>}

      {section === 'pricing' && (
        <div className="datagrid-card">
          <div className="datagrid-toolbar">
            <strong>Store-specific selling prices</strong>
            <label className="pricing-offers__search">
              <Search size={14} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find product" />
            </label>
          </div>
          <div className="datagrid-table-wrap">
            <table className="datagrid-table">
              <thead><tr><th>Product</th><th>Category (shopper filter)</th><th>Sub-category</th><th>MRP</th><th>Selling price</th><th>Discount</th><th>Shopper status</th><th /></tr></thead>
              <tbody>
                {visibleSkus.map((sku) => {
                  const listing = listingBySku[sku.sku_id] || {};
                  const price = Number(listing.price || 0);
                  const mrp = Number(listing.mrp || sku.mrp || 0);
                  const pct = mrp > 0 && price > 0 ? Math.max(0, Math.round((1 - price / mrp) * 100)) : 0;
                  return (
                    <tr key={sku.sku_id}>
                      <td>
                        <div className="pricing-offers__sku">
                          <ProductThumbnail sku={sku} />
                          <span><strong>{sku.name}</strong><small>{sku.sku_code}{sku.status && sku.status !== 'ACTIVE' ? ` · ${sku.status}` : ''} · {sku.pack_size || sku.brand || 'Product'}</small></span>
                        </div>
                      </td>
                      <td>
                        <select aria-label={`Category for ${sku.name}`} value={(skuCategoryEdits[sku.sku_id]?.category ?? sku.category ?? '')}
                          onChange={(event) => setSkuCategoryEdits((current) => ({ ...current, [sku.sku_id]: { category: event.target.value || null, sub_category: current[sku.sku_id]?.sub_category ?? sku.sub_category ?? '' } }))}>
                          <option value="">Uncategorized</option>
                          {categories.map((category) => (
                            <option key={category.category_id} value={category.category_id}>{category.name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input aria-label={`Sub-category for ${sku.name}`} type="text" placeholder="e.g. Grains & Rice"
                          value={skuCategoryEdits[sku.sku_id]?.sub_category ?? sku.sub_category ?? ''}
                          onChange={(event) => setSkuCategoryEdits((current) => ({ ...current, [sku.sku_id]: { category: current[sku.sku_id]?.category ?? sku.category ?? null, sub_category: event.target.value } }))} />
                      </td>
                      <td><input aria-label={`MRP for ${sku.name}`} type="number" min="0.01" step="0.01"
                        value={listing.mrp ?? sku.mrp ?? ''} onChange={(event) => updateListing(sku.sku_id, 'mrp', event.target.value)} /></td>
                      <td><input aria-label={`Selling price for ${sku.name}`} type="number" min="0.01" step="0.01"
                        value={listing.price ?? ''} onChange={(event) => updateListing(sku.sku_id, 'price', event.target.value)} /></td>
                      <td>{pct > 0 ? `${pct}% off` : '—'}</td>
                      <td>
                        <label className="pricing-offers__check">
                          <input type="checkbox" checked={Boolean(listing.is_listed && listing.is_available)}
                            onChange={(event) => {
                              updateListing(sku.sku_id, 'is_listed', event.target.checked);
                              updateListing(sku.sku_id, 'is_available', event.target.checked);
                            }} />
                          Listed
                        </label>
                      </td>
                      <td>
                        <div className="pricing-offers__actions">
                          <button type="button" className="btn btn-secondary" onClick={() => document.getElementById(`sku-image-${sku.sku_id}`)?.click()}
                            disabled={uploadingSku === sku.sku_id}>
                            <Upload size={13} /> {uploadingSku === sku.sku_id ? 'Uploading' : 'Photo'}
                          </button>
                          <input id={`sku-image-${sku.sku_id}`} type="file" accept="image/png,image/jpeg,image/webp"
                            hidden onChange={(event) => {
                              uploadProductImage(sku, event.target.files?.[0]);
                              event.target.value = '';
                            }} />
                          <button type="button" className="btn btn-primary" onClick={() => saveListing(sku)}
                            disabled={saving === `listing-${sku.sku_id}`}>
                            <Save size={13} /> {saving === `listing-${sku.sku_id}` ? 'Saving' : 'Save'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!visibleSkus.length && <tr><td colSpan="8">No active products found.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="pricing-offers__hint">Category and sub-category drive the shopper app filter rail (a product with no category lands under “Others”). A selling price below MRP appears as a sale in the shopper app. Products need good stock in a sellable bin to be shown. Upload a PNG, JPEG, or WebP product photo here (max 2 MB); it will appear in the shopper app too.</p>
        </div>
      )}

      {section === 'coupons' && (
        <div className="pricing-offers__columns">
          <form className="pricing-offers__form datagrid-card" onSubmit={saveCoupon}>
            <h2><Tag size={16} /> {editingCoupon ? 'Edit coupon' : 'Create coupon'}</h2>
            <label>Coupon code<input required maxLength="30" value={couponForm.code}
              onChange={(event) => setCouponForm({ ...couponForm, code: event.target.value.toUpperCase() })} /></label>
            <label>Shopper title<input required maxLength="120" value={couponForm.title}
              onChange={(event) => setCouponForm({ ...couponForm, title: event.target.value })} /></label>
            <label>Description<input maxLength="300" value={couponForm.description}
              onChange={(event) => setCouponForm({ ...couponForm, description: event.target.value })} /></label>
            <div className="pricing-offers__form-row">
              <label>Discount type<select value={couponForm.discount_type}
                onChange={(event) => setCouponForm({ ...couponForm, discount_type: event.target.value })}>
                <option value="PERCENT">Percentage</option><option value="FLAT">Flat amount</option>
              </select></label>
              <label>{couponForm.discount_type === 'PERCENT' ? 'Percent off' : 'Amount off'}
                <input required type="number" min="0.01" step="0.01" value={couponForm.discount_value}
                  onChange={(event) => setCouponForm({ ...couponForm, discount_value: event.target.value })} />
              </label>
            </div>
            <div className="pricing-offers__form-row">
              <label>Minimum basket<input type="number" min="0" step="0.01" value={couponForm.min_order}
                onChange={(event) => setCouponForm({ ...couponForm, min_order: event.target.value })} /></label>
              <label>Max discount<input type="number" min="0" step="0.01" value={couponForm.max_discount}
                onChange={(event) => setCouponForm({ ...couponForm, max_discount: event.target.value })} /></label>
            </div>
            <div className="pricing-offers__form-row">
              <label>Starts<input required type="datetime-local" value={couponForm.valid_from}
                onChange={(event) => setCouponForm({ ...couponForm, valid_from: event.target.value })} /></label>
              <label>Ends<input required type="datetime-local" value={couponForm.valid_until}
                onChange={(event) => setCouponForm({ ...couponForm, valid_until: event.target.value })} /></label>
            </div>
            <div className="pricing-offers__actions">
              <button type="submit" className="btn btn-primary" disabled={saving === 'coupon'}>
                <Save size={14} /> {saving === 'coupon' ? 'Saving...' : editingCoupon ? 'Update coupon' : 'Create coupon'}
              </button>
              {editingCoupon && <button type="button" className="btn btn-secondary" onClick={() => {
                setCouponForm(emptyCoupon()); setEditingCoupon('');
              }}>Cancel</button>}
            </div>
          </form>
          <div className="datagrid-card">
            <div className="datagrid-toolbar"><strong>Store coupons</strong></div>
            <div className="pricing-offers__cards">
              {coupons.map((coupon) => (
                <article className="pricing-offers__offer" key={coupon.coupon_id}>
                  <div><strong>{coupon.code}</strong><span>{coupon.title}</span></div>
                  <p>{coupon.description || `${coupon.discount_value}${coupon.discount_type === 'PERCENT' ? '%' : ' off'}`}</p>
                  <small>Min. basket {money(coupon.min_order)} · ends {new Date(coupon.valid_until).toLocaleDateString()}</small>
                  <div className="pricing-offers__actions">
                    <button type="button" className="btn btn-secondary" onClick={() => editCoupon(coupon)}>Edit</button>
                    <button type="button" className="btn btn-secondary" onClick={() => toggleCoupon(coupon)}
                      disabled={saving === `coupon-${coupon.coupon_id}`}>
                      {coupon.is_active ? 'Pause' : 'Activate'}
                    </button>
                  </div>
                </article>
              ))}
              {!coupons.length && <div className="pricing-offers__empty">No coupons configured for this store.</div>}
            </div>
          </div>
        </div>
      )}

      {section === 'combos' && (
        <div className="pricing-offers__columns">
          <form className="pricing-offers__form datagrid-card" onSubmit={saveCombo}>
            <h2><PackagePlus size={16} /> {editingCombo ? 'Edit combo offer' : 'Create combo offer'}</h2>
            <label>Offer title<input required maxLength="120" value={comboForm.title}
              onChange={(event) => setComboForm({ ...comboForm, title: event.target.value })} /></label>
            <label>Description<input maxLength="300" value={comboForm.description}
              onChange={(event) => setComboForm({ ...comboForm, description: event.target.value })} /></label>
            <label>Combo price<input required type="number" min="0.01" step="0.01" value={comboForm.fixed_price}
              onChange={(event) => setComboForm({ ...comboForm, fixed_price: event.target.value })} /></label>
            <div className="pricing-offers__form-row">
              <label>Starts<input required type="datetime-local" value={comboForm.valid_from}
                onChange={(event) => setComboForm({ ...comboForm, valid_from: event.target.value })} /></label>
              <label>Ends<input required type="datetime-local" value={comboForm.valid_until}
                onChange={(event) => setComboForm({ ...comboForm, valid_until: event.target.value })} /></label>
            </div>
            <div className="pricing-offers__product-picker">
              <strong>Products in this combo</strong>
              <label className="pricing-offers__combo-search">
                <Search size={14} />
                <input value={comboSearch} onChange={(event) => setComboSearch(event.target.value)}
                  placeholder="Search products to add" aria-label="Search combo products" />
              </label>
              <p className="pricing-offers__hint">Select products with a saved, listed store price. Add missing prices in Store prices first.</p>
              {comboSkus.map((sku) => {
                const selected = comboForm.items.find((item) => item.sku === sku.sku_id);
                const listing = listingBySku[sku.sku_id];
                const isListed = Boolean(listing?.listing_id && listing.is_listed && listing.is_available
                  && Number(listing.price) > 0);
                return (
                  <label key={sku.sku_id}>
                    <input type="checkbox" checked={Boolean(selected)} disabled={!isListed}
                      onChange={(event) => setComboSku(sku.sku_id, event.target.checked)} />
                    <span className="pricing-offers__combo-product">
                      <ProductThumbnail sku={sku} />
                      <span>{sku.name}<small>{isListed ? money(listing.price) : 'Set store price first'}</small></span>
                    </span>
                    {selected && <input aria-label={`Quantity of ${sku.name}`} type="number" min="1" max="99"
                      value={selected.quantity} onChange={(event) => setComboForm((current) => ({
                        ...current,
                        items: current.items.map((item) => item.sku === sku.sku_id
                          ? { ...item, quantity: event.target.value } : item),
                      }))} />}
                  </label>
                );
              })}
              {!comboSkus.length && <p className="pricing-offers__empty">No active products match this search.</p>}
            </div>
            <div className="pricing-offers__actions">
              <button type="submit" className="btn btn-primary" disabled={saving === 'combo'}>
                <Save size={14} /> {saving === 'combo' ? 'Saving...' : editingCombo ? 'Update combo' : 'Create combo'}
              </button>
              {editingCombo && <button type="button" className="btn btn-secondary" onClick={() => {
                setComboForm(emptyCombo()); setEditingCombo('');
              }}>Cancel</button>}
            </div>
          </form>
          <div className="datagrid-card">
            <div className="datagrid-toolbar"><strong>Store combo offers</strong></div>
            <div className="pricing-offers__cards">
              {combos.map((combo) => (
                <article className="pricing-offers__offer" key={combo.offer_id}>
                  <div><strong>{combo.title}</strong><span>{money(combo.fixed_price)}</span></div>
                  <p>{combo.description || (combo.items || []).map((item) =>
                    `${item.quantity} × ${skuById[item.sku]?.name || item.sku}`).join(' + ')}</p>
                  <small>Ends {new Date(combo.valid_until).toLocaleDateString()}</small>
                  <div className="pricing-offers__actions">
                    <button type="button" className="btn btn-secondary" onClick={() => editCombo(combo)}>Edit</button>
                    <button type="button" className="btn btn-secondary" onClick={() => toggleCombo(combo)}
                      disabled={saving === `combo-${combo.offer_id}`}>
                      {combo.is_active ? 'Pause' : 'Activate'}
                    </button>
                  </div>
                </article>
              ))}
              {!combos.length && <div className="pricing-offers__empty">No combo offers configured for this store.</div>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
