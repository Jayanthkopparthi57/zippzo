import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/auth';
import HomeScreen, { HomeTarget } from './src/screens/HomeScreen';
import InboundScreen, { InboundTarget } from './src/screens/InboundScreen';
import ConsignmentScreen from './src/screens/ConsignmentScreen';
import { QcListScreen, QcDetailScreen } from './src/screens/QcScreens';
import { PutawayListScreen, PutawayDetailScreen } from './src/screens/PutawayScreens';
import InventoryScreen from './src/screens/InventoryScreen';
import OutboundScreen from './src/screens/OutboundScreen';
import DsInboundScreen from './src/screens/DsInboundScreen';
import MyWorkScreen from './src/screens/MyWorkScreen';
import TaskDetailScreen from './src/screens/TaskDetailScreen';
import PickingFlowScreen from './src/screens/PickingFlowScreen';
import ProductRegistrationScreen from './src/screens/ProductRegistrationScreen';
import ManagerScreen from './src/screens/ManagerScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import { api } from './src/api';
import { GrnLine, PutawayTaskDetail, Task } from './src/types';
import ShopperApp from './src/shopper/ShopperApp';
import RiderApp from './src/rider/RiderApp';
import AuthScreen from './src/screens/AuthScreen';

type Route =
  | { name: 'home' }
  | { name: 'tasks' }
  | { name: 'history' }
  | { name: 'notifications' }
  | { name: 'inbound' }
  | { name: 'consignment' }
  | { name: 'qc' }
  | { name: 'qc-detail'; line: GrnLine }
  | { name: 'putaway' }
  | { name: 'putaway-detail'; task: PutawayTaskDetail }
  | { name: 'inventory' }
  | { name: 'outbound' }
  | { name: 'dsinbound' }
  | { name: 'picking' }
  | { name: 'manager' }
  | { name: 'product-registration' }
  | { name: 'task-detail'; task: Task };

function Root() {
  const { loading, user, needsFacility, needsOtp } = useAuth();
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [grnLines, setGrnLines] = useState<GrnLine[]>([]);
  const [putawayTasks, setPutawayTasks] = useState<PutawayTaskDetail[]>([]);

  const loadInbound = useCallback(async () => {
    const [lines, puts] = await Promise.all([
      api.listGrnLines({ received_qty__gte: 1 }).catch(() => [] as GrnLine[]),
      api.listPutawayTasks({}).catch(() => [] as PutawayTaskDetail[]),
    ]);
    setGrnLines(lines);
    setPutawayTasks(puts);
  }, []);

  useEffect(() => {
    if (user) loadInbound();
  }, [user, loadInbound]);

  // Refresh inbound queues when returning to them.
  useEffect(() => {
    if (route.name === 'qc' || route.name === 'putaway' || route.name === 'inbound') {
      loadInbound();
    }
  }, [route.name, loadInbound]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#f5c518" />
        <Text style={styles.text}>Loading…</Text>
      </View>
    );
  }
  if (!user) return <AuthScreen />;

  const qcPending = grnLines.filter((l) => (l.received_qty || 0) > (l.accepted_qty || 0) + (l.damaged_qty || 0)).length;
  const putPending = putawayTasks.filter((t) => t.status !== 'CONFIRMED' && (t.remaining_qty ?? 0) > 0).length;

  const goHome = () => setRoute({ name: 'home' });
  const goInboundScreen = (t: InboundTarget) => {
    if (t === 'consignment') setRoute({ name: 'consignment' });
    else if (t === 'qc') setRoute({ name: 'qc' });
    else setRoute({ name: 'putaway' });
  };
  const goHomeTarget = (t: HomeTarget | 'history' | 'notifications') => {
    if (t === 'history') setRoute({ name: 'history' });
    else if (t === 'notifications') setRoute({ name: 'notifications' });
    else if (t === 'tasks') setRoute({ name: 'tasks' });
    else if (t === 'inbound') setRoute({ name: 'inbound' });
    else if (t === 'inventory') setRoute({ name: 'inventory' });
    else if (t === 'dsinbound') setRoute({ name: 'dsinbound' });
    else if (t === 'picking') setRoute({ name: 'picking' });
    else if (t === 'manager') setRoute({ name: 'manager' });
    else if (t === 'product-registration') setRoute({ name: 'product-registration' });
    else setRoute({ name: 'outbound' });
  };

  const tabBar = (
    <View style={styles.tabBar}>
      {([
        { key: 'home', icon: 'home', iconOff: 'home-outline', label: 'Home' },
        { key: 'tasks', icon: 'clipboard', iconOff: 'clipboard-outline', label: 'Tasks' },
        { key: 'history', icon: 'time', iconOff: 'time-outline', label: 'History' },
        { key: 'notifications', icon: 'notifications', iconOff: 'notifications-outline', label: 'Alerts' },
      ] as const).map((tab) => {
        const active = route.name === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tabItem}
            onPress={() => setRoute({ name: tab.key } as Route)}
            activeOpacity={0.7}
            accessibilityLabel={tab.label}
          >
            <Ionicons
              name={(active ? tab.icon : tab.iconOff) as keyof typeof Ionicons.glyphMap}
              size={21}
              color={active ? '#f5c518' : '#8f6fae'}
            />
            <Text style={[styles.tabLabel, active && styles.tabLabelOn]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const withTabs = (content: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: '#2e0842' }}>
      <View style={{ flex: 1 }}>{content}</View>
      {tabBar}
    </View>
  );

  switch (route.name) {
    case 'home':
      return withTabs(<HomeScreen onNavigate={goHomeTarget} />);
    case 'tasks':
      return withTabs(
        <MyWorkScreen
          onBack={goHome}
          onOpenTask={(t) => {
            // PUTAWAY has its own scan-to-bin detail. PICK/PACK are order
            // flows, not bin-place — send them to Outbound instead of the
            // putaway TaskDetailScreen.
            if (t.kind === 'PUTAWAY') {
              const task = putawayTasks.find((p) => p.task_id === t.id);
              if (task) setRoute({ name: 'putaway-detail', task });
              else { setSelectedTask(t); setRoute({ name: 'task-detail', task: t }); }
            } else {
              setSelectedTask(t);
              setRoute({ name: 'outbound' });
            }
          }}
        />
      );
    case 'history':
      return withTabs(
        <HistoryScreen
          onOpenTask={(t) => {
            if (t.kind === 'PUTAWAY') {
              const task = putawayTasks.find((p) => p.task_id === t.id);
              if (task) setRoute({ name: 'putaway-detail', task });
              else { setSelectedTask(t); setRoute({ name: 'task-detail', task: t }); }
            } else {
              setSelectedTask(t);
              setRoute({ name: 'outbound' });
            }
          }}
        />
      );
    case 'notifications':
      return withTabs(<NotificationsScreen />);
    case 'task-detail':
      return <TaskDetailScreen task={route.task} onBack={() => setRoute({ name: 'tasks' })} />;
    case 'inbound':
      return <InboundScreen counts={{ qc: qcPending, putaway: putPending, grn: grnLines.length }} onNavigate={goInboundScreen} onBack={goHome} />;
    case 'consignment':
      return <ConsignmentScreen onBack={() => setRoute({ name: 'inbound' })} />;
    case 'qc': {
      const pending = grnLines.filter((l) => (l.received_qty || 0) > (l.accepted_qty || 0) + (l.damaged_qty || 0));
      return (
        <QcListScreen
          lines={grnLines}
          onBack={() => setRoute({ name: 'inbound' })}
          onOpen={(line) => setRoute({ name: 'qc-detail', line })}
          onRefresh={loadInbound}
        />
      );
    }
    case 'qc-detail': {
      const pending = grnLines.filter((l) => (l.received_qty || 0) > (l.accepted_qty || 0) + (l.damaged_qty || 0));
      const idx = pending.findIndex((l) => l.line_id === route.line.line_id);
      const next = pending[idx + 1] || pending[0];
      return (
        <QcDetailScreen
          line={route.line}
          onBack={() => setRoute({ name: 'qc' })}
          onSaved={(saved) => {
            setGrnLines((prev) => prev.map((l) => (l.line_id === saved.line_id ? saved : l)));
          }}
          onNext={() => {
            if (next && next.line_id !== route.line.line_id) setRoute({ name: 'qc-detail', line: next });
            else setRoute({ name: 'qc' });
          }}
        />
      );
    }
    case 'putaway':
      return (
        <PutawayListScreen
          tasks={putawayTasks}
          onBack={() => setRoute({ name: 'inbound' })}
          onOpen={(task) => setRoute({ name: 'putaway-detail', task })}
          onRefresh={loadInbound}
        />
      );
    case 'putaway-detail': {
      const open = putawayTasks.filter((t) => t.status !== 'CONFIRMED' && (t.remaining_qty ?? 0) > 0);
      const idx = open.findIndex((t) => t.task_id === route.task.task_id);
      const next = open[idx + 1] || open[0];
      return (
        <PutawayDetailScreen
          task={route.task}
          onBack={() => setRoute({ name: 'putaway' })}
          onDone={(done) => {
            setPutawayTasks((prev) => prev.map((t) => (t.task_id === done.task_id ? done : t)));
          }}
          onNext={() => {
            if (next && next.task_id !== route.task.task_id) setRoute({ name: 'putaway-detail', task: next });
            else setRoute({ name: 'putaway' });
          }}
        />
      );
    }
    case 'inventory':
      return <InventoryScreen onBack={goHome} />;
    case 'outbound':
      return <OutboundScreen onBack={goHome} />;
    case 'dsinbound':
      return <DsInboundScreen onBack={goHome} />;
    case 'picking':
      return <PickingFlowScreen onBack={goHome} />;
    case 'manager':
      return <ManagerScreen onBack={goHome} />;
    case 'product-registration':
      return <ProductRegistrationScreen onBack={goHome} />;
    default:
      return <HomeScreen onNavigate={goHomeTarget} />;
  }
}

export default function App() {
  // The rider build is its own product: it must never fall through into the
  // warehouse shell, and the activation gate owns the whole screen until the
  // store QR has been scanned.
  if (process.env.EXPO_PUBLIC_APP_VARIANT === 'rider') {
    return (
      <AuthProvider>
        <StatusBar style="light" />
        <RiderApp />
      </AuthProvider>
    );
  }
  return (
    <AuthProvider>
      <StatusBar style="light" />
      {process.env.EXPO_PUBLIC_APP_VARIANT === 'shopper' ? <ShopperApp /> : <Root />}
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#2e0842' },
  text: { color: '#cbb3e0', marginTop: 8 },
  tabBar: {
    flexDirection: 'row', height: 56,
    backgroundColor: '#2a0735', borderTopWidth: 1, borderColor: '#4a154f',
    paddingBottom: 2,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { color: '#8f6fae', fontSize: 9.5, fontWeight: '700' },
  tabLabelOn: { color: '#f5c518', fontWeight: '900' },
});
