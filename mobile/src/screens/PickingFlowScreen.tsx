import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput,
} from 'react-native';
import { useAuth } from '../auth';
import { api, errMsg } from '../api';
import { C, Chip, Header, PrimaryBtn, GhostBtn, Empty, Stepper } from '../components/Ui';
import { Scanner } from '../components/Scanner';

/**
 * The chart's picking loop, one order at a time:
 *
 *   My orders -> Allocate -> Item 1/3 (scan SKU, scan bin, quantity)
 *             -> Next item -> Picking completed -> Rack Drop -> trophy
 *
 * The server is authoritative at every step. A scan is only a shortcut for
 * telling it which bin and which unit; `pick-line` re-checks the allocation,
 * the bin and the remaining quantity, so a stale screen cannot pick stock that
 * belongs to another order.
 */

type PickLine = {
  line_id: string;
  line_no?: number;
  sku?: string;
  sku_code?: string;
  product_name?: string;
  image_url?: string;
  brand?: string;
  pack_size?: string;
  base_uom?: string;
  weight_g?: number | null;
  mrp?: string | null;
  barcode?: string | null;
  expiry_date?: string | null;
  batch_number?: string | null;
  qty: number;
  picked_qty: number;
  outstanding: number;
  unit_price?: string;
  bin?: string | null;
  bin_location_id?: string | null;
  available_qty?: number;
  allocated?: boolean;
  bins?: Array<{
    location_id: string;
    label: string;
    outstanding: number;
    available_qty: number;
    allocated?: boolean;
    seq?: number;
  }>;
};

type PickOrder = {
  order_id: string;
  order_no: string;
  status: string;
  customer_name?: string | null;
  grand_total?: string;
  payment_method?: string;
  promise_at?: string | null;
  placed_at?: string | null;
  line_count?: number;
  units_total?: number;
  units_picked?: number;
  units_outstanding?: number;
  assigned_to_me?: boolean;
};

type Phase = 'queue' | 'pick' | 'rack' | 'done';

function money(value?: string | null) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toFixed(2)}` : String(value);
}

function weight(g?: number | null) {
  if (!g) return null;
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g} g`;
}

function timeLeft(promise?: string | null) {
  if (!promise) return null;
  const diff = new Date(promise).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  const mins = Math.round(diff / 60000);
  if (mins < 0) return `overdue ${Math.abs(mins)}m`;
  return `${mins}m left`;
}

export default function PickingFlowScreen({ onBack }: { onBack: () => void }) {
  const { facility, user, department } = useAuth();
  const storeCode = facility?.code || '';

  const [phase, setPhase] = useState<Phase>('queue');
  const [orders, setOrders] = useState<PickOrder[]>([]);
  const [pending, setPending] = useState<PickOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [active, setActive] = useState<PickOrder | null>(null);
  const [lines, setLines] = useState<PickLine[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [linesBusy, setLinesBusy] = useState(false);

  const [qty, setQty] = useState(1);
  const [scannedSku, setScannedSku] = useState<string | null>(null);
  const [scannedBin, setScannedBin] = useState<{ id: string; label: string } | null>(null);
  const [scanTarget, setScanTarget] = useState<null | 'sku' | 'bin'>(null);
  const [pickBusy, setPickBusy] = useState(false);
  const [rackLabel, setRackLabel] = useState('RACK-01');
  const [dropBusy, setDropBusy] = useState(false);

  const loadQueue = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await api.myPicks(storeCode || undefined);
      setOrders((data?.mine || []) as PickOrder[]);
      setPending((data?.pending || []) as PickOrder[]);
    } catch (e) {
      setError(errMsg(e, 'Could not load your pick queue'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [storeCode]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  const loadLines = useCallback(async (order: PickOrder, allocateIfNeeded = true) => {
    setLinesBusy(true);
    setError(null);
    setBlocked(null);
    try {
      let data = await api.pickLines(order.order_id);
      const needsAllocation = (data?.outstanding_total ?? 0) > 0
        && !(data?.pick_tasks || []).length
        && (data?.lines || []).every(
          (l: PickLine) => !(l.bins || []).some((b) => b.allocated && b.outstanding > 0),
        );
      if (needsAllocation && allocateIfNeeded) {
        await api.allocateOrder(order.order_id).catch(() => null);
        data = await api.pickLines(order.order_id);
      }
      if (data?.blocked_reason) setBlocked(String(data.blocked_reason));
      setLines((data?.lines || []) as PickLine[]);
      setScannedSku(null);
      setScannedBin(null);
      return (data?.lines || []) as PickLine[];
    } catch (e) {
      setError(errMsg(e, 'Could not load the order work list'));
      return [];
    } finally {
      setLinesBusy(false);
    }
  }, []);

  const openOrder = async (order: PickOrder, allocate = true) => {
    setActive(order);
    setNotice(null);
    setPhase('pick');
    const loaded = await loadLines(order, allocate);
    const next = loaded.find((l) => l.outstanding > 0);
    const target = next ? activeBin(next) : null;
    setQty(target ? Math.max(1, Math.min(target.outstanding, target.available_qty || target.outstanding)) : 1);
  };

  function activeBin(line: PickLine) {
    const allocated = (line.bins || [])
      .filter((b) => b.allocated && b.outstanding > 0)
      .sort((a, b) => (a.seq || 0) - (b.seq || 0));
    if (allocated.length) return allocated[0];
    if (line.bin_location_id && line.outstanding > 0) {
      return {
        location_id: line.bin_location_id,
        label: line.bin || 'bin',
        outstanding: line.outstanding,
        available_qty: line.available_qty || line.outstanding,
        allocated: true,
        seq: 1,
      };
    }
    return null;
  }

  const currentLine = useMemo(() => lines.find((l) => l.outstanding > 0) || null, [lines]);
  const totalLines = lines.length;
  const doneLines = lines.filter((l) => l.outstanding <= 0).length;
  const allPicked = totalLines > 0 && lines.every((l) => l.outstanding <= 0);
  const targetBin = currentLine ? activeBin(currentLine) : null;
  const binOutstanding = targetBin?.outstanding || currentLine?.outstanding || 1;
  const binAvailable = targetBin?.available_qty ?? currentLine?.available_qty ?? binOutstanding;
  const maxQty = Math.max(1, Math.min(binOutstanding, binAvailable || binOutstanding));

  useEffect(() => {
    if (phase === 'pick' && currentLine) {
      const bin = activeBin(currentLine);
      const cap = Math.max(1, Math.min(bin?.outstanding || currentLine.outstanding,
        bin?.available_qty || currentLine.outstanding));
      setQty(cap);
      setScannedSku(null);
      setScannedBin(null);
    }
    // Re-seed the pad whenever the line under the picker changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLine?.line_id, currentLine?.outstanding, phase]);

  const isPicker = department === 'PICKER' || user?.role === 'PICKER'
    || user?.role === 'WAREHOUSE_STAFF';

  const claimOrder = async (order: PickOrder) => {
    setError(null);
    setNotice(null);
    try {
      await api.assignOrder(order.order_id, user?.user_id);
      setNotice(`${order.order_no} is now yours.`);
      await loadQueue(true);
      await openOrder({ ...order, assigned_to_me: true });
    } catch (e) {
      setError(errMsg(e, 'Could not take this order'));
    }
  };

  const onSkuScanned = async (code: string) => {
    setScanTarget(null);
    const line = currentLine;
    if (!line) return;
    const expected = [line.barcode, line.sku_code].filter(Boolean).map((v) => String(v).toUpperCase());
    if (expected.length && !expected.includes(String(code).trim().toUpperCase())) {
      setError(`That is not ${line.sku_code}. You are picking ${line.product_name || 'this item'}.`);
      return;
    }
    setError(null);
    setScannedSku(code.trim());
  };

  const onBinScanned = async (code: string) => {
    setScanTarget(null);
    const line = currentLine;
    if (!line) return;
    try {
      const res = await api.resolveBin(storeCode, code);
      const matches = res?.matches || [];
      if (!matches.length) throw new Error(`"${code}" is not a bin at ${storeCode}.`);
      const match = matches[0];
      const expectedIds = new Set(
        (line.bins || [])
          .filter((b) => b.allocated && b.outstanding > 0)
          .map((b) => b.location_id),
      );
      if (!expectedIds.size && line.bin_location_id) expectedIds.add(line.bin_location_id);
      if (expectedIds.size && !expectedIds.has(match.location_id)) {
        throw new Error(`Wrong bin. Go to ${line.bin || 'the next shelf'} first.`);
      }
      setError(null);
      setScannedBin({ id: match.location_id, label: match.label || code });
    } catch (e) {
      setError(errMsg(e, 'Could not resolve that bin'));
    }
  };

  const commitPick = async () => {
    if (!active || !currentLine) return;
    const binId = scannedBin?.id || targetBin?.location_id || '';
    if (!binId) {
      setError('Scan the shelf bin before confirming the pick.');
      return;
    }
    setPickBusy(true);
    setError(null);
    try {
      const res = await api.pickLine({
        order_id: active.order_id,
        line_id: currentLine.line_id,
        bin_location_id: binId,
        qty,
        product_barcode: scannedSku || currentLine.barcode || undefined,
        scan_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      const left = res?.outstanding ?? 0;
      setNotice(
        `${res?.qty ?? qty} × ${currentLine.sku_code || 'item'} picked`
        + (left > 0 ? ` · ${left} still needed` : ''),
      );
      const fresh = await loadLines(active, false);
      setScannedSku(null);
      setScannedBin(null);
      if (fresh.length && fresh.every((l) => l.outstanding <= 0)) {
        setPhase('pick');
      }
    } catch (e: any) {
      const body = e?.body;
      setError(body?.error || body?.detail || errMsg(e, 'Pick failed'));
    } finally {
      setPickBusy(false);
    }
  };

  const completePick = async () => {
    if (!active) return;
    setPickBusy(true);
    setError(null);
    try {
      await api.completePick(active.order_id);
      setPhase('rack');
      setNotice(`${active.order_no} is picked. Carry it to the rack.`);
    } catch (e: any) {
      setError(e?.body?.error || errMsg(e, 'Could not complete the pick'));
    } finally {
      setPickBusy(false);
    }
  };

  const confirmRackDrop = async () => {
    if (!active) return;
    setDropBusy(true);
    setError(null);
    try {
      const res = await api.rackDrop(active.order_id, rackLabel.trim() || 'RACK-01');
      setNotice(res?.already_dropped
        ? `${active.order_no} was already at ${res.rack_location}.`
        : `${active.order_no} dropped at ${res.rack_location}.`);
      setPhase('done');
    } catch (e: any) {
      setError(e?.body?.error || errMsg(e, 'Could not confirm the rack drop'));
    } finally {
      setDropBusy(false);
    }
  };

  const resetToQueue = () => {
    setPhase('queue');
    setActive(null);
    setLines([]);
    setScannedSku(null);
    setScannedBin(null);
    setNotice(null);
    setError(null);
    loadQueue(true);
  };

  /* ───────────────────────── queue ───────────────────────── */
  if (phase === 'queue') {
    return (
      <ScrollView
        style={s.root}
        contentContainerStyle={{ padding: 16, paddingBottom: 34 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadQueue(true)} tintColor={C.yellow} />}
      >
        <Header
          title="Order Picking"
          subtitle={`${facility?.name || storeCode} · ${orders.length} assigned`}
          onBack={onBack}
          right={<Chip tone="amber">{department || 'ASSOCIATE'}</Chip>}
        />
        {error ? <Text style={s.error}>{error}</Text> : null}
        {notice ? <Text style={s.info}>{notice}</Text> : null}

        {loading ? (
          <ActivityIndicator color={C.yellow} style={{ marginTop: 30 }} />
        ) : (
          <>
            <Text style={s.section}>My orders ({orders.length})</Text>
            {orders.length === 0 ? (
              <Empty msg="No order is assigned to you yet. The least-loaded picker gets the next confirmed order automatically." />
            ) : (
              orders.map((order) => {
                const left = timeLeft(order.promise_at);
                const overdue = left?.startsWith('overdue');
                return (
                  <TouchableOpacity
                    key={order.order_id}
                    style={s.orderCard}
                    activeOpacity={0.85}
                    onPress={() => openOrder(order)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={s.orderNo}>{order.order_no}</Text>
                      <Text style={s.orderSub}>
                        {order.line_count ?? 0} items · {order.units_picked ?? 0}/{order.units_total ?? 0} picked
                      </Text>
                      <Text style={s.orderSub}>
                        {order.customer_name || 'Customer'} · {order.payment_method || 'COD'} · {money(order.grand_total)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Chip tone={order.status === 'CONFIRMED' ? 'amber' : 'blue'}>{order.status}</Chip>
                      {left ? (
                        <Text style={[s.timeLeft, overdue ? { color: C.red } : null]}>{left}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })
            )}

            <View style={s.pendingHead}>
              <Text style={s.section}>Waiting for a picker ({pending.length})</Text>
              {pending.length > 0 && isPicker ? (
                <Text style={s.pendingHint}>Claim one if your queue is empty.</Text>
              ) : null}
            </View>
            {pending.length === 0 ? (
              <Text style={s.muted}>Every pick has an owner.</Text>
            ) : (
              pending.map((order) => (
                <TouchableOpacity
                  key={order.order_id}
                  style={[s.orderCard, s.pendingCard]}
                  activeOpacity={0.85}
                  onPress={() => (isPicker ? claimOrder(order) : openOrder(order, false))}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.orderNo}>{order.order_no}</Text>
                    <Text style={s.orderSub}>{order.status} · nobody assigned</Text>
                  </View>
                  <Chip tone="amber">{isPicker ? 'Claim' : 'View'}</Chip>
                </TouchableOpacity>
              ))
            )}
          </>
        )}
      </ScrollView>
    );
  }

  /* ───────────────────────── trophy ───────────────────────── */
  if (phase === 'done') {
    return (
      <ScrollView style={s.root} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View style={s.trophyCard}>
          <Text style={s.trophy}>🏆</Text>
          <Text style={s.trophyTitle}>Picking completed</Text>
          <Text style={s.trophySub}>
            {active?.order_no} was dropped at {rackLabel.trim() || 'the rack'}.
            {'\n'}Packing can seal the tote now.
          </Text>
          {notice ? <Text style={[s.info, { textAlign: 'center' }]}>{notice}</Text> : null}
          <PrimaryBtn onPress={resetToQueue} color={C.yellow}>Back to my orders</PrimaryBtn>
        </View>
      </ScrollView>
    );
  }

  /* ───────────────────────── rack drop ───────────────────────── */
  if (phase === 'rack') {
    return (
      <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 34 }}>
        <Header title="Rack Drop" subtitle={active?.order_no || ''} onBack={() => setPhase('pick')} />
        <View style={s.bigCard}>
          <Text style={s.bigIcon}>🧺</Text>
          <Text style={s.bigTitle}>Carry the picked units to the rack</Text>
          <Text style={s.bigSub}>
            The pack station scans these into a tote. Record the rack label so the
            next associate can find them.
          </Text>
          <Text style={s.label}>Rack label</Text>
          <TextInput
            style={s.input}
            value={rackLabel}
            onChangeText={setRackLabel}
            autoCapitalize="characters"
            placeholder="RACK-01"
            placeholderTextColor={C.faint}
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <PrimaryBtn onPress={confirmRackDrop} disabled={dropBusy || !rackLabel.trim()} color={C.yellow}>
            {dropBusy ? 'Confirming…' : 'Confirm Rack Drop'}
          </PrimaryBtn>
          <GhostBtn onPress={() => { setPhase('pick'); loadLines(active!, false); }}>Back to items</GhostBtn>
        </View>
      </ScrollView>
    );
  }

  /* ───────────────────────── picking ───────────────────────── */
  const lineIndex = Math.min(doneLines + 1, Math.max(totalLines, 1));
  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 34 }}>
      <Header
        title={active?.order_no || 'Picking'}
        subtitle={`${facility?.name || storeCode} · ${doneLines}/${totalLines} items done`}
        onBack={resetToQueue}
        right={<Chip tone={allPicked ? 'green' : 'blue'}>{allPicked ? 'Picked' : `${lineIndex}/${totalLines}`}</Chip>}
      />

      <View style={s.progressTrack}>
        <View
          style={[
            s.progressFill,
            { width: `${totalLines ? Math.round((doneLines / totalLines) * 100) : 0}%` },
          ]}
        />
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {notice ? <Text style={s.info}>{notice}</Text> : null}
      {blocked ? <Text style={s.error}>{blocked}</Text> : null}

      {linesBusy ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 24 }} />
      ) : allPicked ? (
        <View style={s.bigCard}>
          <Text style={s.bigIcon}>✅</Text>
          <Text style={s.bigTitle}>Every item is picked</Text>
          <Text style={s.bigSub}>
            Confirm the pick, then carry the units to the rack. Packing creates
            the tote and the rider job.
          </Text>
          <PrimaryBtn onPress={completePick} disabled={pickBusy} color={C.yellow}>
            {pickBusy ? 'Completing…' : 'Complete Pick'}
          </PrimaryBtn>
        </View>
      ) : !currentLine ? (
        <Empty msg="This order has no pickable lines yet." />
      ) : (
        <>
          <Text style={s.itemCounter}>Item {lineIndex} of {totalLines}</Text>
          <View style={s.productCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={s.productName}>{currentLine.product_name || currentLine.sku_code}</Text>
                <Text style={s.productMeta}>
                  {[currentLine.brand, currentLine.pack_size, weight(currentLine.weight_g)]
                    .filter(Boolean).join(' · ') || currentLine.sku_code}
                </Text>
              </View>
              <Chip tone="amber">{currentLine.outstanding} left</Chip>
            </View>

            <View style={s.detailGrid}>
              <Detail label="SKU" value={currentLine.sku_code || '—'} />
              <Detail label="Barcode" value={currentLine.barcode || '—'} />
              <Detail label="MRP" value={money(currentLine.mrp)} />
              <Detail label="Price" value={money(currentLine.unit_price)} />
              <Detail label="Batch" value={currentLine.batch_number || '—'} />
              <Detail
                label="Expiry"
                value={currentLine.expiry_date
                  ? new Date(currentLine.expiry_date).toLocaleDateString()
                  : '—'}
              />
              <Detail label="Ordered" value={`${currentLine.qty} ${currentLine.base_uom || 'unit'}`} />
              <Detail label="Picked" value={`${currentLine.picked_qty}`} />
            </View>

            <View style={s.binBox}>
              <Text style={s.binLabel}>GO TO BIN</Text>
              <Text style={s.binValue}>{targetBin?.label || currentLine.bin || 'not located'}</Text>
              <Text style={s.binSub}>
                {binAvailable} units in this bin · {binOutstanding} needed from here
              </Text>
            </View>

            <Text style={s.label}>Quantity</Text>
            <Stepper value={qty} onChange={setQty} min={1} max={maxQty} />

            <View style={s.scanRow}>
              <TouchableOpacity
                style={[s.scanButton, scannedSku ? s.scanDone : null]}
                onPress={() => setScanTarget('sku')}
                disabled={pickBusy}
              >
                <Text style={s.scanTitle}>{scannedSku ? '✓ SKU scanned' : '1 · Scan SKU'}</Text>
                <Text style={s.scanSub}>{scannedSku || currentLine.barcode || 'product barcode'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.scanButton, scannedBin ? s.scanDone : null]}
                onPress={() => setScanTarget('bin')}
                disabled={pickBusy}
              >
                <Text style={s.scanTitle}>{scannedBin ? '✓ Bin scanned' : '2 · Scan bin'}</Text>
                <Text style={s.scanSub}>{scannedBin?.label || targetBin?.label || 'shelf barcode'}</Text>
              </TouchableOpacity>
            </View>

            <PrimaryBtn
              onPress={commitPick}
              disabled={pickBusy || !scannedSku || !scannedBin}
              color={C.yellow}
            >
              {pickBusy ? 'Picking…' : `Pick ${qty} · Next item`}
            </PrimaryBtn>
            {!scannedBin || !scannedSku ? (
              <Text style={s.scanHint}>Scan both the product and the bin to confirm.</Text>
            ) : null}
          </View>

          <GhostBtn
            onPress={async () => {
              if (!active) return;
              setPickBusy(true);
              setError(null);
              try {
                await api.pickAbandon(active.order_id);
                setNotice('Pick dropped out — units returned to their shelves.');
                await loadLines(active, false);
              } catch (e) {
                setError(errMsg(e, 'Could not drop out of this pick'));
              } finally {
                setPickBusy(false);
              }
            }}
            disabled={pickBusy}
          >
            Drop out (return units to shelf)
          </GhostBtn>
        </>
      )}

      <Scanner
        visible={scanTarget === 'sku'}
        title="Scan product"
        subtitle={currentLine ? `${currentLine.sku_code} · ${currentLine.product_name || ''}` : 'Product barcode'}
        onScan={onSkuScanned}
        onClose={() => setScanTarget(null)}
      />
      <Scanner
        visible={scanTarget === 'bin'}
        title="Scan shelf bin"
        subtitle={targetBin ? `Go to ${targetBin.label}` : 'Bin barcode'}
        onScan={onBinScanned}
        onClose={() => setScanTarget(null)}
      />
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detail}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  section: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 8, marginBottom: 10 },
  orderCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: C.border,
  },
  pendingCard: { borderStyle: 'dashed', borderColor: C.yellow },
  orderNo: { color: C.text, fontSize: 16, fontWeight: '900' },
  orderSub: { color: C.sub, fontSize: 12, marginTop: 3 },
  timeLeft: { color: C.yellow, fontSize: 11, fontWeight: '800', marginTop: 6 },
  pendingHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  pendingHint: { color: C.faint, fontSize: 11 },
  muted: { color: C.faint, fontSize: 12, marginBottom: 8 },
  error: { color: '#fecaca', backgroundColor: '#fecaca', padding: 10, borderRadius: 10, marginBottom: 10, fontSize: 12 },
  info: { color: '#b45309', backgroundColor: '#92400e', padding: 10, borderRadius: 10, marginBottom: 10, fontSize: 12 },
  progressTrack: { height: 8, backgroundColor: C.card, borderRadius: 999, marginBottom: 14, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.yellow, borderRadius: 999 },
  itemCounter: { color: C.yellow, fontSize: 13, fontWeight: '900', marginBottom: 8, letterSpacing: 0.5 },
  productCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1,
    borderColor: C.border, marginBottom: 10,
  },
  productName: { color: C.text, fontSize: 20, fontWeight: '900' },
  productMeta: { color: C.sub, fontSize: 12, marginTop: 4 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, gap: 8 },
  detail: {
    width: '47%', backgroundColor: C.bg, borderRadius: 9, padding: 8,
    borderWidth: 1, borderColor: C.border,
  },
  detailLabel: { color: C.faint, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  detailValue: { color: C.text, fontSize: 13, fontWeight: '700', marginTop: 2 },
  binBox: {
    marginTop: 14, marginBottom: 12, padding: 14, borderRadius: 12,
    backgroundColor: C.purpleDeep, borderWidth: 1, borderColor: C.purple,
  },
  binLabel: { color: C.yellow, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  binValue: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 2 },
  binSub: { color: C.sub, fontSize: 12, marginTop: 3 },
  label: { color: C.sub, fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: C.bg, color: C.text, borderRadius: 10, padding: 13,
    borderWidth: 1, borderColor: C.border, fontSize: 16, marginBottom: 10,
  },
  scanRow: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 8 },
  scanButton: {
    flex: 1, backgroundColor: C.bg, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, minHeight: 74,
  },
  scanDone: { borderColor: C.green, backgroundColor: '#f0fdf4' },
  scanTitle: { color: C.text, fontWeight: '800', fontSize: 13 },
  scanSub: { color: C.sub, fontSize: 11, marginTop: 4 },
  scanHint: { color: C.faint, fontSize: 11, textAlign: 'center', marginTop: 8 },
  bigCard: {
    backgroundColor: C.card, borderRadius: 18, padding: 22, borderWidth: 1,
    borderColor: C.border, alignItems: 'center', marginTop: 12,
  },
  bigIcon: { fontSize: 54, marginBottom: 6 },
  bigTitle: { color: C.text, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  bigSub: { color: C.sub, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8, marginBottom: 12 },
  trophyCard: {
    backgroundColor: C.card, borderRadius: 22, padding: 28, borderWidth: 2,
    borderColor: C.yellow, alignItems: 'center', marginTop: 24,
  },
  trophy: { fontSize: 78 },
  trophyTitle: { color: C.yellow, fontSize: 26, fontWeight: '900', marginTop: 8 },
  trophySub: { color: C.sub, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 10, marginBottom: 14 },
});
