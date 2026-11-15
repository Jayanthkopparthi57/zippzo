import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { useAuth } from '../auth';
import { api, errMsg } from '../api';
import { PackTaskRow, PickTaskRow, TransferOrderRow } from '../types';
import { Header, C, Chip, PrimaryBtn, GhostBtn, SearchRow, Empty } from '../components/Ui';
import { Scanner } from '../components/Scanner';

type Tab = 'pick' | 'pack' | 'transfer';

interface PickLineView {
  line_id: string;
  line_no?: number;
  sku_code?: string;
  product_name?: string;
  qty: number;
  picked_qty: number;
  outstanding: number;
  // Server: plain `bin` (label) + `bin_location_id` for the next shelf.
  bin?: string | null;
  bin_location_id?: string | null;
  available_qty?: number;
  allocated?: boolean;
  bins?: Array<{ location_id: string; label: string; outstanding: number; available_qty: number; allocated?: boolean }>;
}

export default function OutboundScreen({ onBack }: { onBack: () => void }) {
  const { facility } = useAuth();
  const isDS = facility?.site_type === 'DS';
  const [tab, setTab] = useState<Tab>('pick');
  const [picks, setPicks] = useState<PickTaskRow[]>([]);
  const [packs, setPacks] = useState<PackTaskRow[]>([]);
  const [transfers, setTransfers] = useState<TransferOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [scanTarget, setScanTarget] = useState<null | 'lpn' | 'staging' | 'pickBin'>(null);

  // Pack pad
  const [packFields, setPackFields] = useState({ lpn: '', staging: '', orderId: '' });

  // Pick flow state
  const [activeOrderId, setActiveOrderId] = useState('');
  const [activeOrderNo, setActiveOrderNo] = useState('');
  const [pickLines, setPickLines] = useState<PickLineView[]>([]);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickBlocked, setPickBlocked] = useState<string | null>(null);
  const [pickedBin, setPickedBin] = useState<string>('');
  const [pickBusy, setPickBusy] = useState(false);
  const [pickMsg, setPickMsg] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [p, k, t] = await Promise.all([
        api.listPickTasks({ status__in: 'NOT_STARTED,IN_PROGRESS' }).catch(() => [] as PickTaskRow[]),
        api.listPackTasks({ status__in: 'NOT_STARTED,IN_PROGRESS' }).catch(() => [] as PackTaskRow[]),
        api.listTransferOrders({}).catch(() => [] as TransferOrderRow[]),
      ]);
      setPicks(p);
      setPacks(k);
      setTransfers(t);
    } catch (e) {
      setError(errMsg(e, 'Could not load outbound work'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openOrder = async (orderId: string, orderNo?: string) => {
    setActiveOrderId(orderId);
    setActiveOrderNo(orderNo || '');
    setPickMsg(null);
    setPickBlocked(null);
    setPickLoading(true);
    try {
      // Ensure the order will be pickable: allocate if the work list has no bins.
      let data = await api.pickLines(orderId).catch(() => null);
      const needsAlloc = data && Array.isArray(data.lines) && data.lines.every((l: any) => !(l.bins || []).some((b: any) => b.allocated && b.outstanding > 0)) && (data.outstanding_total ?? 0) > 0 && !(data.pick_tasks || []).length;
      if (needsAlloc || data?.needs_allocation) {
        await api.allocateOrder(orderId).catch(() => null);
        data = await api.pickLines(orderId);
      }
      if (data?.blocked_reason) setPickBlocked(data.blocked_reason);
      const lines = (data?.lines || []) as PickLineView[];
      setPickLines(lines);
    } catch (e) {
      setError(errMsg(e, 'Could not load pick work for this order'));
    } finally {
      setPickLoading(false);
    }
  };

  const onPickBinScanned = async (code: string) => {
    // Resolve the physical bin label → Location.location_id for this store.
    try {
      const res = await api.resolveBin(facility?.code || '', code);
      const matches = res?.matches || [];
      if (!matches.length) throw new Error(`"${code}" is not a bin at ${facility?.code}.`);
      const locId = matches[0].location_id;
      // The picked product is whichever line points at this bin; commit the
      // line's outstanding for this bin (one scan completes that bin).
      const line = pickLines.find(
        (l) => (l.bins || []).some((b) => b.location_id === locId && b.outstanding > 0),
      ) || pickLines.find((l) => l.bin_location_id === locId);
      if (!line) {
        const expected = pickLines.find((l) => l.bin_location_id)?.bin;
        throw new Error(`Wrong bin for this order. Go to ${expected || 'the next shelf'}.`);
      }
      const binEntry = (line.bins || []).find((b) => b.location_id === locId);
      const qty = Math.max(1, Math.min(line.outstanding, binEntry?.outstanding || line.outstanding));
      setPickBusy(true);
      const res2 = await api.pickLine({
        order_id: activeOrderId,
        line_id: line.line_id,
        bin_location_id: locId,
        qty,
        scan_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      setPickMsg(`Picked ${res2.picked_qty ?? qty} of ${line.sku_code || ''}${res2.next_bin ? ` · Next: ${res2.next_bin}` : ''}`);
      await openOrder(activeOrderId, activeOrderNo);
      load(true);
    } catch (e: any) {
      const body = e?.body;
      setPickMsg(body?.error || body?.detail || errMsg(e, 'Pick failed'));
    } finally {
      setPickBusy(false);
      setScanTarget(null);
    }
  };

  const doPack = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (!packFields.orderId.trim()) throw new Error('Enter the order id to pack.');
      if (!packFields.lpn.trim() && !packFields.staging.trim()) throw new Error('Scan the tote (LPN) or staging bin.');
      const res = await api.packOrder({
        order_id: packFields.orderId.trim(),
        lpn_barcode: packFields.lpn.trim() || undefined,
        lpn_id: packFields.lpn.trim() || undefined,
        staging_bin: packFields.staging.trim() || undefined,
      });
      setInfo(res?.message || `Order ${res?.order_no || ''} packed and staged for the rider.`);
      load(true);
    } catch (e) {
      setError(errMsg(e, 'Pack failed'));
    } finally {
      setBusy(false);
    }
  };

  const filter = (items: any[]) =>
    q.trim()
      ? items.filter((i) => JSON.stringify(i).toLowerCase().includes(q.trim().toLowerCase()))
      : items;

  // Distinct pickable orders from pick tasks (task → order → lines).
  const distinctOrders = (() => {
    const m = new Map<string, { orderId: string; orderNo: string; count: number }>();
    for (const p of filter(picks)) {
      const oid = (p as any).order || (p as any).order_id || '';
      if (!oid) continue;
      const cur = m.get(oid) || { orderId: oid, orderNo: (p as any).order_no || '', count: 0 };
      cur.count += 1;
      m.set(oid, cur);
    }
    return [...m.values()];
  })();

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'pick', label: 'Pick' },
    { id: 'pack', label: 'Pack' },
    { id: 'transfer', label: 'Transfers' },
  ];

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.yellow} />}
    >
      <Header title="Outbound" subtitle={`${isDS ? 'Dark-store dispatch' : 'Warehouse dispatch'} · ${facility?.code || ''}`} onBack={onBack} />

      <View style={s.tabs}>
        {tabs.map((t) => (
          <TouchableOpacity key={t.id} style={[s.tab, tab === t.id ? s.tabOn : null]} onPress={() => setTab(t.id)}>
            <Text style={[s.tabText, tab === t.id ? s.tabTextOn : null]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <SearchRow value={q} onChange={setQ} placeholder="Search order / SKU / bin" onScan={() => setScanTarget(tab === 'pack' ? 'lpn' : 'pickBin')} />
      {error ? <Text style={s.error}>{error}</Text> : null}
      {info ? <Text style={s.info}>{info}</Text> : null}

      {loading ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 24 }} />
      ) : tab === 'pick' ? (
        <>
          <Text style={s.section}>Pick orders ({distinctOrders.length})</Text>
          {distinctOrders.length === 0 ? (
            <Empty msg="No open pick tasks. New confirmed orders appear here." />
          ) : (
            distinctOrders.map((o) => (
              <TouchableOpacity key={o.orderId} style={s.card} onPress={() => openOrder(o.orderId, o.orderNo)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{o.orderNo ? `Order ${o.orderNo}` : 'Order'}</Text>
                  <Text style={s.cardSub}>{o.count} pick task(s). Tap to open the work list.</Text>
                </View>
                <Chip tone={activeOrderId === o.orderId ? 'green' : 'blue'}>{activeOrderId === o.orderId ? 'Open' : 'Open →'}</Chip>
              </TouchableOpacity>
            ))
          )}

          {activeOrderId ? (
            <>
              <Text style={s.section}>Work list {activeOrderNo ? `· ${activeOrderNo}` : ''}</Text>
              {pickBlocked ? <Text style={s.error}>{pickBlocked}</Text> : null}
              {pickLoading ? (
                <ActivityIndicator color={C.yellow} />
              ) : pickLines.length === 0 ? (
                <Empty msg="No lines waiting on this order." />
              ) : (
                pickLines.map((l) => (
                  <View key={l.line_id} style={s.card}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardTitle}>{l.sku_code || 'SKU'} {l.product_name ? `— ${l.product_name}` : ''}</Text>
                      <Text style={s.cardSub}>
                        {l.picked_qty} of {l.qty} picked · {l.outstanding} outstanding
                        {l.bin ? ` · Go to bin ${l.bin}` : ''}
                      </Text>
                    </View>
                    <Chip tone={l.outstanding > 0 ? 'blue' : 'green'}>{l.outstanding > 0 ? `${l.outstanding}` : 'Done'}</Chip>
                  </View>
                ))
              )}
              {pickMsg ? <Text style={s.info}>{pickMsg}</Text> : null}
              <TouchableOpacity style={s.scanBtn} onPress={() => setScanTarget('pickBin')} disabled={pickBusy}>
                <Text style={s.scanBtnText}>{pickBusy ? 'Picking…' : '▦ Scan bin & pick'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.abandonBtn}
                disabled={pickBusy || !activeOrderId}
                onPress={async () => {
                  setPickBusy(true);
                  try {
                    await api.pickAbandon(activeOrderId);
                    setPickMsg('Pick dropped out — units returned to shelves.');
                    await openOrder(activeOrderId, activeOrderNo);
                    load(true);
                  } catch (e) {
                    setPickMsg(errMsg(e, 'Drop-out failed'));
                  } finally {
                    setPickBusy(false);
                  }
                }}
              >
                <Text style={s.abandonText}>Drop out (return units to shelf)</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </>
      ) : tab === 'pack' ? (
        <>
          <View style={s.pad}>
            <Text style={s.padLab}>Order ID</Text>
            <TextInput
              style={s.padInput}
              value={packFields.orderId}
              onChangeText={(v) => setPackFields((f) => ({ ...f, orderId: v }))}
              placeholder="Tap a pack task below to fill"
              placeholderTextColor="#64748b"
            />
            <PadRow label="Tote / LPN" value={packFields.lpn} onScan={() => setScanTarget('lpn')} />
            <PadRow label="Staging bin" value={packFields.staging} onScan={() => setScanTarget('staging')} />
            <TouchableOpacity
              style={s.createTote}
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  const created = await api.createLpn({
                    lpn_type: 'TOTE',
                    current_site: facility?.site_id,
                    source_site: facility?.site_id,
                    status: 'EMPTY',
                  });
                  const barcode = created?.barcode || created?.lpn_id;
                  if (barcode) setPackFields((f) => ({ ...f, lpn: barcode }));
                  setInfo(`Created tote ${barcode}. Scan it to confirm, then seal.`);
                } catch (e) {
                  setError(errMsg(e, 'Could not create tote'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Text style={s.createToteText}>+ Create a new empty tote</Text>
            </TouchableOpacity>
            <PrimaryBtn onPress={doPack} disabled={busy}>{busy ? 'Working…' : 'Seal & pack'}</PrimaryBtn>
          </View>
          <Text style={s.section}>Pack tasks ({filter(packs).length})</Text>
          {filter(packs).length === 0 ? (
            <Empty msg="Nothing to pack yet. Fully picked orders appear here." />
          ) : (
            filter(packs).map((p) => (
              <TouchableOpacity
                key={String(p.packlist_id || (p as any).id)}
                style={s.card}
                onPress={() => setPackFields((f) => ({ ...f, lpn: p.lpn || '', staging: p.staging_bin || '', orderId: p.order || p.order_id || '' }))}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{(p as any).order_no ? `Order ${(p as any).order_no}` : 'Pack task'} {p.sku_code ? `· ${p.sku_code}` : ''}</Text>
                  <Text style={s.cardSub}>{p.packed_qty} of {p.qty} packed{p.lpn ? ` · Tote ${p.lpn}` : ''}{p.staging_bin ? ` · Stage ${p.staging_bin}` : ''}</Text>
                </View>
                <Chip tone="blue">{p.status}</Chip>
              </TouchableOpacity>
            ))
          )}
        </>
      ) : (
        <>
          <Text style={s.section}>Transfer orders ({filter(transfers).length})</Text>
          {filter(transfers).length === 0 ? (
            <Empty msg="No transfers. Warehouse → DS replenishment appears here." />
          ) : (
            filter(transfers).map((t) => (
              <View key={t.transfer_id} style={s.card}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{t.transfer_id.slice(0, 8)}…</Text>
                  <Text style={s.cardSub}>
                    {t.source_site_code || t.source_site || ''} → {t.dest_site_code || t.dest_site || ''}{t.total_qty ? ` · ${t.total_qty} units` : ''}
                  </Text>
                </View>
                <Chip tone="muted">{t.status}</Chip>
              </View>
            ))
          )}
        </>
      )}

      <Scanner visible={scanTarget === 'pickBin'} title="Scan bin" subtitle={pickLines.find((l) => l.bin)?.bin ? `Go to bin ${pickLines.find((l) => l.bin)?.bin}` : 'Scan the pick-face bin'} onScan={onPickBinScanned} onClose={() => setScanTarget(null)} />
      <Scanner visible={scanTarget === 'lpn'} title="Scan tote" subtitle="Packing tote / LPN barcode" onScan={(c) => { setPackFields((f) => ({ ...f, lpn: c })); setScanTarget(null); }} onClose={() => setScanTarget(null)} />
      <Scanner visible={scanTarget === 'staging'} title="Scan staging bin" subtitle="Where the rider collects" onScan={(c) => { setPackFields((f) => ({ ...f, staging: c })); setScanTarget(null); }} onClose={() => setScanTarget(null)} />
    </ScrollView>
  );
}

function PadRow({ label, value, onScan }: { label: string; value: string; onScan: () => void }) {
  return (
    <View style={s.padRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.padLab}>{label}</Text>
        <Text style={s.padVal}>{value || '—'}</Text>
      </View>
      <TouchableOpacity style={s.padBtn} onPress={onScan}>
        <Text style={s.padBtnText}>Scan</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { flex: 1, backgroundColor: C.card, padding: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  tabOn: { backgroundColor: 'rgba(124,92,255,0.16)', borderColor: 'rgba(124,92,255,0.5)' },
  tabText: { color: C.sub, fontWeight: '700' },
  tabTextOn: { color: '#c4b5fd' },
  section: { color: C.text, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.card, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  cardTitle: { color: C.text, fontWeight: '700', fontSize: 14 },
  cardSub: { color: C.sub, fontSize: 12, marginTop: 3, lineHeight: 16 },
  pad: { backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  padRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  padLab: { color: C.faint, fontSize: 11, fontWeight: '700' },
  padVal: { color: C.text, fontSize: 15, fontWeight: '700', marginTop: 2 },
  padBtn: { backgroundColor: C.blue, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  padBtnText: { color: '#fff', fontWeight: '700' },
  padInput: { backgroundColor: C.cardAlt, color: C.text, borderRadius: 8, padding: 10, marginTop: 6, marginBottom: 6 },
  scanBtn: { backgroundColor: C.blue, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  scanBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  error: { color: '#b91c1c', backgroundColor: '#fecaca', padding: 10, borderRadius: 10, marginBottom: 10 },
  info: { color: '#6ee7b7', backgroundColor: '#064e3b', padding: 10, borderRadius: 10, marginBottom: 10 },
  createTote: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  createToteText: { color: C.text, fontWeight: '700', fontSize: 13 },
  abandonBtn: { backgroundColor: '#fecaca', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  abandonText: { color: '#b91c1c', fontWeight: '700', fontSize: 13 },
});
