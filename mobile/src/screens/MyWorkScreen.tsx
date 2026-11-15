import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { api } from '../api';
import { Task } from '../types';
import { C } from '../components/Ui';
import { isToday } from '../utils';

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

/**
 * My Tasks — today's work based on user role + task assignment.
 *
 * Server (MyWorkView) already scopes everything to the session facility, so a
 * DS picker never sees MH work (and vice versa). Here we bucket that into
 * Assigned-to-me (assigned_to === mine) vs Team queue (unassigned), and pull
 * today's items to the top so the list reads as a daily todo list.
 */
export default function MyWorkScreen({ onOpenTask, onBack }: { onOpenTask: (task: Task) => void; onBack?: () => void }) {
  const { facility, user, logout } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const resp = await api.myWork();
      setTasks(resp.tasks || []);
    } catch (err: any) {
      setError(err?.body?.error || err?.body?.detail || err?.message || 'Could not load work');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const mine = tasks.filter((t) => t.assigned_to && user && String(t.assigned_to) === String(user.user_id));
  const queue = tasks.filter((t) => !(t.assigned_to && user && String(t.assigned_to) === String(user.user_id)));
  const todays = tasks.filter((t) => isToday(t.created_at));
  const isDS = facility?.site_type === 'DS';

  const renderTask = ({ item }: { item: Task }) => (
    <TouchableOpacity style={s.card} onPress={() => onOpenTask(item)} activeOpacity={0.85}>
      <View style={s.cardHead}>
        <View style={s.kindChip}>
          <Text style={s.kind}>{item.kind}</Text>
        </View>
        {isToday(item.created_at) ? <Text style={s.today}>TODAY</Text> : null}
      </View>
      <Text style={s.cardTitle}>{item.title}</Text>
      <Text style={s.cardSub}>
        {item.subtitle} · {item.status}{item.assigned_to ? ' · assigned' : ' · team queue'}
      </Text>
      <View style={s.cardFoot}>
        {item.remaining_qty != null ? <Text style={s.remaining}>{item.remaining_qty} left</Text> : <View />}
        <Ionicons name="chevron-forward" size={15} color={C.faint} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 4 }}>
              <Ionicons name="chevron-back" size={15} color={C.yellow} />
              <Text style={s.back}>Back</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={s.title}>My Tasks</Text>
          <Text style={s.subtitle}>
            {facility?.name || facility?.code} · {user?.full_name} · {String(user?.role || '').replace(/_/g, ' ')}
          </Text>
          <Text style={s.subtitle}>
            {isDS ? 'Dark store work only' : 'Warehouse work only'} · {tasks.length} open · {todays.length} created today
          </Text>
        </View>
        <TouchableOpacity onPress={logout} style={s.logoutBtn} accessibilityLabel="Sign out">
          <Ionicons name="log-out-outline" size={17} color={C.red} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={s.error}>{error}</Text>
      ) : tasks.length === 0 ? (
        <Text style={s.empty}>No open tasks at this facility. New work appears here as soon as it is raised or assigned to you.</Text>
      ) : (
        <FlatList
          data={[]}
          ListHeaderComponent={
            <>
              {todays.length ? (
                <>
                  <Text style={s.section}>Today — do these first</Text>
                  {todays.map((t) => renderTask({ item: t }))}
                </>
              ) : null}
              {mine.length ? (
                <>
                  <Text style={s.section}>Assigned to me ({mine.length})</Text>
                  {mine.map((t) => renderTask({ item: t }))}
                </>
              ) : null}
              {queue.length ? (
                <>
                  <Text style={s.section}>Team queue ({queue.length})</Text>
                  {queue.map((t) => renderTask({ item: t }))}
                </>
              ) : null}
            </>
          }
          keyExtractor={() => 'h'}
          renderItem={() => null}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.yellow} />}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingTop: TOP_INSET + 12, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  back: { color: C.yellow, fontWeight: '800', marginBottom: 0, fontSize: 12 },
  title: { fontSize: 23, fontWeight: '900', color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 11.5, color: C.sub, marginTop: 3, lineHeight: 16 },
  logoutBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  logout: { color: C.red, fontWeight: '700', fontSize: 13 },
  section: { color: C.text, fontWeight: '900', fontSize: 14, marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: C.card, padding: 14, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kindChip: { backgroundColor: 'rgba(109,74,255,0.10)', borderWidth: 1, borderColor: 'rgba(109,74,255,0.3)', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 2.5 },
  kind: { fontSize: 9, fontWeight: '900', color: C.yellow, letterSpacing: 0.8 },
  today: { fontSize: 8.5, fontWeight: '900', color: '#6ee7b7', backgroundColor: 'rgba(52,211,153,0.13)', paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 999, overflow: 'hidden' },
  cardTitle: { color: C.text, fontWeight: '800', fontSize: 15, marginTop: 7 },
  cardSub: { color: C.sub, fontSize: 11.5, marginTop: 3 },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 },
  remaining: { color: C.sky, fontSize: 11, fontWeight: '800' },
  empty: { color: C.sub, textAlign: 'center', marginTop: 40, lineHeight: 20, paddingHorizontal: 24 },
  error: { color: C.red, marginTop: 20 },
});
