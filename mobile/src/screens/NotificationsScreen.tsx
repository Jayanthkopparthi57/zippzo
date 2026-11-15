import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, extractList } from '../api';
import { useAuth } from '../auth';
import { C, TOP_INSET, Empty } from '../components/Ui';

type Notice = {
  notification_id: string;
  title?: string;
  body?: string;
  kind?: string;
  created_at?: string;
  read_at?: string | null;
};

/**
 * Notifications — everything the store has pushed to me.
 */
export default function NotificationsScreen() {
  const { user } = useAuth();
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const resp = await api.shopperNotifications();
      const list = Array.isArray(resp) ? resp : extractList<Notice>(resp) || [];
      setItems(list);
      setError(null);
    } catch (e: any) {
      setError(e?.body?.error || e?.message || 'Could not load notifications');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unread = items.filter((n) => !n.read_at).length;

  const timeAgo = (iso?: string) => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <View style={s.root}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Alerts</Text>
          <Text style={s.sub}>{unread > 0 ? `${unread} unread` : `${items.length} total`}</Text>
        </View>
        {unread > 0 ? (
          <TouchableOpacity style={s.markAll} onPress={() => api.markAllShopperNotificationsRead().then(() => load(true)).catch(() => {})}>
            <Text style={s.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={s.error} onPress={() => load(true)}>{error} — tap to retry</Text>
      ) : items.length === 0 ? (
        <Empty msg="You will see delivery updates, offers and store alerts here." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.notification_id}
          contentContainerStyle={{ padding: 14, paddingBottom: 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.yellow} colors={[C.yellow]} progressBackgroundColor={C.card} />}
          renderItem={({ item }) => {
            const isUnread = !item.read_at;
            return (
              <View style={[s.row, isUnread && s.rowUnread]}>
                <View style={s.iconWrap}>
                  <Ionicons name={item.kind === 'ORDER' ? 'cube-outline' : 'notifications-outline'} size={18} color={C.yellow} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle} numberOfLines={2}>{item.title || 'Update'}</Text>
                  {item.body ? <Text style={s.rowBody} numberOfLines={2}>{item.body}</Text> : null}
                  <Text style={s.rowTime}>{timeAgo(item.created_at)}</Text>
                </View>
                {isUnread ? <View style={s.dot} /> : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingTop: TOP_INSET + 8 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: C.text, fontSize: 23, fontWeight: '900', letterSpacing: -0.4 },
  sub: { color: C.sub, fontSize: 11.5, marginTop: 2 },
  markAll: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  markAllText: { color: C.yellow, fontSize: 11.5, fontWeight: '800' },
  error: { color: C.red, fontSize: 13, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    backgroundColor: C.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  rowUnread: { borderColor: 'rgba(109,74,255,0.35)', backgroundColor: 'rgba(109,74,255,0.05)' },
  iconWrap: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(109,74,255,0.10)', borderWidth: 1, borderColor: 'rgba(109,74,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  rowBody: { color: C.sub, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  rowTime: { color: C.faint, fontSize: 10, marginTop: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.yellow, marginTop: 4 },
});
