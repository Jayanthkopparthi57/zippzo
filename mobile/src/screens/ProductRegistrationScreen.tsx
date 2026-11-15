import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput,
  ActivityIndicator, Alert, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { api, errMsg, mediaUrl } from '../api';
import { C, TOP_INSET } from '../components/Ui';

type Category = { category_id: string; name: string };
type Bin = { location_id: string; label: string; barcode?: string };
type Approver = { user_id: string; email: string; full_name: string; role: string };

export default function ProductRegistrationScreen({ onBack }: { onBack: () => void }) {
  const { facility, user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [bins, setBins] = useState<Bin[]>([]);
  // The opening-stock POST requires a *different* estate-role approver than the
  // person requesting it — the backend rejects self-approval, so drop the
  // signed-in user from the list. Estate callers only; field staff get a 403.
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [approver, setApprover] = useState<string>('');
  const [form, setForm] = useState({
    name: '', brand: '', packSize: '',
    mrp: '', price: '', scan: '', qty: '1',
  });
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [categoryId, setCategoryId] = useState<string>('');
  const [binLabel, setBinLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const siteId = facility?.site_id || '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, binRows, people] = await Promise.all([
        api.listCategories().catch(() => [] as Category[]),
        api.listBins({ search: '' }).catch(() => [] as any[]),
        api.listUsers().catch(() => [] as any[]),
      ]);
      setCategories(Array.isArray(cats) ? cats : []);
      const resolved: Bin[] = (binRows as any[]).map((r) => ({
        location_id: r.location_id || r.id || r.bin_id || '',
        label: r.label || r.barcode || r.code || r.name || '',
        barcode: r.barcode || r.label || r.code || '',
      }));
      setBins(resolved);
      const meId = String(user?.user_id || '');
      const meEmail = String(user?.email || '').trim().toLowerCase();
      setApprovers(
        (Array.isArray(people) ? people : []).filter((p: any) => {
          if (!['SUPER_ADMIN', 'ADMIN', 'OPS_MANAGER'].includes(p?.role)) return false;
          if (meId && String(p.user_id) === meId) return false;
          if (meEmail && String(p.email || '').trim().toLowerCase() === meEmail) return false;
          return true;
        }),
      );
    } catch {
      setCategories([]);
      setBins([]);
      setApprovers([]);
    } finally {
      setLoading(false);
    }
  }, [user?.user_id, user?.email]);

  useEffect(() => { load(); }, [load]);

  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos', 'Please allow photo library access to add a product photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setUploadingImage(true);
    setError(null);
    try {
      const uploaded = await api.uploadSkuImage({
        uri: asset.uri,
        name: asset.fileName || `photo-${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      });
      setImageUrl(uploaded.image_url);
    } catch (e) {
      setError(errMsg(e, 'Could not upload the photo'));
    } finally {
      setUploadingImage(false);
    }
  };

  const save = async () => {
    setError(null);
    setOk(null);
    if (!form.scan.trim()) {
      setError('Scan or enter the pack barcode first. Every product must carry one so it can be found at the shelf, QC and putaway.');
      return;
    }
    if (!form.name.trim() || !form.price || !form.mrp) {
      setError('Name, price and MRP are required. The SKU code is generated automatically.');
      return;
    }
    if (Number(form.price) <= 0 || Number(form.mrp) < Number(form.price)) {
      setError('Price must be greater than 0 and no higher than MRP.');
      return;
    }
    const qtyToAdd = Number(form.qty) || 0;
    if (qtyToAdd > 0) {
      if (!binLabel) {
        setError('Pick a bin for the initial stock — or set the quantity to 0.');
        return;
      }
      if (!approver) {
        setError('Opening stock needs another estate user to approve it. Pick an approver below.');
        return;
      }
    }
    setBusy(true);
    try {
      const sku = await api.createSku({
        name: form.name.trim(),
        brand: form.brand.trim(),
        pack_size: form.packSize.trim(),
        category: categoryId || null,
        mrp: Number(form.mrp).toFixed(2),
        image_url: imageUrl,
        status: 'ACTIVE',
        ean: /^\d{8,14}$/.test(form.scan.trim()) ? form.scan.trim() : null,
      });

      // barcode (if scanned)
      if (form.scan.trim()) {
        await api.createBarcode({
          barcode: form.scan.trim(),
          sku: sku.sku_id,
          symbology: 'CODE128',
          pack_level: 'EACH',
          qty_in_base: 1,
          is_primary: true,
          is_active: true,
        }).catch(() => null);
      }

      // listing at this site
      await api.createListing({
        sku: sku.sku_id,
        site: siteId,
        price: Number(form.price).toFixed(2),
        mrp: Number(form.mrp).toFixed(2),
        is_listed: true,
        is_available: true,
      });

      // store profile (shopper display)
      await api.createStoreProfile({
        site: siteId,
        sku: sku.sku_id,
        display_name: form.name.trim(),
        display_brand: form.brand.trim(),
        category: categoryId || null,
        images: imageUrl ? [imageUrl] : [],
      }).catch(() => null);

      // initial stock, if a bin and qty were given
      let stockWarning = '';
      if (qtyToAdd > 0 && binLabel && approver) {
        try {
          const lot = await api.createLot({
            sku: sku.sku_id,
            site: siteId,
            batch_number: `SCAN-${Date.now()}`.slice(0, 40),
            inbound_type: 'SCAN',
            inbound_ref: form.scan.trim() || sku.sku_code,
            bucket: 'Good',
            status: 'AVAILABLE',
          });
          await api.stockAdjustment({
            site_code: facility?.code,
            sku_id: sku.sku_id,
            lot_id: lot.lot_id,
            container: 'BIN',
            container_ref: binLabel,
            qty_delta: qtyToAdd,
            reason: `Initial stock of ${form.name.trim()}`,
            approved_by: approver,
            idempotency_key: `ADD-${Date.now()}`,
          });
        } catch (e) {
          // The product exists, but the stock entry failed — say why, don't hide it.
          stockWarning = `Initial stock was NOT added: ${errMsg(e, 'adjustment rejected')}`;
        }
      }

      setOk(`${sku.name} (${sku.sku_code}) added and listed at ${facility?.code || 'this store'}.${stockWarning ? ' ' + stockWarning : ''}`);
      setForm({ name: '', brand: '', packSize: '', mrp: '', price: '', scan: '', qty: '1' });
      setImageUrl('');
      setCategoryId('');
      setBinLabel('');
      setApprover('');
    } catch (e) {
      setError(errMsg(e, 'Could not add the product'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={C.yellow} size="large" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={onBack} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={20} color={C.yellow} />
        </TouchableOpacity>
        <Text style={s.title}>Add Product</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {error ? <Text style={s.error}>{error}</Text> : null}
        {ok ? <Text style={s.ok}>{ok}</Text> : null}

        <Text style={s.section}>Product details</Text>
        <View style={s.autoRow}>
          <Ionicons name="barcode-outline" size={16} color={C.faint} />
          <Text style={s.autoText}>SKU code is generated automatically on save</Text>
        </View>
        <TextInput style={s.input} placeholder="Product name *" placeholderTextColor={C.faint}
          value={form.name} onChangeText={set('name')} />
        <TextInput style={s.input} placeholder="Brand" placeholderTextColor={C.faint}
          value={form.brand} onChangeText={set('brand')} />
        <TextInput style={s.input} placeholder="Pack size (e.g. 1 kg)" placeholderTextColor={C.faint}
          value={form.packSize} onChangeText={set('packSize')} />
        <TextInput style={s.input} placeholder="Barcode / EAN * — required" placeholderTextColor={C.faint}
          autoCapitalize="none" autoCorrect={false} value={form.scan} onChangeText={set('scan')} />

        <Text style={s.section}>Photo</Text>
        <View style={s.photoRow}>
          {imageUrl ? (
            <Image source={{ uri: mediaUrl(imageUrl) }} style={s.photo} />
          ) : (
            <View style={[s.photo, s.photoEmpty]}>
              <Ionicons name="image-outline" size={28} color={C.faint} />
            </View>
          )}
          <View style={{ flex: 1, gap: 8 }}>
            <TouchableOpacity style={s.photoBtn} onPress={pickImage} disabled={uploadingImage}>
              {uploadingImage
                ? <ActivityIndicator color="#241503" />
                : <Text style={s.photoBtnText}>{imageUrl ? 'Change photo' : 'Add photo'}</Text>}
            </TouchableOpacity>
            {imageUrl ? (
              <TouchableOpacity onPress={() => setImageUrl('')} disabled={uploadingImage}>
                <Text style={s.photoRemove}>Remove photo</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={s.hint}>PNG, JPEG or WebP · max 2 MB</Text>
          </View>
        </View>

        <Text style={s.section}>Pricing</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput style={[s.input, { flex: 1 }]} placeholder="MRP ₹" placeholderTextColor={C.faint}
            keyboardType="decimal-pad" value={form.mrp} onChangeText={set('mrp')} />
          <TextInput style={[s.input, { flex: 1 }]} placeholder="Price ₹" placeholderTextColor={C.faint}
            keyboardType="decimal-pad" value={form.price} onChangeText={set('price')} />
        </View>

        <Text style={s.section}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
          <TouchableOpacity style={[s.chip, !categoryId && s.chipOn]} onPress={() => setCategoryId('')}>
            <Text style={[s.chipText, !categoryId && s.chipTextOn]}>None</Text>
          </TouchableOpacity>
          {categories.map((c) => (
            <TouchableOpacity key={c.category_id} style={[s.chip, categoryId === c.category_id && s.chipOn]} onPress={() => setCategoryId(c.category_id)}>
              <Text style={[s.chipText, categoryId === c.category_id && s.chipTextOn]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={s.section}>Initial stock</Text>
        <TextInput style={s.input} placeholder="Quantity to receive" placeholderTextColor={C.faint}
          keyboardType="number-pad" value={form.qty} onChangeText={set('qty')} />
        {Number(form.qty) > 0 ? (
          <>
            <Text style={s.section}>Approver — a different estate user</Text>
            {approvers.length === 0 ? (
              <Text style={s.hint}>No other estate user is visible to you, so opening stock can’t be approved. Ask your manager (or use the web console as an estate user).</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
                {approvers.map((a) => (
                  <TouchableOpacity key={a.user_id} style={[s.chip, approver === a.user_id && s.chipOn]} onPress={() => setApprover(a.user_id)}>
                    <Text style={[s.chipText, approver === a.user_id && s.chipTextOn]}>{a.full_name || a.email} · {a.role}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </>
        ) : null}

        <Text style={s.section}>Bin / shelf</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
          {bins.slice(0, 30).map((b) => (
            <TouchableOpacity key={b.location_id} style={[s.chip, binLabel === b.label && s.chipOn]} onPress={() => setBinLabel(b.label)}>
              <Text style={[s.chipText, binLabel === b.label && s.chipTextOn]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
          {bins.length === 0 ? <Text style={s.hint}>No bins found at this site.</Text> : null}
        </ScrollView>

        <TouchableOpacity style={s.saveBtn} onPress={save} disabled={busy}>
          {busy
            ? <ActivityIndicator color="#241503" />
            : <Text style={s.saveText}>Add product</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: TOP_INSET + 10, paddingHorizontal: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { color: C.text, fontSize: 17, fontWeight: '800' },

  section: { color: C.faint, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, marginTop: 16, marginBottom: 7 },
  input: {
    backgroundColor: C.card, color: C.text, borderRadius: 10, paddingHorizontal: 13,
    paddingVertical: 12, borderWidth: 1, borderColor: C.border, fontSize: 13.5, marginBottom: 8,
  },
  chip: { backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.border },
  chipOn: { borderColor: C.yellow, backgroundColor: 'rgba(109,74,255,0.12)' },
  chipText: { color: C.sub, fontSize: 11.5, fontWeight: '700' },
  chipTextOn: { color: C.yellow },
  hint: { color: C.faint, fontSize: 11.5, paddingVertical: 8 },
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 13, paddingVertical: 12, marginBottom: 8 },
  autoText: { color: C.faint, fontSize: 12.5, fontWeight: '600' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 12 },
  photo: { width: 84, height: 84, borderRadius: 10, backgroundColor: C.cardAlt },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoBtn: { backgroundColor: C.yellow, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  photoBtnText: { color: '#241503', fontWeight: '800', fontSize: 13 },
  photoRemove: { color: '#b91c1c', fontSize: 12, fontWeight: '700', textAlign: 'center' },

  saveBtn: {
    backgroundColor: C.yellow, borderRadius: 12, paddingVertical: 15,
    alignItems: 'center', marginTop: 18,
  },
  saveText: { color: '#241503', fontWeight: '900', fontSize: 14.5 },

  error: { color: '#b91c1c', fontSize: 12, marginBottom: 10 },
  ok: { color: '#6ee7b7', fontSize: 12, marginBottom: 10 },
});
