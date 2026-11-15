import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { api } from '../api';
import { Task } from '../types';
import { C, TOP_INSET, Empty } from '../components/Ui';

/**
 * History — everything I have done or am doing at this facility.
 * Reads the same my-work feed as the Tasks tab; finished ones float to the bottom.
 */
export default function HistoryScreen({ onOpenTask }: { onOpenTask: (t: Task) => void }) {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    try {
      const resp = await api.myWork();
      setTasks(resp.tasks || []);
      setError(null);
    } catch (e: any) {
      setError(e?.body?.error || e?.message || 'Could not load history');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sorted = [...tasks].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const iconFor = (kind: string): keyof typeof Ionicons.glyphMap =>
    kind === 'PICK' ? 'basket-outline' : kind === 'PACK' ? 'cube-outline' : kind === 'PUTAWAY' ? 'arrow-down-circle-outline' : 'albums-outline';

  const doneStatuses = ['COMPLETED', 'DONE', 'CLOSED', 'CONFIRMED', 'DELIVERED'];

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>History</Text>
        <Text style={s.sub}>{tasks.length} item{tasks.length === 1 ? '' : 's'} at this facility</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={s.error} onPress={() => load(true)}>{error} — tap to retry</Text>
      ) : sorted.length === 0 ? (
        <Empty msg="Your completed and pending work will appear here." />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 90 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.yellow} colors={[C.yellow]} progressBackgroundColor={C.card} />}
          renderItem={({ item }) => {
            const done = doneStatuses.includes(String(item.status).toUpperCase());
            return (
              <View style={s.row}>
                <View style={[s.iconWrap, done ? s.iconDone : s.iconOpen]}>
                  <Ionicons name={iconFor(item.kind)} size={18} color={done ? '#15803d' : C.yellow} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={s.rowSub} numberOfLines={1}>{item.subtitle} · {String(item.status).toLowerCase().replace(/_/g, ' ')}</Text>
                </View>
                <Ionicons name={done ? 'checkmark-circle' : 'time-outline'} size={17} color={done ? '#15803d' : C.faint} />
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
  header: { paddingHorizontal: 16, paddingBottom: 10 },
  title: { color: C.text, fontSize: 23, fontWeight: '900', letterSpacing: -0.4 },
  sub: { color: C.sub, fontSize: 11.5, marginTop: 2 },
  error: { color: C.red, fontSize: 13, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: C.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  iconWrap: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  iconOpen: { backgroundColor: 'rgba(109,74,255,0.10)', borderColor: 'rgba(109,74,255,0.3)' },
  iconDone: { backgroundColor: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.3)' },
  rowTitle: { color: C.text, fontSize: 13.5, fontWeight: '800' },
  rowSub: { color: C.sub, fontSize: 11, marginTop: 2 },
});
