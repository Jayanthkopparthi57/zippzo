import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator,
  TouchableOpacity, TextInput,
} from 'react-native';
import { useAuth } from '../auth';
import { api, errMsg } from '../api';
import { StockBalance } from '../types';
import { Header, C, Chip, SearchRow, Empty, PrimaryBtn, GhostBtn, Stepper } from '../components/Ui';
import { Scanner } from '../components/Scanner';

type Action = null | 'move' | 'count';

export default function InventoryScreen({ onBack }: { onBack: () => void }) {
  const { facility, user } = useAuth();
  const [rows, setRows] = useState<StockBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [scan, setScan] = useState(false);

  const [selected, setSelected] = useState<StockBalance | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [targetBin, setTargetBin] = useState('');
  const [moveQty, setMoveQty] = useState(1);
  const [scanTarget, setScanTarget] = useState<null | 'target'>(null);
  const [busy, setBusy] = useState(false);

  const [countId, setCountId] = useState<string | null>(null);
  const [countLineId, setCountLineId] = useState<string | null>(null);
  const [countedQty, setCountedQty] = useState(0);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await api.listBalances({ site: facility?.site_id || undefined }).catch(async () => {
        // Some deployments fence balances by site code rather than UUID.
        return api.listBalances({});
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(errMsg(e, 'Could not load inventory'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [facility?.site_id]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => (q.trim()
    ? rows.filter((r) => `${r.sku_code || ''} ${r.sku_name || ''} ${r.container_ref || ''} ${r.lot_number || ''} ${r.batch_number || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    : rows), [rows, q]);

  const byBin: Record<string, StockBalance[]> = {};
  for (const r of filtered) {
    const key = r.container_ref || 'Unassigned';
    (byBin[key] = byBin[key] || []).push(r);
  }
  const bins = Object.keys(byBin).sort().slice(0, 40);

  const totalUnits = filtered.reduce((n, r) => n + (r.qty || 0), 0);
  const sellable = filtered.filter((r) => r.sellable !== false).reduce((n, r) => n + (r.qty || 0), 0);

  const openActions = (row: StockBalance) => {
    setSelected(row);
    setAction(null);
    setTargetBin('');
    setMoveQty(Math.max(1, row.qty));
    setCountId(null);
    setCountLineId(null);
    setCountedQty(row.qty);
    setNotice(null);
    setError(null);
  };

  const doMove = async () => {
    if (!selected || !targetBin.trim()) {
      setError('Scan the destination bin first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resolved = await api.resolveBin(facility?.code || '', targetBin.trim());
      const match = (resolved?.matches || [])[0];
      if (!match?.location_id) throw new Error(`"${targetBin}" is not a bin at this store.`);
      if (!selected.container_ref || !selected.sku || !selected.lot) {
        throw new Error('This stock row has no bin, SKU or lot to move.');
      }
      await api.relocateStock({
        from_location_id: selected.container_ref,
        to_location_id: match.location_id,
        sku: selected.sku,
        lot: selected.lot,
        qty: moveQty,
        movement_ref: 'RELOCATION',
      });
      setNotice(`Moved ${moveQty} × ${selected.sku_code || 'item'} from ${selected.container_ref} to ${match.label || match.barcode || targetBin}.`);
      setSelected(null);
      setAction(null);
      await load(true);
    } catch (e) {
      setError(errMsg(e, 'Could not move this stock'));
    } finally {
      setBusy(false);
    }
  };

  const startCount = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      if (!selected.sku) throw new Error('This stock row has no SKU to count.');
      const count = await api.createCycleCount({
        site: facility?.site_id,
        code: `SPOT-${Date.now().toString().slice(-8)}`,
        count_type: 'SPOT',
        status: 'IN_PROGRESS',
        assigned_to: user?.user_id,
        scope: {
          sku: selected.sku,
          bin: selected.container_ref,
        },
        notes: `Spot count from mobile · ${selected.container_ref || ''}`,
      });
      const line = await api.createCycleCountLine({
        count: count.count_id,
        location: selected.container_ref || undefined,
        sku: selected.sku,
        lot: selected.lot || undefined,
        system_qty: selected.qty || 0,
        status: 'PENDING',
      });
      setCountId(count.count_id);
      setCountLineId(line.line_id);
      setCountedQty(selected.qty || 0);
      setAction('count');
      setNotice(`Spot count ${count.code} started. Count the shelf and save.`);
    } catch (e) {
      setError(errMsg(e, 'Could not start a cycle count'));
    } finally {
      setBusy(false);
    }
  };

  const saveCount = async () => {
    if (!countLineId || !countId) return;
    setBusy(true);
    setError(null);
    try {
      const line = await api.updateCycleCountLine(countLineId, {
        counted_qty: countedQty,
        status: countedQty === (selected?.qty || 0) ? 'COUNTED' : 'VARIANCE',
        counted_by: user?.user_id,
      });
      setNotice(
        `Counted ${countedQty}. Variance ${line?.variance ?? (countedQty - (selected?.qty || 0))}.`,
      );
      setSelected(null);
      setAction(null);
      setCountId(null);
      setCountLineId(null);
      await load(true);
    } catch (e) {
      setError(errMsg(e, 'Could not save the count'));
    } finally {
      setBusy(false);
    }
  };

  const scanningTarget = scanTarget === 'target';
  const resolveTarget = async (code: string) => {
    setScanTarget(null);
    try {
      const resolved = await api.resolveBin(facility?.code || '', code);
      const match = (resolved?.matches || [])[0];
      if (!match) throw new Error(`"${code}" is not a bin at this store.`);
      setTargetBin(match.label || match.barcode || code);
    } catch (e) {
      setError(errMsg(e, 'Could not resolve that bin'));
    }
  };

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.yellow} />}
    >
      <Header title="Inventory" subtitle={`${facility?.code || ''} · ${rows.length} rows · ${totalUnits} units`} onBack={onBack} />
      <SearchRow value={q} onChange={setQ} placeholder="Scan or search SKU / bin / batch" onScan={() => setScan(true)} onSubmit={() => {}} />

      <View style={s.stats}>
        <View style={s.stat}><Text style={s.statVal}>{rows.length}</Text><Text style={s.statLab}>Stock rows</Text></View>
        <View style={s.stat}><Text style={s.statVal}>{totalUnits}</Text><Text style={s.statLab}>Total units</Text></View>
        <View style={s.stat}><Text style={s.statVal}>{sellable}</Text><Text style={s.statLab}>Sellable</Text></View>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {notice ? <Text style={s.info}>{notice}</Text> : null}

      {selected ? (
        <View style={s.actionPanel}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={s.actionTitle}>{selected.sku_code || selected.sku}</Text>
              <Text style={s.actionSub}>
                {selected.sku_name || ''} · bin {selected.container_ref || '—'} · {selected.qty} units
              </Text>
            </View>
            <TouchableOpacity onPress={() => { setSelected(null); setAction(null); }}>
              <Text style={s.close}>✕</Text>
            </TouchableOpacity>
          </View>

          {action === null ? (
            <View style={s.rowBtns}>
              <TouchableOpacity style={s.actionBtn} onPress={startCount} disabled={busy}>
                <Text style={s.actionBtnTitle}>Count this shelf</Text>
                <Text style={s.actionBtnSub}>Start a spot cycle count</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.actionBtn} onPress={() => setAction('move')} disabled={busy}>
                <Text style={s.actionBtnTitle}>Move to a bin</Text>
                <Text style={s.actionBtnSub}>Relocate units in the store</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {action === 'move' ? (
            <>
              <Text style={s.label}>Destination bin</Text>
              <View style={s.scanLine}>
                <TextInput
                  style={[s.input, { flex: 1, marginBottom: 0 }]}
                  value={targetBin}
                  onChangeText={setTargetBin}
                  placeholder="Scan or type bin"
                  placeholderTextColor={C.faint}
                  autoCapitalize="characters"
                />
                <TouchableOpacity style={s.scanMini} onPress={() => setScanTarget('target')}>
                  <Text style={s.scanMiniText}>Scan</Text>
                </TouchableOpacity>
              </View>
              <Text style={s.label}>Quantity</Text>
              <Stepper value={moveQty} onChange={setMoveQty} min={1} max={Math.max(1, selected.qty)} />
              <PrimaryBtn onPress={doMove} disabled={busy || !targetBin.trim()} color={C.yellow}>
                {busy ? 'Moving…' : 'Move stock'}
              </PrimaryBtn>
              <GhostBtn onPress={() => setAction(null)}>Cancel</GhostBtn>
            </>
          ) : null}

          {action === 'count' ? (
            <>
              <Text style={s.label}>Physical count (system {selected.qty})</Text>
              <Stepper value={countedQty} onChange={setCountedQty} min={0} max={9999} />
              <Text style={s.hint}>
                A variance creates an adjustment for the manager to approve; it does
                not silently rewrite the shelf.
              </Text>
              <PrimaryBtn onPress={saveCount} disabled={busy || !countLineId} color={C.yellow}>
                {busy ? 'Saving…' : 'Save count'}
              </PrimaryBtn>
              <GhostBtn onPress={() => { setAction(null); setCountId(null); setCountLineId(null); }}>
                Cancel
              </GhostBtn>
            </>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 24 }} />
      ) : filtered.length === 0 ? (
        <Empty msg="No stock found. Try clearing the search or pull to refresh." />
      ) : (
        bins.map((bin) => (
          <View key={bin} style={s.binCard}>
            <Text style={s.binTitle}>▦ {bin}</Text>
            {byBin[bin].map((r, i) => (
              <TouchableOpacity
                key={`${r.sku}-${r.lot || i}`}
                style={s.row}
                activeOpacity={0.8}
                onPress={() => openActions(r)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{r.sku_code || r.sku || 'SKU'} — {r.sku_name || ''}</Text>
                  <Text style={s.rowSub}>
                    {r.lot_number || r.batch_number ? `Batch ${r.lot_number || r.batch_number} · ` : ''}{r.expiry_date ? `Exp ${r.expiry_date}` : ''}
                  </Text>
                </View>
                <Chip tone={r.sellable === false ? 'amber' : 'green'}>{r.qty} units</Chip>
              </TouchableOpacity>
            ))}
          </View>
        ))
      )}

      <Text style={s.tip}>Tap a stock row to count the shelf or move units to another bin.</Text>

      <Scanner
        visible={scan}
        title="Scan product / bin"
        subtitle="Jump to the scanned item in inventory"
        onScan={(code) => { setScan(false); setQ(code); }}
        onClose={() => setScan(false)}
      />
      <Scanner
        visible={scanningTarget}
        title="Scan destination bin"
        subtitle="Where the units are moving to"
        onScan={resolveTarget}
        onClose={() => setScanTarget(null)}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  statVal: { fontSize: 18, fontWeight: '800', color: C.text },
  statLab: { fontSize: 11, color: C.sub, marginTop: 2 },
  binCard: { backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  binTitle: { color: C.text, fontWeight: '800', fontSize: 15, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border },
  rowTitle: { color: C.text, fontWeight: '600', fontSize: 14 },
  rowSub: { color: C.sub, fontSize: 12, marginTop: 2 },
  error: { color: '#fecaca', backgroundColor: '#fecaca', padding: 10, borderRadius: 10, marginBottom: 10, fontSize: 12 },
  info: { color: '#b45309', backgroundColor: '#92400e', padding: 10, borderRadius: 10, marginBottom: 10, fontSize: 12 },
  actionPanel: {
    backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1,
    borderColor: C.yellow, marginBottom: 14,
  },
  actionTitle: { color: C.text, fontSize: 17, fontWeight: '900' },
  actionSub: { color: C.sub, fontSize: 12, marginTop: 3 },
  close: { color: C.sub, fontSize: 18, paddingHorizontal: 6 },
  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: {
    flex: 1, backgroundColor: C.bg, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  actionBtnTitle: { color: C.text, fontWeight: '800', fontSize: 13 },
  actionBtnSub: { color: C.faint, fontSize: 11, marginTop: 3 },
  label: { color: C.sub, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: C.bg, color: C.text, borderRadius: 10, padding: 13, borderWidth: 1, borderColor: C.border, fontSize: 16, marginBottom: 10 },
  scanLine: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  scanMini: { backgroundColor: C.yellow, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 10 },
  scanMiniText: { color: '#241503', fontWeight: '800' },
  hint: { color: C.faint, fontSize: 11, lineHeight: 16, marginTop: 10 },
  tip: { color: C.faint, fontSize: 11, marginTop: 14, lineHeight: 16 },
});
