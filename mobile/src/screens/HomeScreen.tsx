import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, StatusBar, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { api } from '../api';
import { C, TOP_INSET } from '../components/Ui';

const zippzoLogo = require('../assets/zippzo-logo.png');

export type HomeTarget =
  | 'tasks' | 'inbound' | 'inventory' | 'outbound' | 'dsinbound'
  | 'picking' | 'manager' | 'product-registration';

type Dashboard = {
  today_tasks?: number;
  picking?: number;
  packing?: number;
  putaway?: number;
  rack_drop?: number;
  completed_today?: number;
  pending?: number;
  inbound_pending?: number;
  inventory_tasks?: number;
  ready_for_rider?: number;
};

type ManagerData = {
  orders_pending?: number;
  orders_picking?: number;
  orders_picked?: number;
  orders_rack_dropped?: number;
  orders_ready?: number;
  orders_out_for_delivery?: number;
  orders_delivered?: number;
  pending_queue?: number;
  pickers_active?: number;
  riders_on_duty?: number;
};

const DEPARTMENT_LABEL: Record<string, string> = {
  PICKER: 'Picker',
  INBOUND: 'Inbound Associate',
  PUTAWAY: 'Putaway Associate',
  INVENTORY: 'Inventory Associate',
  RIDER: 'Rider',
  MANAGER: 'Manager',
  ASSOCIATE: 'Associate',
};

const ROLE_ACCENT: Record<string, string> = {
  PICKER: '#a78bfa',
  INBOUND: '#fb923c',
  PUTAWAY: '#15803d',
  INVENTORY: '#60a5fa',
  RIDER: '#059669',
  MANAGER: '#6d4aff',
  ASSOCIATE: '#6d4aff',
};

export default function HomeScreen({ onNavigate }: { onNavigate: (t: HomeTarget) => void }) {
  const { user, facility, department, logout } = useAuth();
  const [dash, setDash] = useState<Dashboard>({});
  const [manager, setManager] = useState<ManagerData>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const data = await api.dashboard();
      setDash(data?.dashboard || {});
      setManager(data?.manager || {});
      setError(null);
    } catch (err: any) {
      setError(err?.body?.error || err?.message || null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isDS = facility?.site_type === 'DS';
  const dept = department || 'ASSOCIATE';
  const roleLabel = DEPARTMENT_LABEL[dept] || user?.role?.replace(/_/g, ' ') || 'Associate';
  const accent = ROLE_ACCENT[dept] || '#6d4aff';

  const isManager = dept === 'MANAGER' || user?.role === 'SUPER_ADMIN' || user?.role === 'OPS_MANAGER';
  const isPicker = dept === 'PICKER';
  const isInbound = dept === 'INBOUND' || dept === 'PUTAWAY';
  const isInventory = dept === 'INVENTORY';
  const isAssociate = dept === 'ASSOCIATE' || !DEPARTMENT_LABEL[dept] || dept === '';

  const canSeeAll = isManager || isAssociate;
  const canPick = canSeeAll || isPicker;
  const canReceive = canSeeAll || isInbound;
  const canCount = canSeeAll || isInventory;
  const showManagerHub = isManager;

  const pending = canSeeAll ? (manager.orders_pending ?? 0) : (dash.today_tasks ?? 0);
  const completed = canSeeAll ? (manager.orders_delivered ?? 0) : (dash.completed_today ?? 0);

  const cta = isPicker
    ? { label: 'Start Picking', action: 'picking' as HomeTarget }
    : isInbound && dept === 'INBOUND'
      ? { label: 'Start Receiving', action: 'inbound' as HomeTarget }
      : dept === 'PUTAWAY'
        ? { label: 'Start Putaway', action: 'inbound' as HomeTarget }
        : isInventory
          ? { label: 'Start Audit', action: 'inventory' as HomeTarget }
          : { label: 'View Today’s Work', action: 'tasks' as HomeTarget };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: TOP_INSET + 8, paddingBottom: 36 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={C.yellow}
            colors={[C.yellow]}
            progressBackgroundColor={C.card}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Brand bar */}
        <View style={s.brandBar}>
          <View style={s.brandLeft}>
            <Image source={zippzoLogo} style={s.logoImg} resizeMode="contain" accessibilityLabel="Zippzo" />
          </View>
          <TouchableOpacity style={s.bellBtn} onPress={() => onNavigate('tasks')} accessibilityLabel="Today's tasks">
            <Ionicons name="notifications" size={18} color="#6d4aff" />
          </TouchableOpacity>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {/* Associate identity */}
        <View style={s.identity}>
          <View style={s.avatar}>
            <Ionicons name="person" size={30} color="#f4f4f7" />
          </View>
          <Text style={s.hello}>Hello,</Text>
          <Text style={s.name} numberOfLines={1}>{user?.full_name || user?.email?.split('@')[0] || 'Associate'}</Text>
          <View style={[s.rolePill, { borderColor: accent, backgroundColor: `${accent}22` }]}>
            <View style={[s.roleDot, { backgroundColor: accent }]} />
            <Text style={[s.roleText, { color: accent }]}>{roleLabel}</Text>
          </View>
          <Text style={s.shift}>Shift: 9 AM – 5 PM  ·  {facility?.code || 'DS'} </Text>
        </View>

        {/* Task stats */}
        <View style={s.statsRow}>
          <View style={s.statTile}>
            <Text style={s.statNum}>{pending}</Text>
            <Text style={s.statLab}>Pending</Text>
          </View>
          <View style={s.statTile}>
            <Text style={s.statNum}>{completed}</Text>
            <Text style={s.statLab}>Completed</Text>
          </View>
        </View>

        <TouchableOpacity style={s.cta} onPress={() => onNavigate(cta.action)} activeOpacity={0.85}>
          <Text style={s.ctaText}>{cta.label}</Text>
          <Ionicons name="arrow-forward" size={16} color="#f4f4f7" />
        </TouchableOpacity>

        {/* Store strip */}
        <View style={s.storeStrip}>
          <Ionicons name="storefront-outline" size={13} color="#52525b" />
          <Text style={s.storeText}>Store: {facility?.name || facility?.code || 'Dark Store'}</Text>
        </View>

        {/* Sections */}
        <Text style={s.section}>TODAY’S WORK</Text>

        {showManagerHub ? (
          <TouchableOpacity style={s.row} onPress={() => onNavigate('manager')}>
            <View style={[s.rowIcon, { backgroundColor: 'rgba(109,74,255,0.15)' }]}>
              <Ionicons name="stats-chart-outline" size={18} color="#6d4aff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Store Manager</Text>
              <Text style={s.rowMeta}>Live orders · departments · tracking</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />
          </TouchableOpacity>
        ) : null}

        {canPick ? (
          <TouchableOpacity style={s.row} onPress={() => onNavigate('picking')}>
            <View style={[s.rowIcon, { backgroundColor: 'rgba(167,139,250,0.15)' }]}>
              <Ionicons name="basket-outline" size={18} color="#a78bfa" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Order Picking</Text>
              <Text style={s.rowMeta}>Scan · pick · rack drop</Text>
            </View>
            {(dash.picking ?? 0) > 0 ? <View style={s.badge}><Text style={s.badgeText}>{dash.picking}</Text></View> : <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />}
          </TouchableOpacity>
        ) : null}

        {canReceive ? (
          <TouchableOpacity style={s.row} onPress={() => onNavigate('inbound')}>
            <View style={[s.rowIcon, { backgroundColor: 'rgba(251,146,60,0.15)' }]}>
              <Ionicons name="download-outline" size={18} color="#fb923c" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Inbound</Text>
              <Text style={s.rowMeta}>Consignment · QC · Putaway</Text>
            </View>
            {(dash.inbound_pending ?? 0) > 0 ? <View style={s.badge}><Text style={s.badgeText}>{dash.inbound_pending}</Text></View> : <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />}
          </TouchableOpacity>
        ) : null}

        {isDS && canReceive ? (
          <TouchableOpacity style={s.row} onPress={() => onNavigate('dsinbound')}>
            <View style={[s.rowIcon, { backgroundColor: 'rgba(74,222,128,0.12)' }]}>
              <Ionicons name="storefront-outline" size={18} color="#15803d" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>DS Inbound</Text>
              <Text style={s.rowMeta}>Receive totes · shelf putaway</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />
          </TouchableOpacity>
        ) : null}

        {canCount ? (
          <TouchableOpacity style={s.row} onPress={() => onNavigate('inventory')}>
            <View style={[s.rowIcon, { backgroundColor: 'rgba(96,165,250,0.15)' }]}>
              <Ionicons name="layers-outline" size={18} color="#60a5fa" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Inventory</Text>
              <Text style={s.rowMeta}>Balances · audit · cycle count</Text>
            </View>
            {(dash.inventory_tasks ?? 0) > 0 ? <View style={s.badge}><Text style={s.badgeText}>{dash.inventory_tasks}</Text></View> : <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />}
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={s.row} onPress={() => onNavigate('tasks')}>
          <View style={[s.rowIcon, { backgroundColor: 'rgba(203,179,224,0.10)' }]}>
            <Ionicons name="albums-outline" size={18} color="#52525b" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>My Tasks</Text>
            <Text style={s.rowMeta}>Today’s assigned work</Text>
          </View>
          {(dash.today_tasks ?? 0) > 0 ? <View style={s.badge}><Text style={s.badgeText}>{dash.today_tasks}</Text></View> : <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />}
        </TouchableOpacity>

        {canCount || showManagerHub ? (
          <TouchableOpacity style={s.row} onPress={() => onNavigate('product-registration')}>
            <View style={[s.rowIcon, { backgroundColor: 'rgba(109,74,255,0.15)' }]}>
              <Ionicons name="add-circle-outline" size={18} color="#6d4aff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Add Product</Text>
              <Text style={s.rowMeta}>Register SKU · list · price</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />
          </TouchableOpacity>
        ) : null}

        {canSeeAll || canPick ? (
          <TouchableOpacity style={s.row} onPress={() => onNavigate('outbound')}>
            <View style={[s.rowIcon, { backgroundColor: 'rgba(248,113,113,0.12)' }]}>
              <Ionicons name="share-outline" size={18} color="#b91c1c" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Outbound</Text>
              <Text style={s.rowMeta}>Pick · Pack · Transfers</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#a1a1aa" />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity style={s.signOut} onPress={logout}>
          <Ionicons name="log-out-outline" size={15} color="#a1a1aa" />
          <Text style={s.signOutText}>Sign out</Text>
        </TouchableOpacity>

        {/* Brand banner */}
        <View style={s.banner}>
          <Text style={s.bannerText}>FAST. FRESH. AT YOUR DOOR.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  brandBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, marginBottom: 10 },
  brandLeft: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoImg: { width: 130, height: 44 },
  bellBtn: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(109,74,255,0.12)', borderWidth: 1, borderColor: 'rgba(109,74,255,0.3)', alignItems: 'center', justifyContent: 'center' },

  error: { color: '#b91c1c', fontSize: 12, marginHorizontal: 18, marginBottom: 8 },

  identity: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 18 },
  avatar: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#6d4aff', alignItems: 'center', justifyContent: 'center', marginBottom: 8, borderWidth: 3, borderColor: 'rgba(109,74,255,0.35)' },
  hello: { color: '#52525b', fontSize: 13 },
  name: { color: '#18181b', fontSize: 22, fontWeight: '900', letterSpacing: -0.4, marginTop: 1 },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 },
  roleDot: { width: 7, height: 7, borderRadius: 4 },
  roleText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  shift: { color: '#a1a1aa', fontSize: 11.5, marginTop: 8, fontWeight: '700' },

  statsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 12, marginBottom: 14 },
  statTile: { flex: 1, backgroundColor: '#ececef', borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: '#ececef' },
  statNum: { color: '#18181b', fontSize: 24, fontWeight: '900' },
  statLab: { color: '#52525b', fontSize: 10, fontWeight: '700', marginTop: 2, letterSpacing: 0.3 },

  cta: {
    marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#6d4aff', borderRadius: 999, paddingVertical: 14,
    shadowColor: '#6d4aff', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 6,
  },
  ctaText: { color: '#ffffff', fontSize: 15, fontWeight: '900', letterSpacing: 0.2 },

  storeStrip: { alignItems: 'center', marginTop: 12, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  storeText: { color: '#52525b', fontSize: 11.5, fontWeight: '700' },

  section: { color: '#a1a1aa', fontSize: 10, fontWeight: '900', letterSpacing: 1.6, marginHorizontal: 18, marginTop: 20, marginBottom: 9 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    marginHorizontal: 16, backgroundColor: '#f4f4f5',
    borderRadius: 13, padding: 11, marginBottom: 8,
    borderWidth: 1, borderColor: '#ececef',
  },
  rowIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: '#18181b', fontSize: 14, fontWeight: '800' },
  rowMeta: { color: '#a1a1aa', fontSize: 10.5, marginTop: 1 },
  badge: { backgroundColor: 'rgba(109,74,255,0.18)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(109,74,255,0.4)' },
  badgeText: { color: '#6d4aff', fontSize: 11, fontWeight: '900' },

  signOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 18, marginTop: 6 },
  signOutText: { color: '#a1a1aa', fontSize: 12, fontWeight: '700' },

  banner: { marginHorizontal: 16, marginTop: 2, backgroundColor: '#6d4aff', borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  bannerText: { color: '#ffffff', fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1 },
});
