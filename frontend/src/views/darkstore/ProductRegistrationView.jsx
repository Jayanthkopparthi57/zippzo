import React, { useMemo, useRef, useState } from 'react';
import { Check, PackagePlus, RefreshCw } from 'lucide-react';
import StoreGate from './StoreGate';
import { useDarkStore, useAsyncData, asList } from './useDarkStore';
import { useAuth } from '../../context/AuthContext';
import ScanInput from '../../components/ui/ScanInput';
import { fetchApi, patchApi, postApi, uploadFile, describeError } from '../../api/client';

const emptyForm = (scan = '') => ({
  scan,
  skuId: '',
  skuCode: '',
  name: '',
  brand: '',
  packSize: '',
  category: '',
  mrp: '',
  price: '',
  imageUrl: '',
  photos: ['', '', ''],
  bin: '',
  qty: '',
  approver: '',
});

function Registration({ siteId, storeCode }) {
  const { user } = useAuth();
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [message, setMessage] = useState(null);
  const [notice, setNotice] = useState(null);

  const { data: listingRows, reload: reloadListings } = useAsyncData(
    () => siteId ? fetchApi(`/catalog/listings/?site=${encodeURIComponent(siteId)}&page_size=1000`).then((r) => asList(r, '/catalog/listings')) : Promise.resolve([]),
    [siteId],
  );
  const { data: categoryRows } = useAsyncData(
    () => fetchApi('/catalog/categories/?page_size=500').then((r) => asList(r, '/catalog/categories')),
    [],
  );
  const { data: binRows } = useAsyncData(
    () => siteId ? fetchApi(`/network/locations/?site=${encodeURIComponent(siteId)}&page_size=500`).then((r) => asList(r, '/network/locations')) : Promise.resolve([]),
    [siteId],
  );
  const { data: userRows, reload: reloadUsers } = useAsyncData(
    () => fetchApi('/iam/users/?page_size=500').then((r) => asList(r, '/iam/users')),
    [],
  );
  const nameRef = useRef(null);

  // The opening-stock POST requires a *different* estate-role approver than the
  // person requesting it. Offering the signed-in user made the save fail with a
  // bare 400, so drop them from the list.
  const admins = useMemo(() => {
    const meId = String(user?.user_id || '');
    const meEmail = String(user?.email || '').trim().toLowerCase();
    return (userRows || []).filter((u) => {
      if (!['SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER'].includes(u.role)) return false;
      if (meId && String(u.user_id) === meId) return false;
      if (meEmail && String(u.email || '').trim().toLowerCase() === meEmail) return false;
      return true;
    });
  }, [userRows, user?.user_id, user?.email]);

  // What the scanned code most likely is, used to file the barcode and the EAN
  // correctly instead of saving everything as CODE128.
  const detectSymbology = (code) => {
    const c = String(code || '').trim();
    if (/^\d{12}$/.test(c)) return 'UPC';
    if (/^(\d{8}|\d{13}|\d{14})$/.test(c)) return 'EAN';
    return 'CODE128';
  };

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const onPickImage = async (event, slot = 0) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploadingImage(true);
    setMessage(null);
    try {
      const res = await uploadFile('/catalog/skus/image-upload/', file);
      const url = res.image_url;
      setForm((current) => {
        const photos = [...(current.photos || ['', '', ''])];
        photos[slot] = url;
        const first = photos.find((p) => p);
        return { ...current, photos, imageUrl: first || '' };
      });
      setMessage({ type: 'ok', message: `Photo ${slot + 1} uploaded. Save the product to keep it.` });
    } catch (error) {
      setMessage({ type: 'error', message: describeError(error) || 'Could not upload the photo. Only PNG, JPEG or WebP up to 2 MB.' });
    } finally {
      setUploadingImage(false);
    }
  };

  const lookup = async (event, explicitCode) => {
    event?.preventDefault?.();
    const code = String(explicitCode ?? form.scan).trim();
    if (!code) return;
    setBusy('lookup');
    setMessage(null);
    setNotice(null);
    try {
      const results = asList(await fetchApi(`/catalog/skus/?search=${encodeURIComponent(code)}&page_size=50`), '/catalog/skus');
      const upper = code.toUpperCase();
      const existing = results.find((sku) => [sku.sku_code, sku.ean].some((value) => String(value || '').toUpperCase() === upper))
        || (results.length === 1 ? results[0] : null);
      if (existing) {
        const listing = (listingRows || []).find((row) => String(row.sku) === String(existing.sku_id)) || {};
        let profilePhotos = ['', '', ''];
        if (siteId) {
          try {
            const profiles = asList(
              await fetchApi(`/catalog/store-profiles/?site=${encodeURIComponent(siteId)}&sku=${encodeURIComponent(existing.sku_id)}&page_size=5`),
              '/catalog/store-profiles',
            );
            const wanted = (profiles[0]?.images || []).slice(0, 3);
            wanted.forEach((url, i) => { if (i < 3) profilePhotos[i] = url; });
          } catch {
            // profile is optional; the SKU photo still goes on the product
          }
        }
        if (profilePhotos.every((p) => !p) && existing.image_url) profilePhotos[0] = existing.image_url;
        setForm({
          ...emptyForm(code),
          skuId: existing.sku_id,
          skuCode: existing.sku_code,
          name: existing.name || '',
          brand: existing.brand || '',
          packSize: existing.pack_size || '',
          category: existing.category || '',
          mrp: existing.mrp || listing.mrp || '',
          price: listing.price || '',
          imageUrl: profilePhotos[0] || '',
          photos: [...profilePhotos],
        });
        setMessage({ type: 'ok', message: `${existing.name} loaded. Set price, bin and quantity, then Save.` });
      } else {
        setForm(emptyForm(code));
        setMessage({ type: 'hint', message: 'New product. The SKU code will be generated automatically on save — enter name, brand, price and MRP.' });
        // The barcode is already in the form; jump the employee straight to
        // the first blank required field.
        setTimeout(() => nameRef.current?.focus(), 0);
      }
    } catch (error) {
      setMessage({ type: 'error', message: error.message || 'Could not look up this barcode.' });
    } finally {
      setBusy('');
    }
  };

  const save = async (event) => {
    event.preventDefault();
    const price = Number(form.price);
    const mrp = Number(form.mrp);
    if (!form.scan.trim()) {
      setMessage({ type: 'error', message: 'Scan or enter the pack barcode first. Every product must carry one so it can be found at the shelf, QC and putaway.' });
      return;
    }
    if (!form.name.trim()) {
      setMessage({ type: 'error', message: 'Product name is required. The SKU code is generated automatically.' });
      return;
    }
    if (!(price > 0) || !(mrp > 0)) {
      setMessage({ type: 'error', message: 'MRP and shelf price must be more than zero.' });
      return;
    }
    if (mrp < price) {
      setMessage({ type: 'error', message: 'MRP cannot be lower than the shelf price.' });
      return;
    }
    const openingQty = Number(form.qty || 0);
    if (openingQty > 0 && !form.bin) {
      setMessage({ type: 'error', message: 'Pick a storage bin before adding stock.' });
      return;
    }
    if (openingQty > 0 && !form.approver) {
      setMessage({ type: 'error', message: 'Pick another estate user to approve the opening stock entry. The backend rejects self-approval.' });
      return;
    }
    setBusy('save');
    setMessage(null);
    setNotice(null);
    try {
      const skuPayload = {
        name: form.name.trim(),
        brand: form.brand.trim(),
        pack_size: form.packSize.trim(),
        category: form.category || null,
        mrp: mrp.toFixed(2),
        image_url: form.imageUrl.trim(),
        status: 'ACTIVE',
      };
      const isNew = !form.skuId;
      const saved = form.skuId
        ? await patchApi(`/catalog/skus/${form.skuId}/`, skuPayload)
        : await postApi('/catalog/skus/', { ...skuPayload, ean: /^\d{8,14}$/.test(form.scan.trim()) ? form.scan.trim() : null });
      const skuId = saved.sku_id || form.skuId;
      const skuCode = saved.sku_code || form.skuCode || '';

      if (form.scan.trim()) {
        await postApi('/catalog/barcodes/', {
          barcode: form.scan.trim(),
          symbology: detectSymbology(form.scan),
          sku: skuId,
          pack_level: 'EACH',
          qty_in_base: 1,
          is_primary: true,
          is_active: true,
        }).catch(() => null);
      }

      const currentListing = (listingRows || []).find((row) => String(row.sku) === String(skuId));
      const listingPayload = {
        sku: skuId,
        site: siteId,
        price: price.toFixed(2),
        mrp: mrp.toFixed(2),
        is_listed: true,
        is_available: true,
      };
      if (currentListing?.listing_id) await patchApi(`/catalog/listings/${currentListing.listing_id}/`, listingPayload);
      else await postApi('/catalog/listings/', listingPayload);

      // Persist the gallery (up to 3 shots) into the site-specific profile so
      // the shopper app sees every photo. SKU.image_url keeps the first shot.
      const photos = (form.photos || []).filter(Boolean).slice(0, 3);
      if (siteId) {
        const existingProfile = async () => {
          try {
            const rows = asList(
              await fetchApi(`/catalog/store-profiles/?site=${encodeURIComponent(siteId)}&sku=${encodeURIComponent(skuId)}&page_size=5`),
              '/catalog/store-profiles',
            );
            return rows[0] || null;
          } catch {
            return null;
          }
        };
        const profile = await existingProfile();
        const profilePayload = {
          site: siteId,
          sku: skuId,
          images: photos,
          display_name: form.name.trim(),
          display_brand: form.brand.trim(),
          category: form.category || null,
        };
        try {
          if (profile?.profile_id) await patchApi(`/catalog/store-profiles/${profile.profile_id}/`, profilePayload);
          else await postApi('/catalog/store-profiles/', profilePayload);
        } catch {
          // Profile persistence is best-effort; the listing already works.
        }
      }

      let stockNotice = '';
      if (openingQty > 0) {
        const lot = await postApi('/catalog/lots/', {
          sku: skuId,
          site: siteId,
          batch_number: `S-${Date.now()}`.slice(0, 40),
          inbound_type: 'SCAN',
          inbound_ref: skuCode,
          bucket: 'Good',
          status: 'AVAILABLE',
        });
        await postApi('/inventory/adjustments/', {
          site_code: storeCode,
          sku_id: skuId,
          lot_id: lot.lot_id,
          container: 'BIN',
          container_ref: form.bin,
          qty_delta: openingQty,
          reason: `Opening stock: ${form.name.trim()}`,
          approved_by: form.approver,
          idempotency_key: `REG-${skuCode}-${Date.now()}`,
        });
        stockNotice = `${openingQty} unit(s) placed in ${form.bin}.`;
      }

      setForm(emptyForm());
      await Promise.all([reloadListings({ quiet: true }), reloadUsers({ quiet: true })]);
      setMessage({ type: 'ok', message: `${isNew ? 'Product registered' : 'Product updated'}${skuCode ? ` as ${skuCode}` : ''} and listed for ${storeCode}.${stockNotice ? ' ' + stockNotice : ''}` });
    } catch (error) {
      setMessage({ type: 'error', message: describeError(error) || 'Could not save the product.' });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="product-registration">
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>PRODUCT REGISTRATION</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Scan a barcode, fill the details below, save. The product is listed for this store instantly.
          </div>
        </div>
        <button className="btn-ui neutral" onClick={() => Promise.all([reloadListings(), reloadUsers()])}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {message && (
        <div role="status" style={{
          padding: '10px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 12,
          border: '1px solid',
          borderColor: message.type === 'ok' ? 'var(--c-emerald)' : message.type === 'hint' ? 'var(--c-amber)' : 'var(--c-rust)',
          color: message.type === 'ok' ? 'var(--c-emerald)' : message.type === 'hint' ? 'var(--c-amber)' : 'var(--c-rust)',
        }}>{message.message}</div>
      )}
      {notice && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{notice}</div>}

      {/* Lookup row — system (wedge) scanners land here: the field is the
          largest element on screen, Enter submits, camera fallback included. */}
      <div style={{ marginBottom: 14 }}>
        <ScanInput
          label="Scan barcode or type SKU code"
          placeholder="e.g. 8900002201 or OATS-TEST-1 — press Enter"
          value={form.scan}
          onChange={(code) => set('scan', code)}
          onScan={(code) => lookup(null, code)}
          busy={busy === 'lookup'}
          cameraLabel="Camera"
          dataTestId="registration-scan"
          feedback={null}
        />
      </div>

      <form className="wf-panel product-form" onSubmit={save}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">SKU code</label>
            <input className="form-input mono-num" value={form.skuCode} readOnly aria-readonly
              placeholder="Auto-generated on save"
              title="The SKU code is minted automatically from the category when you save" />
          </div>
          <div className="form-group">
            <label className="form-label">Product name *</label>
            <input ref={nameRef} className="form-input" autoFocus={!!form.scan && !form.skuId} value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">Brand</label>
            <input className="form-input" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="e.g. Quaker" />
          </div>
          <div className="form-group">
            <label className="form-label">Pack size</label>
            <input className="form-input" value={form.packSize} onChange={(e) => set('packSize', e.target.value)} placeholder="e.g. 500 g / 1 kg / 250 ml" />
          </div>
          <div className="form-group">
            <label className="form-label">Category</label>
            <select className="form-input" value={form.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">— None —</option>
              {(categoryRows || []).map((c) => (
                <option key={c.category_id} value={c.category_id}>{c.name}</option>
              ))}
            </select>
            {(categoryRows || []).length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                No categories yet. Create them in WMS → MH Configs → Catalog → Categories.
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">MRP (₹) *</label>
            <input className="form-input mono-num" type="number" min="0.01" step="0.01" value={form.mrp} onChange={(e) => set('mrp', e.target.value)} required />
          </div>
          <div className="form-group">
            <label className="form-label">Shelf price (₹) *</label>
            <input className="form-input mono-num" type="number" min="0.01" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} required />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Photos <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(up to 3 — the first one is the product's cover photo)</span></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {[0, 1, 2].map((slot) => {
                const url = form.photos?.[slot] || '';
                return (
                  <div key={slot} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                    <div style={{
                      width: 84, height: 84, borderRadius: 10,
                      border: url ? '1px solid var(--border-subtle)' : '1px dashed var(--border-subtle)',
                      background: url ? 'var(--bg-card)' : 'var(--bg-panel)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', color: 'var(--text-muted)', fontSize: 11, textAlign: 'center', padding: url ? 0 : 6,
                    }}>
                      {url ? (
                        <img src={url} alt={`Product shot ${slot + 1}`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        slot === 0 ? 'Cover' : `Shot ${slot + 1}`
                      )}
                    </div>
                    <input id={`product-photo-input-${slot}`} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onPickImage(e, slot)} style={{ display: 'none' }} />
                    {url ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <label htmlFor={`product-photo-input-${slot}`} className="btn-ui neutral" style={{ padding: '4px 9px', fontSize: 11, cursor: uploadingImage ? 'wait' : 'pointer', opacity: uploadingImage ? 0.6 : 1 }}>
                          {uploadingImage && slot === 0 ? 'Uploading…' : 'Change'}
                        </label>
                        <button type="button" className="btn-ui neutral" style={{ padding: '4px 9px', fontSize: 11 }}
                          disabled={uploadingImage}
                          onClick={() => setForm((current) => {
                            const photos = [...(current.photos || ['', '', ''])];
                            photos[slot] = '';
                            const first = photos.find((p) => p);
                            return { ...current, photos, imageUrl: first || '' };
                          })}>Remove</button>
                      </div>
                    ) : (
                      <label htmlFor={`product-photo-input-${slot}`} className="btn-ui neutral" style={{ padding: '4px 9px', fontSize: 11, cursor: uploadingImage ? 'wait' : 'pointer', opacity: uploadingImage ? 0.6 : 1 }}>
                        Add photo
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 8 }}>PNG, JPEG or WebP · max 2 MB each</span>
          </div>
          <div className="form-group">
            <label className="form-label">Storage bin</label>
            <select className="form-input" value={form.bin} onChange={(e) => set('bin', e.target.value)}>
              <option value="">— Pick a bin —</option>
              {(binRows || []).map((b) => (
                <option key={b.location_id || b.bin_id || b.id} value={b.label || b.barcode || b.code || b.name}>{b.label || b.barcode || b.code || b.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Initial quantity</label>
            <input className="form-input mono-num" type="number" min="0" step="1" value={form.qty} onChange={(e) => set('qty', e.target.value)} placeholder="0" />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Approver (only if stock is added) — a different estate user</label>
            <select className="form-input" value={form.approver} onChange={(e) => set('approver', e.target.value)}>
              <option value="">— Pick an approver —</option>
              {admins.length === 0 && <option value="" disabled>No other estate user is available — opening stock can’t be approved yet</option>}
              {admins.map((a) => (
                <option key={a.user_id} value={a.user_id}>{a.full_name || a.email} ({a.role})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-ui primary" disabled={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : <><PackagePlus size={13} /> Save product</>}
          </button>
        </div>
      </form>

      <style>{`
        .product-form .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
        .product-form .form-actions { display: flex; gap: 8px; margin-top: 14px; }
        @media (max-width: 720px) { .product-form .form-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

export default function ProductRegistrationView() {
  const { siteId, storeCode } = useDarkStore();
  return (
    <StoreGate>
      {siteId && <Registration siteId={siteId} storeCode={storeCode} />}
    </StoreGate>
  );
}
