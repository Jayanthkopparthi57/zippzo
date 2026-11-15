import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useAuth } from '../auth';
import { api, errMsg } from '../api';
import { C, Chip, Header, PrimaryBtn, Empty } from '../components/Ui';

/**
 * The manager's live overview: the same numbers the WMS command centre shows,
 * scoped to the store the manager is signed in at.
 *
 * The chart asks for "live overview / department status / order tracking". All
 * three are read models over the tables the floor writes, so a packer marking a
 * tote at the rack changes this screen on the next poll without a second
 * bookkeeping step.
 */

type Dept = {
  key: string;
  label: string;
  pending: number;
  unassigned?: number;
  detail: string;
};

type Tracked = {
  order_id: string;
  order_no: string;
  status: string;
  payment_method: string;
  payment_status: string;
  grand_total: string;
  customer_name?: string | null;
  promise_at?: string | null;
  rack_location?: string | null;
  delivery?: { task_id: string; status: string; staging_bin?: string | null } | null;
};

type ReadyTask = {
  task_id: string;
  order_no?: string | null;
  status: string;
  staging_bin?: string | null;
  rider_id?: string | null;
  offer_count?: number;
};

const TILES: Array<{ key: string; label: string; tone?: 'yellow' | 'green' | 'red' }> = [
  { key: 'orders_pending', label: 'Pending' },
  { key: 'orders_picking', label: 'Picking' },
  { key: 'orders_picked', label: 'Picked' },
  { key: 'orders_rack_dropped', label: 'At rack' },
  { key: 'orders_ready', label: 'Ready' },
  { key: 'orders_out_for_delivery', label: 'On the way' },
  { key: 'orders_delivered', label: 'Delivered 24h', tone: 'green' },
  { key: 'pending_queue', label: 'Unassigned', tone: 'red' },
];

export default function ManagerScreen({ onBack }: { onBack: () => void }) {
  const { facility, user } = useAuth();
  const storeCode = facility?.code || '';

  const [manager, setManager] = useState<Record<string, number>>({});
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [orders, setOrders] = useState<Tracked[]>([]);
  const [ready, setReady] = useState<ReadyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (refresh = false, quiet = false) => {
    if (refresh) setRefreshing(true);
    else if (!quiet) setLoading(true);
    setError(null);
    try {
      const [dash, dept, tracking, queue] = await Promise.all([
        api.dashboard().catch(() => null),
        api.departmentStatus(storeCode).catch(() => null),
        api.dsOrderTracking(storeCode).catch(() => null),
        api.deliveryQueue(storeCode).catch(() => null),
      ]);
      setManager((dash?.manager || {}) as Record<string, number>);
      setDepartments((dept?.departments || []) as Dept[]);
      setOrders((tracking?.orders || []) as Tracked[]);
      setReady((queue?.tasks || []) as ReadyTask[]);
    } catch (e) {
      setError(errMsg(e, 'Could not load the store overview'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [storeCode]);

  useEffect(() => { load(); }, [load]);

  // Quiet poll: a manager watching the floor should not have to pull to refresh.
  useEffect(() => {
    const id = setInterval(() => load(false, true), 20000);
    return () => clearInterval(id);
  }, [load]);

  const drainPickQueue = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.assignPendingPicks(storeCode);
      setNotice(`Assigned ${res?.assigned ?? 0}, still waiting ${res?.remaining ?? 0}.`);
      await load(true);
    } catch (e) {
      setError(errMsg(e, 'Could not assign the pending queue'));
    } finally {
      setBusy(false);
    }
  };

  const assignOne = async (order: Tracked) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.assignOrder(order.order_id);
      setNotice(`${order.order_no} → ${res?.picker_name || 'least-loaded picker'}.`);
      await load(true);
    } catch (e: any) {
      setError(e?.body?.error || errMsg(e, 'Could not assign this order'));
    } finally {
      setBusy(false);
    }
  };

  const actionable = orders.filter((o) => ['CONFIRMED', 'PLACED'].includes(o.status));

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ padding: 16, paddingBottom: 36 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.yellow} />}
    >
      <Header
        title="Store Manager"
        subtitle={`${facility?.name || storeCode} · live`}
        onBack={onBack}
        right={<Chip tone="amber">{user?.full_name || 'Manager'}</Chip>}
      />

      {error ? <Text style={s.error}>{error}</Text> : null}
      {notice ? <Text style={s.info}>{notice}</Text> : null}

      {loading ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 30 }} />
      ) : (
        <>
          <Text style={s.section}>Live overview</Text>
          <View style={s.tiles}>
            {TILES.map((tile) => {
              const value = manager[tile.key] ?? 0;
              return (
                <View key={tile.key} style={[s.tile, value > 0 && tile.tone === 'red' ? s.tileAlert : null]}>
                  <Text style={[s.tileVal, value > 0 && tile.tone === 'red' ? { color: '#b91c1c' } : null]}>
                    {value}
                  </Text>
                  <Text style={s.tileLab}>{tile.label}</Text>
                </View>
              );
            })}
          </View>

          <Text style={s.section}>Department status</Text>
          {departments.length === 0 ? (
            <Empty msg="No departments reporting yet." />
          ) : (
            <View style={s.panel}>
              {departments.map((dept) => (
                <View key={dept.key} style={s.deptRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.deptName}>{dept.label}</Text>
                    <Text style={s.deptDetail}>
                      {dept.detail}
                      {dept.unassigned ? ` · ${dept.unassigned} unassigned` : ''}
                    </Text>
                  </View>
                  <Chip tone={dept.pending > 0 ? 'amber' : 'green'}>{dept.pending}</Chip>
                </View>
              ))}
              <PrimaryBtn onPress={drainPickQueue} disabled={busy} color={C.yellow}>
                {busy ? 'Assigning…' : 'Assign pending pick queue'}
              </PrimaryBtn>
            </View>
          )}

          <Text style={s.section}>Ready for rider ({ready.length})</Text>
          {ready.length === 0 ? (
            <Text style={s.muted}>No packed tote waiting at a staging slot.</Text>
          ) : (
            <View style={s.panel}>
              {ready.map((t) => (
                <View key={t.task_id} style={s.deptRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.deptName}>{t.order_no || 'Order'}</Text>
                    <Text style={s.deptDetail}>
                      Stage {t.staging_bin || '—'}
                      {t.rider_id ? ' · rider assigned' : ' · no rider yet'}
                      {t.offer_count ? ` · offered ${t.offer_count}×` : ''}
                    </Text>
                  </View>
                  <Chip tone={t.rider_id ? 'blue' : 'amber'}>{t.status}</Chip>
                </View>
              ))}
            </View>
          )}

          <Text style={s.section}>Order tracking ({orders.length})</Text>
          {orders.length === 0 ? (
            <Empty msg="No live order at this store." />
          ) : (
            <View style={s.panel}>
              {orders.slice(0, 25).map((order) => (
                <View key={order.order_id} style={s.orderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.deptName}>{order.order_no}</Text>
                    <Text style={s.deptDetail}>
                      {order.customer_name || 'Customer'} · ₹{order.grand_total} · {order.payment_method}
                      {order.rack_location ? ` · ${order.rack_location}` : ''}
                    </Text>
                    <Text style={s.deptDetail}>
                      {order.delivery
                        ? `Delivery ${order.delivery.status}${order.delivery.staging_bin ? ` · Stage ${order.delivery.staging_bin}` : ''}`
                        : 'No rider job yet'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Chip tone={statusTone(order.status)}>{order.status}</Chip>
                    {['CONFIRMED', 'PLACED'].includes(order.status) ? (
                      <TouchableOpacity style={s.miniBtn} onPress={() => assignOne(order)} disabled={busy}>
                        <Text style={s.miniBtnText}>Assign</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              ))}
              {actionable.length > 0 ? (
                <Text style={s.hint}>
                  {actionable.length} confirmed order(s) have no picker yet. Assign each
                  one, or drain the whole queue above.
                </Text>
              ) : null}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function statusTone(status: string): 'amber' | 'green' | 'blue' | 'muted' {
  if (status === 'DELIVERED') return 'green';
  if (['RACK_DROPPED', 'PICKED'].includes(status)) return 'amber';
  if (['PACKED', 'STAGED', 'PRICE_FINALIZED'].includes(status)) return 'blue';
  return 'muted';
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  section: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 16, marginBottom: 9 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    width: '23%', flexGrow: 1, backgroundColor: C.card, borderRadius: 12, paddingVertical: 12,
    paddingHorizontal: 8, alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  tileAlert: { borderColor: C.red, backgroundColor: '#fef2f2' },
  tileVal: { color: C.yellow, fontSize: 22, fontWeight: '900' },
  tileLab: { color: C.sub, fontSize: 10, marginTop: 3, textAlign: 'center' },
  panel: { backgroundColor: C.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border },
  deptRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  orderRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  deptName: { color: C.text, fontSize: 14, fontWeight: '800' },
  deptDetail: { color: C.sub, fontSize: 11, marginTop: 2, lineHeight: 15 },
  miniBtn: { backgroundColor: C.purple, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  miniBtnText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  muted: { color: C.faint, fontSize: 12 },
  hint: { color: C.faint, fontSize: 11, lineHeight: 16, marginTop: 10 },
  error: { color: '#fecaca', backgroundColor: '#fecaca', padding: 10, borderRadius: 10, marginBottom: 10, fontSize: 12 },
  info: { color: '#b45309', backgroundColor: '#92400e', padding: 10, borderRadius: 10, marginBottom: 10, fontSize: 12 },
});
