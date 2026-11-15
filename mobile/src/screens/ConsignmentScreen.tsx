import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, TextInput } from 'react-native';
import { useAuth } from '../auth';
import { api, errMsg, extractList } from '../api';
import { Asn, Grn, GrnLine, Sku } from '../types';
import { Header, C, Chip, PrimaryBtn, SearchRow, Empty } from '../components/Ui';
import { Scanner } from '../components/Scanner';
import { skuMatches } from '../utils';

/**
 * Step 1 of Inbound — Create a consignment to inbound products by scanning.
 *
 * Backend contract (existing):
 *   POST /supply/asns/            -> ASN (auto-numbered)  { type, dest_site, po_ref }
 *   POST /supply/asn-lines/       -> add a declared SKU    { asn, sku, ean, ordered_qty }
 *   POST /supply/grns/            -> GRN linked to the ASN  { asn, mode }
 *   POST /supply/grn-lines/       -> received units         { grn, sku, ordered_qty, received_qty, ... }
 *   POST /supply/grns/{id}/complete/
 *
 * If an ASN barcode is scanned we resume that ASN; otherwise we create one.
 * Products are added by scanning barcodes; each scan resolves to a SKU
 * (sku_code / ean / barcode) and bumps received_qty for that SKU.
 */
export default function ConsignmentScreen({ onBack }: { onBack: () => void }) {
  const { facility } = useAuth();
  const [asns, setAsns] = useState<Asn[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [asn, setAsn] = useState<Asn | null>(null);
  const [grn, setGrn] = useState<Grn | null>(null);
  const [lines, setLines] = useState<GrnLine[]>([]);
  const [skuCache, setSkuCache] = useState<Record<string, Sku>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [scanTarget, setScanTarget] = useState<null | 'consignment' | 'product'>(null);
  const [scanQuery, setScanQuery] = useState('');
  const [qty, setQty] = useState('1');

  const siteId = facility?.site_id || '';

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, g] = await Promise.all([
        api.listAsns({ search: '' }).catch(() => [] as Asn[]),
        api.listGrns({}).catch(() => [] as Grn[]),
      ]);
      setAsns(a);
      setGrns(g);
    } catch (e) {
      setError(errMsg(e, 'Could not load consignments'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const loadLines = useCallback(async (grnId: string) => {
    try {
      const rows = await api.listGrnLines({ grn: grnId });
      setLines(rows);
      // Warm the SKU cache so renders can show names without extra calls.
      const next: Record<string, Sku> = {};
      for (const l of rows) {
        if (l.sku_code) next[l.sku] = { sku_id: l.sku, sku_code: l.sku_code, name: l.sku_name || l.sku_code } as Sku;
      }
      setSkuCache((prev) => ({ ...prev, ...next }));
    } catch (e) {
      setError(errMsg(e, 'Could not load receiving lines'));
    }
  }, []);

  const resolveSku = async (code: string): Promise<Sku | null> => {
    // 1) Exact SKU id / code / ean search.
    const hits = await api.searchSku(code, 20).catch(() => [] as Sku[]);
    const exact = hits.find((h) => skuMatches(code, h));
    if (exact) return exact;
    // 2) Barcode table. Only accept a row whose barcode IS the scanned code —
    // the endpoint filters, but never trust a search response to be scoped.
    const bc = await api.searchBarcode(code).catch(() => [] as any[]);
    const normCode = String(code).trim().toLowerCase();
    for (const row of bc) {
      if (String(row?.barcode || '').trim().toLowerCase() !== normCode) continue;
      const sku = row.sku || row.sku_id;
      if (sku && typeof row.sku === 'string') {
        const fetched = await api.getSku(row.sku).catch(() => null);
        if (fetched) return fetched as Sku;
      }
      if (row.sku && typeof row.sku === 'object' && row.sku.sku_id) {
        const fetched = await api.getSku(row.sku.sku_id).catch(() => null);
        if (fetched) return fetched as Sku;
      }
      if (row.sku_id) {
        const fetched = await api.getSku(row.sku_id).catch(() => null);
        if (fetched) return fetched as Sku;
      }
    }
    // 3) Fall back to the first hit — the operator scanned something known.
    return hits[0] || null;
  };

  const ensureAsnGrn = async (existingAsn?: Asn | null): Promise<{ asn: Asn; grn: Grn }> => {
    if (!siteId) throw new Error('No facility set. Choose a facility first.');
    let curAsn = existingAsn ?? asn;
    if (!curAsn) {
      curAsn = await api.createAsn({ type: 'VENDOR_PO', dest_site: siteId, package_type: 'TOTE', po_ref: '' });
      setAsn(curAsn);
      setAsns((prev) => [curAsn!, ...prev]);
    }
    let curGrn = grn;
    if (!curGrn) {
      // Reuse an open GRN for this ASN if one exists.
      const open = grns.find((g) => g.asn === curAsn.asn_id && g.status !== 'COMPLETED');
      if (open) {
        curGrn = open;
      } else {
        curGrn = await api.createGrn({ asn: curAsn.asn_id, mode: 'LPN_SCAN' });
        setGrns((prev) => [curGrn!, ...prev]);
      }
      setGrn(curGrn);
    }
    await loadLines(curGrn.grn_id);
    return { asn: curAsn, grn: curGrn };
  };

  const addProduct = async (code: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const { grn: curGrn, asn: curAsn } = await ensureAsnGrn();
      const sku = await resolveSku(code);
      if (!sku) throw new Error(`Unknown barcode "${code}". It is not in the catalogue.`);
      setSkuCache((prev) => ({ ...prev, [sku.sku_id]: sku }));

      const n = Math.max(1, parseInt(qty, 10) || 1);
      const existing = lines.find((l) => l.sku === sku.sku_id);
      if (existing) {
        const updated = await api.updateGrnLine(existing.line_id, {
          received_qty: (existing.received_qty || 0) + n,
          ordered_qty: Math.max(existing.ordered_qty || 0, (existing.received_qty || 0) + n),
        });
        setLines((prev) => prev.map((l) => (l.line_id === existing.line_id ? updated : l)));
        setInfo(`Added ${n} × ${sku.sku_code} (now ${updated.received_qty}).`);
      } else {
        // Declare the SKU on the ASN too (best effort; GRN is the source of truth).
        await api.createAsnLine({ asn: curAsn.asn_id, sku: sku.sku_id, ean: code, ordered_qty: n }).catch(() => null);
        const created = await api.createGrnLine({
          grn: curGrn.grn_id,
          sku: sku.sku_id,
          ordered_qty: n,
          received_qty: n,
        });
        setLines((prev) => [...prev, created]);
        setInfo(`Added ${n} × ${sku.sku_code} — ${sku.name}`);
      }
      setScanQuery('');
    } catch (e) {
      setError(errMsg(e, 'Could not add product'));
    } finally {
      setBusy(false);
    }
  };

  const handleConsignmentScan = async (code: string) => {
    setScanTarget(null);
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const hits = await api.listAsns({ search: code }).catch(() => [] as Asn[]);
      const found = hits.find((a) => a.asn_no === code || normEq(a.asn_no, code));
      if (found) {
        setAsn(found);
        const grnHits = await api.listGrns({ asn: found.asn_id }).catch(() => [] as Grn[]);
        const open = grnHits.find((g) => g.status !== 'COMPLETED') || grnHits[0];
        if (open) {
          setGrn(open);
          await loadLines(open.grn_id);
        } else {
          setGrn(null);
        }
        setInfo(`Resumed consignment ${found.asn_no}. Scan products to receive.`);
      } else {
        // Treat the scan as the PO / vendor reference for a brand-new ASN.
        if (!siteId) throw new Error('No facility selected.');
        const created = await api.createAsn({ type: 'VENDOR_PO', dest_site: siteId, package_type: 'TOTE', po_ref: code });
        setAsn(created);
        setAsns((prev) => [created, ...prev]);
        const newGrn = await api.createGrn({ asn: created.asn_id, mode: 'LPN_SCAN' });
        setGrn(newGrn);
        setGrns((prev) => [newGrn, ...prev]);
        setLines([]);
        setInfo(`Created consignment ${created.asn_no}${code ? ` for reference ${code}` : ''}. Scan products.`);
      }
    } catch (e) {
      setError(errMsg(e, 'Could not open consignment'));
    } finally {
      setBusy(false);
    }
  };

  // A GRN line with no lot never mints a PutawayTask (sync_putaway_task
  // requires lot_id + COMPLETED GRN — see bounded/supply/views.py and the
  // web ensureLot in InboundReceivingView). Assign/create a lot per SKU
  // before closing, or QC-passed stock would have nowhere to go.
  const ensureLotForLine = async (line: GrnLine): Promise<string | null> => {
    if (line.lot) return String(line.lot);
    if (!siteId) throw new Error('No facility selected.');
    const batchCode = (grn?.batch_code || asn?.asn_no || (asn as any)?.po_ref || `BATCH-${new Date().toISOString().slice(0, 10)}`).slice(0, 30);
    const existing = await api.listLots({ sku: line.sku, site: siteId, batch_number: batchCode }).catch(() => [] as any[]);
    if (existing.length) return String(existing[0].lot_id || existing[0].id);
    const created = await api.createLot({
      sku: line.sku,
      site: siteId,
      batch_number: batchCode,
      box_size: 1,
      bucket: 'Good',
      status: 'AVAILABLE',
      inbound_type: String(asn?.type || 'VENDOR_PO').slice(0, 10),
      inbound_ref: asn?.asn_no || '',
    });
    return String(created.lot_id || created.id);
  };

  const completeGrn = async () => {
    if (!grn) return;
    setBusy(true);
    setError(null);
    try {
      if (!lines.length) throw new Error('Scan at least one product first.');
      // Assign lots first (best-effort per line), then close.
      const patched: GrnLine[] = [];
      for (const l of lines) {
        if ((l.received_qty || 0) <= 0) throw new Error(`${l.sku_code || l.sku} has nothing received.`);
        let lot = l.lot ? String(l.lot) : null;
        if (!lot) {
          lot = await ensureLotForLine(l);
        }
        const updated = await api.updateGrnLine(l.line_id, { accepted_qty: l.accepted_qty || 0, lot });
        patched.push(updated);
      }
      setLines(patched);
      const res = await api.completeGrn(grn.grn_id);
      setInfo(
        res?.putaway_task_count
          ? `Receiving closed. ${res.putaway_task_count} putaway task(s) raised — continue to Q.C. then Putaway.`
          : 'Receiving closed. Continue to Q.C. — accepted units will mint putaway tasks on verify.',
      );
      loadList();
    } catch (e) {
      setError(errMsg(e, 'Could not close receiving'));
    } finally {
      setBusy(false);
    }
  };

  const newConsignment = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!siteId) throw new Error('No facility selected.');
      const created = await api.createAsn({ type: 'VENDOR_PO', dest_site: siteId, package_type: 'TOTE' });
      const newGrn = await api.createGrn({ asn: created.asn_id, mode: 'LPN_SCAN' });
      setAsn(created);
      setGrn(newGrn);
      setLines([]);
      setAsns((prev) => [created, ...prev]);
      setGrns((prev) => [newGrn, ...prev]);
      setInfo(`Created consignment ${created.asn_no}.`);
    } catch (e) {
      setError(errMsg(e, 'Could not create consignment'));
    } finally {
      setBusy(false);
    }
  };

  const resume = async (a: Asn, g?: Grn) => {
    setAsn(a);
    if (g) {
      setGrn(g);
      await loadLines(g.grn_id);
    } else {
      setGrn(null);
      setLines([]);
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Header title="1 · Consignment" subtitle={`Receiving at ${facility?.code || ''}`} onBack={onBack} />

      {error ? <Text style={s.error}>{error}</Text> : null}
      {info ? <Text style={s.info}>{info}</Text> : null}

      {/* Current consignment */}
      {asn || grn ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>
            {asn ? `${asn.asn_no} · ${asn.type}` : 'Consignment'} {grn ? `· ${grn.grn_no}` : ''}
          </Text>
          <Chip tone={grn?.status === 'COMPLETED' ? 'green' : 'blue'}>{grn?.status || 'OPEN'}</Chip>
          <View style={s.row}>
            <PrimaryBtn onPress={newConsignment} disabled={busy}>New consignment</PrimaryBtn>
          </View>
        </View>
      ) : null}

      {/* Actions */}
      <View style={s.actions}>
        <TouchableOpacity style={s.action} onPress={() => setScanTarget('consignment')} disabled={busy}>
          <Text style={s.actionTitle}>📦 Scan consignment</Text>
          <Text style={s.actionDesc}>Vendor / transfer barcode or ASN no.</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.action} onPress={() => setScanTarget('product')} disabled={busy}>
          <Text style={s.actionTitle}>▦ Scan product</Text>
          <Text style={s.actionDesc}>Each scan adds units to this receipt.</Text>
        </TouchableOpacity>
      </View>

      <SearchRow
        value={scanQuery}
        onChange={setScanQuery}
        placeholder="Type barcode / SKU / EAN and Add"
        onScan={() => setScanTarget('product')}
        onSubmit={() => { if (scanQuery.trim()) addProduct(scanQuery.trim()); }}
      />
      <View style={s.qtyRow}>
        <Text style={s.lab}>Qty per scan</Text>
        <TextInput style={s.qty} value={qty} onChangeText={(v) => setQty(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
        <TouchableOpacity style={s.addBtn} onPress={() => scanQuery.trim() && addProduct(scanQuery.trim())} disabled={busy}>
          <Text style={s.addBtnText}>{busy ? 'Adding…' : 'Add product'}</Text>
        </TouchableOpacity>
      </View>

      {/* Received lines */}
      <Text style={s.section}>Received lines ({lines.length})</Text>
      {loading ? (
        <ActivityIndicator color={C.yellow} />
      ) : lines.length === 0 ? (
        <Empty msg="Nothing received yet. Scan the consignment first, then scan each product." />
      ) : (
        lines.map((l) => (
          <View key={l.line_id} style={s.line}>
            <View style={{ flex: 1 }}>
              <Text style={s.lineTitle}>{l.sku_code || skuCache[l.sku]?.sku_code || l.sku.slice(0, 8)}</Text>
              <Text style={s.lineSub}>{l.sku_name || skuCache[l.sku]?.name || ''}</Text>
            </View>
            <Text style={s.lineQty}>{l.received_qty} received</Text>
          </View>
        ))
      )}

      {grn ? (
        <PrimaryBtn onPress={completeGrn} disabled={busy || !lines.length} color="#059669">
          {busy ? 'Working…' : 'Close receiving → Q.C.'}
        </PrimaryBtn>
      ) : null}

      {/* Open consignments */}
      <Text style={s.section}>Open consignments</Text>
      {asns.filter((a) => a.status !== 'CLOSED' && a.status !== 'CANCELLED').slice(0, 10).map((a) => (
        <TouchableOpacity key={a.asn_id} style={s.listRow} onPress={() => resume(a, grns.find((g) => g.asn === a.asn_id && g.status !== 'COMPLETED'))}>
          <View style={{ flex: 1 }}>
            <Text style={s.lineTitle}>{a.asn_no}</Text>
            <Text style={s.lineSub}>{a.type} · {a.dest_site_code || ''} · {a.total_qty || a.lines?.length || 0} units</Text>
          </View>
          <Chip tone="muted">{a.status}</Chip>
        </TouchableOpacity>
      ))}

      <Text style={s.section}>Receiving notes (GRNs)</Text>
      {grns.slice(0, 10).map((g) => (
        <TouchableOpacity key={g.grn_id} style={s.listRow} onPress={() => { setGrn(g); setAsn(asns.find((a) => a.asn_id === g.asn) || asn); loadLines(g.grn_id); }}>
          <View style={{ flex: 1 }}>
            <Text style={s.lineTitle}>{g.grn_no}</Text>
            <Text style={s.lineSub}>{g.asn_no || ''} · {g.status}</Text>
          </View>
          <Chip tone={g.status === 'COMPLETED' ? 'green' : 'amber'}>{g.status}</Chip>
        </TouchableOpacity>
      ))}

      {busy ? <ActivityIndicator color={C.yellow} style={{ marginTop: 12 }} /> : null}

      <Scanner
        visible={scanTarget === 'consignment'}
        title="Scan consignment"
        subtitle="Scan the vendor / transfer label or ASN barcode"
        onScan={handleConsignmentScan}
        onClose={() => setScanTarget(null)}
      />
      <Scanner
        visible={scanTarget === 'product'}
        title="Scan product"
        subtitle="Scan a product barcode to add it to this receipt"
        onScan={(code) => { setScanTarget(null); addProduct(code); }}
        onClose={() => setScanTarget(null)}
      />
    </ScrollView>
  );
}

function normEq(a?: string | null, b?: string) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  error: { color: '#b91c1c', backgroundColor: '#fecaca', padding: 10, borderRadius: 10, marginBottom: 8 },
  info: { color: '#6ee7b7', backgroundColor: '#064e3b', padding: 10, borderRadius: 10, marginBottom: 8 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  cardTitle: { fontWeight: '800', color: C.text, fontSize: 15, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  action: { flex: 1, backgroundColor: 'rgba(124,92,255,0.16)', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(124,92,255,0.5)' },
  actionTitle: { color: '#e0f2fe', fontWeight: '800', fontSize: 15 },
  actionDesc: { color: '#c4b5fd', fontSize: 12, marginTop: 4, lineHeight: 16 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  lab: { color: C.sub, fontSize: 12 },
  qty: { width: 70, backgroundColor: C.card, color: C.text, borderRadius: 8, padding: 8, borderWidth: 1, borderColor: C.border, textAlign: 'center' },
  addBtn: { flex: 1, backgroundColor: C.blue, padding: 10, borderRadius: 8, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: '700' },
  section: { color: C.text, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.card, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  lineTitle: { color: C.text, fontWeight: '700' },
  lineSub: { color: C.sub, fontSize: 12, marginTop: 2 },
  lineQty: { color: '#c4b5fd', fontWeight: '700' },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.card, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border },
});
