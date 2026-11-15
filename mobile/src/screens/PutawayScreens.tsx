import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { api, errMsg } from '../api';
import { LocationBin, PutawayTaskDetail } from '../types';
import { Header, C, Chip, PrimaryBtn, GhostBtn, SearchRow, Empty } from '../components/Ui';
import { Scanner } from '../components/Scanner';
import { binMatches, suggestedBinFor } from '../utils';

// ---------------- List ----------------
export function PutawayListScreen({
  tasks,
  onOpen,
  onBack,
  onRefresh,
}: {
  tasks: PutawayTaskDetail[];
  onOpen: (t: PutawayTaskDetail) => void;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const open = tasks.filter((t) => t.status !== 'CONFIRMED' && (t.remaining_qty ?? 0) > 0);
  const done = tasks.filter((t) => t.status === 'CONFIRMED');
  const [q, setQ] = useState('');
  const [scan, setScan] = useState(false);

  const filtered = (arr: PutawayTaskDetail[]) =>
    q.trim()
      ? arr.filter((t) => `${t.sku_code} ${t.sku_name} ${t.grn_no || ''} ${t.to_bin_code || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
      : arr;

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Header title="3 · Putaway" subtitle={`${open.length} QC-passed product(s) to shelve`} onBack={onBack} />
      <SearchRow value={q} onChange={setQ} placeholder="Search SKU / name / GRN" onScan={() => setScan(true)} />
      <TouchableOpacity style={s.refresh} onPress={onRefresh}><Text style={s.refreshText}>⟳ Refresh</Text></TouchableOpacity>

      {filtered(open).length === 0 ? (
        <Empty msg="No putaway pending. QC-passed stock will appear here." />
      ) : (
        filtered(open).map((t) => (
          <TouchableOpacity key={t.task_id} style={s.card} onPress={() => onOpen(t)}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{t.sku_code} — {t.sku_name}</Text>
              <Text style={s.cardSub}>
                {t.remaining_qty} of {t.qty} left · {t.lot_number ? `Lot ${t.lot_number} · ` : ''}{t.grn_no || t.asn_no || ''}
              </Text>
              {t.to_bin_code ? <Text style={s.cardSub}>Suggested: {t.to_bin_code}</Text> : null}
            </View>
            <Chip tone="blue">{t.status}</Chip>
          </TouchableOpacity>
        ))
      )}

      {done.length ? (
        <>
          <Text style={s.section}>Done today</Text>
          {done.slice(0, 10).map((t) => (
            <View key={t.task_id} style={[s.card, s.cardDone]}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{t.sku_code}</Text>
                <Text style={s.cardSub}>{t.qty} placed</Text>
              </View>
              <Chip tone="green">Done</Chip>
            </View>
          ))}
        </>
      ) : null}

      <Scanner
        visible={scan}
        title="Scan product"
        subtitle="Find the putaway card for this product"
        onScan={async (code) => {
          setScan(false);
          const c = code.trim();
          const sku = await api.resolveBarcodeToSku(c).catch(() => null);
          const hits = open.filter((t) =>
            (sku && t.sku === sku.sku_id) ||
            t.sku_code.toLowerCase() === c.toLowerCase() ||
            t.sku_name.toLowerCase().includes(c.toLowerCase()) ||
            (sku && t.sku_name === sku.name)
          );
          if (hits.length) onOpen(hits[0]);
          else setQ(code);
        }}
        onClose={() => setScan(false)}
      />
    </ScrollView>
  );
}

// ---------------- Detail ----------------
export function PutawayDetailScreen({
  task,
  onBack,
  onDone,
  onNext,
}: {
  task: PutawayTaskDetail;
  onBack: () => void;
  onDone: (t: PutawayTaskDetail) => void;
  onNext: () => void;
}) {
  const [bins, setBins] = useState<LocationBin[]>([]);
  const [binsLoading, setBinsLoading] = useState(true);
  const [productScan, setProductScan] = useState<string | null>(null);
  const [productMatch, setProductMatch] = useState<'match' | 'mismatch' | 'pending' | null>(null);
  const [binScan, setBinScan] = useState<string | null>(null);
  const [chosenBinId, setChosenBinId] = useState<string | null>(null);
  const [qty, setQty] = useState(task.remaining_qty || 1);
  const [scanTarget, setScanTarget] = useState<null | 'product' | 'bin'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadBins = useCallback(async () => {
    setBinsLoading(true);
    try {
      const rows = await api.listBins().catch(() => [] as LocationBin[]);
      setBins(rows);
      if (!chosenBinId && task.suggested_bin) setChosenBinId(task.suggested_bin);
    } catch (e) {
      setError(errMsg(e, 'Could not load storage bins'));
    } finally {
      setBinsLoading(false);
    }
  }, [task.suggested_bin]);

  useEffect(() => {
    loadBins();
    setQty(task.remaining_qty || 1);
    setProductScan(null);
    setProductMatch(null);
    setBinScan(null);
    setError(null);
    setInfo(null);
  }, [task.task_id]);

  const suggested = useMemo(() => suggestedBinFor(task, bins), [task, bins]);
  const chosenBin = useMemo(
    () => bins.find((b) => b.location_id === chosenBinId) || bins.find((b) => b.location_id === task.confirmed_bin) || suggested || null,
    [bins, chosenBinId, task.confirmed_bin, suggested],
  );

  const handleProductScan = useCallback((code: string) => {
    const c = code.trim();
    setProductScan(c);
    setProductMatch('pending');
    api.resolveBarcodeToSku(c)
      .then((sku) => setProductMatch(sku && sku.sku_id === task.sku ? 'match' : 'mismatch'))
      .catch(() => setProductMatch('mismatch'));
  }, [task.sku]);

  const productOk = productMatch === 'match';
  const binOk = binScan && chosenBin ? binMatches(binScan, chosenBin) : false;

  const confirm = async (goNext: boolean) => {
    if (!productScan || !productOk) {
      setError('Scan the product first — it must match the putaway item.');
      return;
    }
    if (!binScan || !chosenBin || !binOk) {
      setError('Scan the storage bin you are placing into (it must match the selected bin).');
      return;
    }
    if (qty <= 0 || qty > (task.remaining_qty || 0)) {
      setError(`Enter a qty between 1 and ${task.remaining_qty}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 1) Place this batch of units (moves stock + occupancy immediately).
      await api.placePutaway(task.task_id, chosenBin.location_id, qty);
      // 2) If every unit is now placed, confirm the task. Otherwise leave IN_PROGRESS.
      const placed = (task.placed_qty || 0) + qty;
      let updated: PutawayTaskDetail = { ...task, placed_qty: placed, remaining_qty: Math.max(0, task.qty - placed) };
      if (placed >= task.qty) {
        const confirmed = await api.completePutaway(task.task_id, chosenBin.location_id);
        updated = { ...updated, status: confirmed.status || 'CONFIRMED', remaining_qty: 0 };
      }
      onDone(updated);
      setInfo(placed >= task.qty ? `Put away ✓ — stock is now sellable from ${chosenBin.barcode}.` : `Placed ${qty}. ${task.qty - placed} left on this task.`);
      if (goNext && placed >= task.qty) onNext();
      else if (goNext && placed < task.qty) {
        // Stay and continue placing the remainder.
        setQty(task.qty - placed);
      }
    } catch (e) {
      setError(errMsg(e, 'Putaway failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Header title={task.sku_code} subtitle={task.sku_name} onBack={onBack} />

      {/* Product + inventory data */}
      <View style={s.card}>
        <Text style={s.sectionInline}>Product</Text>
        <Row k="SKU" v={task.sku_code} />
        {task.category_name ? <Row k="Category" v={task.category_name} /> : null}
        {task.storage_zone ? <Row k="Storage zone" v={task.storage_zone} /> : null}
        {task.lot_number ? <Row k="Lot / batch" v={task.lot_number} /> : null}
        {task.grn_no ? <Row k="GRN" v={task.grn_no} /> : null}
        {task.asn_no ? <Row k="Consignment" v={task.asn_no} /> : null}
        <Row k="To place" v={`${task.remaining_qty} of ${task.qty}`} />
      </View>

      {/* Suggested bin */}
      <Text style={s.section}>Suggested storage bin{task.category_name ? ` · ${task.category_name}` : ''}</Text>
      {binsLoading ? (
        <ActivityIndicator color={C.yellow} />
      ) : suggested ? (
        <View style={[s.card, s.suggested]}>
          <Text style={s.suggestedTitle}>→ {suggested.barcode}</Text>
          <Text style={s.cardSub}>
            {suggested.zone ? `Zone ${suggested.zone} · ` : ''}{suggested.aisle ? `Aisle ${suggested.aisle} · ` : ''}{suggested.rack ? `Rack ${suggested.rack}` : ''}
            {suggested.capacity_qty != null ? ` · Holds ${suggested.occupied_qty ?? 0}/${suggested.capacity_qty}` : ''}
            {suggested.free_qty != null ? ` · ${suggested.free_qty} free` : ''}
          </Text>
          {suggested.contents?.length ? (
            <Text style={s.cardSub}>Already holds: {suggested.contents.slice(0, 3).map((c) => `${c.sku_code} ×${c.qty}`).join(', ')}</Text>
          ) : (
            <Text style={s.cardSub}>Currently empty.</Text>
          )}
          <TouchableOpacity style={s.pickBtn} onPress={() => setChosenBinId(suggested.location_id)}>
            <Text style={s.pickBtnText}>{chosenBin?.location_id === suggested.location_id ? '✓ Selected' : 'Select this bin'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Empty msg="No bins found for this facility. Scan any bin below." />
      )}

      {/* Other bins (tap to override the suggestion) */}
      {bins.length > 1 ? (
        <>
          <Text style={s.section}>All bins — tap to override</Text>
          {bins.slice(0, 30).map((b) => (
            <TouchableOpacity key={b.location_id} style={[s.binRow, chosenBin?.location_id === b.location_id ? s.binRowOn : null]} onPress={() => setChosenBinId(b.location_id)}>
              <View style={{ flex: 1 }}>
                <Text style={s.binCode}>{b.barcode}</Text>
                <Text style={s.binSub}>
                  {b.zone ? `Zone ${b.zone} · ` : ''}Holds {b.occupied_qty ?? 0}{b.capacity_qty != null ? `/${b.capacity_qty}` : ''}{b.free_qty != null ? ` · ${b.free_qty} free` : ''}
                </Text>
              </View>
              {chosenBin?.location_id === b.location_id ? <Chip tone="green">Selected</Chip> : null}
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      {/* Scan steps */}
      <Text style={s.section}>1 · Scan product</Text>
      <TouchableOpacity style={s.scanBtn} onPress={() => setScanTarget('product')}>
        <Text style={s.scanBtnText}>▦ {productScan ? productScan : 'Scan product'}</Text>
      </TouchableOpacity>
      {productScan ? <Text style={[s.state, productOk ? s.ok : s.bad]}>{productOk ? '✓ Matches this putaway item' : productMatch === 'pending' ? 'Checking barcode…' : '✕ Does not match — scan the right product'}</Text> : null}

      <Text style={s.section}>2 · Scan location bin</Text>
      <TouchableOpacity style={s.scanBtn} onPress={() => setScanTarget('bin')}>
        <Text style={s.scanBtnText}>▦ {binScan ? binScan : 'Scan bin barcode'}</Text>
      </TouchableOpacity>
      {binScan && chosenBin ? <Text style={[s.state, binOk ? s.ok : s.bad]}>{binOk ? `✓ ${chosenBin.barcode} — selected bin` : `✕ ${binScan} ≠ selected ${chosenBin.barcode}`}</Text> : null}
      {binScan && !chosenBin ? <Text style={s.state}>{binScan} — tap a bin above to bind it</Text> : null}

      <Text style={s.section}>3 · Units</Text>
      <View style={s.qtyRow}>
        <TouchableOpacity style={s.qtyBtn} onPress={() => setQty(Math.max(1, qty - 1))}><Text style={s.qtySym}>−</Text></TouchableOpacity>
        <Text style={s.qtyVal}>{qty}</Text>
        <TouchableOpacity style={s.qtyBtn} onPress={() => setQty(Math.min(task.remaining_qty || qty, qty + 1))}><Text style={s.qtySym}>+</Text></TouchableOpacity>
        <Text style={s.qtyHint}>of {task.remaining_qty} remaining</Text>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {info ? <Text style={s.info}>{info}</Text> : null}

      <PrimaryBtn onPress={() => confirm(false)} disabled={busy}>{busy ? 'Placing…' : 'Put away'}</PrimaryBtn>
      <PrimaryBtn onPress={() => confirm(true)} disabled={busy} color="#059669">
        {busy ? 'Placing…' : 'Put away & Next →'}
      </PrimaryBtn>
      <GhostBtn onPress={onNext}>Skip to next product</GhostBtn>

      <Scanner visible={scanTarget === 'product'} title="Scan product" subtitle={`Expected: ${task.sku_code}`} onScan={(c) => { setScanTarget(null); handleProductScan(c); }} onClose={() => setScanTarget(null)} />
      <Scanner visible={scanTarget === 'bin'} title="Scan storage bin" subtitle={chosenBin ? `Selected: ${chosenBin.barcode}` : 'Scan any bin label'} onScan={(c) => { setBinScan(c); setScanTarget(null); }} onClose={() => setScanTarget(null)} />
    </ScrollView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.k}>{k}</Text>
      <Text style={s.v}>{v}</Text>
    </View>
  );
}
function normEq(a: string, b?: string | null) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  card: { backgroundColor: C.card, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 10 },
  cardDone: { opacity: 0.75 },
  cardTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  cardSub: { color: C.sub, fontSize: 12, marginTop: 3, lineHeight: 16 },
  section: { color: C.text, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  sectionInline: { color: C.text, fontWeight: '700', marginBottom: 6 },
  refresh: { alignSelf: 'flex-end', marginBottom: 6 },
  refreshText: { color: C.yellow, fontWeight: '700' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  k: { color: C.faint, fontSize: 12 },
  v: { color: C.text, fontSize: 13, fontWeight: '600' },
  suggested: { borderColor: C.blue, backgroundColor: 'rgba(124,92,255,0.14)' },
  suggestedTitle: { color: '#c4b5fd', fontSize: 20, fontWeight: '800' },
  pickBtn: { backgroundColor: C.blue, padding: 10, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  pickBtnText: { color: '#fff', fontWeight: '700' },
  binRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.card, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  binRowOn: { borderColor: '#059669' },
  binCode: { color: C.text, fontWeight: '700' },
  binSub: { color: C.sub, fontSize: 12, marginTop: 2 },
  scanBtn: { backgroundColor: C.blue, padding: 16, borderRadius: 12, alignItems: 'center' },
  scanBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  state: { marginTop: 8, fontSize: 13 },
  ok: { color: '#6ee7b7' },
  bad: { color: '#b91c1c' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  qtyBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  qtySym: { color: C.text, fontSize: 20, fontWeight: '800' },
  qtyVal: { color: C.text, fontSize: 22, fontWeight: '800', minWidth: 44, textAlign: 'center' },
  qtyHint: { color: C.faint, fontSize: 12 },
  error: { color: '#b91c1c', backgroundColor: '#fecaca', padding: 10, borderRadius: 10, marginTop: 10 },
  info: { color: '#6ee7b7', backgroundColor: '#064e3b', padding: 10, borderRadius: 10, marginTop: 10 },
});
