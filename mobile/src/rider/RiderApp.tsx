import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Modal, Platform, RefreshControl, SafeAreaView,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { CFEnvironment, CFSession } from 'cashfree-pg-api-contract';
import { CFPaymentGatewayService } from 'react-native-cashfree-pg-sdk';
import RiderMap from './RiderMap';
import { useAuth } from '../auth';
import { api, errMsg } from '../api';
import { C } from '../components/Ui';
import { Scanner } from '../components/Scanner';
import RiderLogin from './RiderLogin';
import { QrMatrix } from './QrMatrix';
import FacilityScreen from '../screens/FacilityScreen';
import OtpScreen from '../screens/OtpScreen';

/**
 * The delivery-partner app.
 *
 * The whole point of this variant is the order of the two gates:
 *
 *   1. sign in (phone + the daily store code, or email for office staff)
 *   2. scan the dark store's activation QR
 *
 * Until step 2 the rider is inactive: no shift, not online, no jobs. The DS
 * console prints that QR and the scan is what starts the FIFO shift, so it is
 * the store, not the phone, that puts a rider on duty.
 *
 * Once active the app is a single workload: jobs (with the customer's map pin
 * and phone), proof of delivery with cash or a Cashfree card / UPI / UPI-QR
 * capture, per-ride earnings, and the COD cash the rider still has to hand
 * back at the DS counter.
 */

type Task = any;
type Summary = any;

const ACTIVE_STATES = ['ACCEPTED', 'AT_DS', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED', 'POD_PENDING'];

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

const money = (value: any) => `₹${Number(value || 0).toFixed(2)}`;

const when = (value?: string | null) => value
  ? new Date(value).toLocaleString([], {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  : '—';

const clock = (value?: string | null) => value
  ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  : '—';

const titleCase = (value?: string | null) => String(value || '')
  .replace(/_/g, ' ')
  .toLowerCase()
  .replace(/\b\w/g, (c) => c.toUpperCase());

function payWithCashfree(payment: any): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      CFPaymentGatewayService.setCallback({
        onVerify: () => resolve(),
        onError: (err: any) => reject(new Error(err?.message || 'Payment was not completed.')),
      });
      const environment = payment.environment === 'production'
        ? CFEnvironment.PRODUCTION
        : CFEnvironment.SANDBOX;
      const session = new CFSession(
        payment.payment_session_id, payment.order_id, environment);
      CFPaymentGatewayService.doWebPayment(session);
    } catch (err) {
      reject(err);
    }
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function RiderApp() {
  const { loading, user, needsFacility, needsOtp } = useAuth();

  if (loading) {
    return (
      <View style={s.splash}>
        <ActivityIndicator size="large" color={C.yellow} />
        <Text style={s.splashText}>Opening Zippzo Rider…</Text>
      </View>
    );
  }
  if (!user) {
    if (needsFacility) return <FacilityScreen />;
    if (needsOtp) return <OtpScreen />;
    return <RiderLogin />;
  }
  return <RiderShell />;
}

function RiderShell() {
  const { user, logout } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'home' | 'jobs' | 'money' | 'history' | 'profile'>('home');
  const [scanner, setScanner] = useState<null | 'activation'>(null);
  const [podTask, setPodTask] = useState<Task | null>(null);
  const [qrInfo, setQrInfo] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const snapshot = await api.riderSummary();
      setSummary(snapshot);
      if (snapshot?.has_profile) {
        const rows = await api.deliveryTasks({});
        setTasks(Array.isArray(rows) ? rows : []);
      } else {
        setTasks([]);
      }
      setError('');
    } catch (err) {
      setError(errMsg(err, 'Could not load your rider details.'));
    } finally {
      setBooting(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const active = !!summary?.activation?.active;

  // Live position for the shopper's map and the ARRIVED geofence. Only while
  // the store has activated this rider; a dormant app must not track anyone.
  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      if (!active) return;
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (!perm.granted) return;
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 30000, distanceInterval: 75 },
          (position) => {
            setMyPos({ lat: position.coords.latitude, lng: position.coords.longitude });
            void api.riderLocation({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }).catch(() => undefined);
          },
        );
        if (cancelled) subscription?.remove();
      } catch {
        /* the app still works; only the live pin is missing */
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [active]);

  const flash = (message: string) => {
    setNotice(message);
    setError('');
  };

  const handleScan = async (data: string) => {
    if (scanner === 'activation') {
      setScanner(null);
      setBusy(true);
      try {
        await api.riderActivate(data);
        flash('Activated. Your shift is open and jobs are now offered to you.');
        await load();
      } catch (err) {
        setError(errMsg(err, 'That QR did not activate this rider.'));
      } finally {
        setBusy(false);
      }
    }
  };

  const withBusy = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError(errMsg(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const accept = (task: Task) => withBusy(async () => {
    await api.acceptDelivery(task.task_id);
    setTab('jobs');
    flash('Job accepted. Head to the store counter.');
    await load();
  }, 'Could not accept this job.');

  const decline = (task: Task) => withBusy(async () => {
    await api.declineDelivery(task.task_id);
    flash('Job handed back to the store queue.');
    await load();
  }, 'Could not decline this job.');

  const advance = (task: Task, to: string) => withBusy(async () => {
    await api.advanceDelivery(task.task_id, to);
    await load();
  }, 'The job could not move to the next step.');



  const endShift = () => {
    Alert.alert(
      'End this shift?',
      'You will be inactive and no jobs will be offered until you scan the dark store activation QR again.',
      [
        { text: 'Stay on shift', style: 'cancel' },
        {
          text: 'End shift',
          style: 'destructive',
          onPress: () => withBusy(async () => {
            if (summary?.activation?.shift_id) {
              await api.riderEndShift(summary.activation.shift_id);
            }
            if (summary?.profile?.rider_id) {
              await api.updateRider(summary.profile.rider_id, { is_online: false });
            }
            setQrInfo(null);
            setTab('home');
            await load();
          }, 'Could not end the shift.'),
        },
      ],
    );
  };

  const loadQr = () => withBusy(async () => {
    setQrInfo(await api.riderQr());
  }, 'Could not load your handoff QR.');

  // The counter scans this code on every handoff; the server rotates the row
  // to a fresh one at once. Pull it quietly in the background so whatever is
  // on screen is never a burnt code — a stale code fails their scan.
  const refreshQrQuiet = useCallback(async () => {
    try {
      setQrInfo(await api.riderQr());
    } catch {
      /* keep whatever is on screen */
    }
  }, []);

  // Auto-refresh the handoff QR while the profile tab is open. The counter
  // scans it on every delivery; each scan rotates the code. A manual GET is
  // all the rider app needs to stay current.
  useEffect(() => {
    if (tab !== 'profile' || !summary?.profile) return;
    refreshQrQuiet();
    const timer = setInterval(refreshQrQuiet, 15000);
    return () => clearInterval(timer);
  }, [tab, summary?.profile, refreshQrQuiet]);

  if (booting) {
    return (
      <View style={s.splash}>
        <ActivityIndicator size="large" color={C.yellow} />
        <Text style={s.splashText}>Checking your activation…</Text>
      </View>
    );
  }

  if (!summary) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.splash}>
          <Text style={s.splashText}>
            {error || 'Could not reach the Zippzo server.'}
          </Text>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => { setBooting(true); load(); }}
          >
            <Text style={s.primaryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!summary.has_profile) {
    return (
      <SafeAreaView style={s.safe}>
        <SetupView onDone={load} />
      </SafeAreaView>
    );
  }

  const profile = summary.profile || {};
  const stats = summary.stats || {};
  const mine = tasks.filter((t) => t.rider === profile.rider_id);
  const activeJobs = mine
    .filter((t) => ACTIVE_STATES.includes(t.status))
    .sort((a, b) => String(a.offered_at || '').localeCompare(String(b.offered_at || '')));
  const delivered = mine
    .filter((t) => t.status === 'DELIVERED')
    .sort((a, b) => String(b.delivered_at || '').localeCompare(String(a.delivered_at || '')));
  // The store stamps the chosen rider onto the task before it becomes OFFERED,
  // so "nobody owns it yet" is the wrong test: every direct offer was invisible
  // and the app told a rider with work waiting that there was nothing.
  const offers = tasks.filter((t) =>
    ['UNASSIGNED', 'OFFERED'].includes(t.status)
    && (!t.rider || t.rider === profile.rider_id)
    && (t.rider === profile.rider_id || t.site === profile.current_site));

  if (!active) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivationView
          summary={summary}
          busy={busy}
          error={error}
          notice={notice}
          onScan={() => { setError(''); setNotice(''); setScanner('activation'); }}
          onRefresh={load}
        />
        <Scanner
          visible={scanner === 'activation'}
          title="Scan the DS activation QR"
          subtitle="Point at the dark store check-in code. It starts your shift and puts you in the FIFO queue."
          onScan={handleScan}
          onClose={() => setScanner(null)}
        />
      </SafeAreaView>
    );
  }

  const jobBadge = activeJobs.length + offers.length;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View style={s.headerTop}>
          <View style={s.headerAvatar}>
            <Text style={s.headerAvatarText}>
              {(profile.name || user?.full_name || 'R').slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Image source={require('../assets/zippzo-logo.png')} style={s.logoSmall} resizeMode="contain" accessibilityLabel="Zippzo Rider" />
            <Text style={s.hello} numberOfLines={1}>{profile.name || user?.full_name || 'Rider'}</Text>
          </View>
          <TouchableOpacity
            style={s.refreshBtn}
            onPress={() => {
              setRefreshing(true);
              load();
            }}
            accessibilityLabel="Refresh"
          >
            {refreshing
              ? <ActivityIndicator color={C.yellow} size="small" />
              : <Ionicons name="refresh" size={19} color={C.yellow} />}
          </TouchableOpacity>
        </View>
        <View style={s.shiftPill}>
          <View style={s.dot} />
          <Text style={s.shiftPillText} numberOfLines={1}>
            On shift · {summary.activation.site || profile.current_site_code}
          </Text>
          <Text style={s.shiftPillMeta}>{clock(summary.activation.shift_started_at)}</Text>
        </View>
      </View>

      {error ? (
        <TouchableOpacity onPress={() => setError('')} style={s.bannerError}>
          <Text style={s.bannerErrorText}>{error}</Text>
        </TouchableOpacity>
      ) : null}
      {notice ? (
        <TouchableOpacity onPress={() => setNotice('')} style={s.bannerOk}>
          <Text style={s.bannerOkText}>{notice}</Text>
        </TouchableOpacity>
      ) : null}

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            tintColor={C.yellow}
            onRefresh={() => { setRefreshing(true); load(); }}
          />
        )}
      >
        {tab === 'home' ? (
          <>
            <View style={s.statsRow}>
              <Stat icon="flash-outline" label="Today" value={stats.deliveries_today ?? 0} />
              <Stat icon="calendar-outline" label="This week" value={stats.deliveries_week ?? 0} />
              <Stat icon="trophy-outline" label="Lifetime" value={stats.deliveries_total ?? 0} />
            </View>

            <View style={s.earnCard}>
              <View style={s.earnRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.earnLabel}>EARNED TODAY</Text>
                  <Text style={s.earnValue}>{money(stats.earnings_today)}</Text>
                </View>
                <View style={s.earnBadge}>
                  <Ionicons name="trending-up" size={19} color={C.yellow} />
                </View>
              </View>
              <View style={s.earnDivider} />
              <View style={s.earnFoot}>
                <View style={s.earnMiniCol}>
                  <Text style={s.earnMiniLabel}>THIS WEEK</Text>
                  <Text style={s.earnMini}>{money(stats.earnings_week)}</Text>
                </View>
                <View style={s.earnMiniCol}>
                  <Text style={s.earnMiniLabel}>LIFETIME</Text>
                  <Text style={s.earnMini}>{money(stats.earnings_total)}</Text>
                </View>
                <View style={s.earnMiniCol}>
                  <Text style={s.earnMiniLabel}>PENDING</Text>
                  <Text style={s.earnMini}>{money(stats.earnings_pending)}</Text>
                </View>
              </View>
            </View>

            {Number(stats.cash_to_remit || 0) > 0 ? (
              <TouchableOpacity style={s.cashBanner} onPress={() => setTab('money')}>
                <View style={{ flex: 1 }}>
                  <Text style={s.cashBannerTitle}>
                    Return {money(stats.cash_to_remit)} COD cash at the DS
                  </Text>
                  <Text style={s.cashBannerText}>
                    Hand it to the store cashier; they record the remit and clear your custody.
                  </Text>
                </View>
                <Text style={s.cashBannerArrow}>›</Text>
              </TouchableOpacity>
            ) : null}

            <SectionHead
              title={activeJobs.length ? 'Your current job' : 'No job in hand'}
              right={offers.length ? `${offers.length} waiting` : undefined}
            />
            {activeJobs.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyTitle}>Waiting for a job</Text>
                <Text style={s.emptyText}>
                  The store offers packed orders to riders on shift at this store.
                  Keep this screen open; it refreshes every 30 seconds.
                </Text>
              </View>
            ) : (
              activeJobs.slice(0, 1).map((task) => (
                <JobCard
                  key={task.task_id}
                  task={task}
                  busy={busy}
                  compact={false}
                  myPos={myPos}
                  onAdvance={advance}
                  onPod={setPodTask}
                />
              ))
            )}

            {offers.length ? (
              <TouchableOpacity style={s.offerTeaser} onPress={() => setTab('jobs')}>
                <Text style={s.offerTeaserTitle}>
                  {offers.length} job{offers.length === 1 ? '' : 's'} waiting for a rider
                </Text>
                <Text style={s.offerTeaserText}>Open Jobs to accept one</Text>
              </TouchableOpacity>
            ) : null}

            <SectionHead title="Shift" />
            <View style={s.panel}>
              <Row label="Store" value={summary.activation.site || '—'} />
              <Row label="Started" value={clock(summary.activation.shift_started_at)} />
              <Row label="Deliveries this shift" value={String(stats.deliveries_today ?? 0)} />
              <Row
                label="COD due on active jobs"
                value={money(stats.cod_due_on_active_jobs)}
              />
              <TouchableOpacity style={s.ghostBtn} onPress={endShift} disabled={busy}>
                <Text style={s.ghostBtnText}>End shift</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {tab === 'jobs' ? (
          <>
            {offers.length ? (
              <>
                <SectionHead title={`Waiting for a rider (${offers.length})`} />
                {offers.map((task) => (
                  <View key={task.task_id} style={s.panel}>
                    <View style={s.jobTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.orderNo}>{task.order_no}</Text>
                        <Text style={s.jobMeta}>
                          {task.order_weight_kg ? `${task.order_weight_kg} kg` : 'Weight pending'}
                          {task.requires_cold_chain ? ' · cold chain' : ''}
                          {task.staging_bin ? ` · staged at ${task.staging_bin}` : ''}
                        </Text>
                      </View>
                      <Text style={s.jobPay}>
                        {task.payment_method === 'COD' ? money(task.grand_total) : 'PAID'}
                      </Text>
                    </View>
                    <View style={s.rowBtns}>
                      <TouchableOpacity
                        style={[s.ghostBtn, s.rowBtn]}
                        onPress={() => decline(task)}
                        disabled={busy}
                      >
                        <Text style={s.ghostBtnText}>Not me</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.primaryBtn, s.rowBtn]}
                        onPress={() => accept(task)}
                        disabled={busy}
                      >
                        <Text style={s.primaryBtnText}>Accept job</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            <SectionHead title={`In hand (${activeJobs.length})`} />
            {activeJobs.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyTitle}>Nothing in hand</Text>
                <Text style={s.emptyText}>
                  Accepted jobs, their map pin, the customer's phone and the
                  next step all appear here.
                </Text>
              </View>
            ) : activeJobs.map((task) => (
              <JobCard
                key={task.task_id}
                task={task}
                busy={busy}
                compact={false}
                myPos={myPos}
                onAdvance={advance}
                onPod={setPodTask}
              />
            ))}
          </>
        ) : null}

        {tab === 'money' ? (
          <>
            <View style={s.statsRow}>
              <Stat icon="cash-outline" label="Cash in hand" value={money(stats.cash_to_remit)} />
              <Stat icon="wallet-outline" label="COD today" value={money(stats.cod_cash_today)} />
              <Stat icon="bag-handle-outline" label="Bags" value={summary.custody?.bags_in_custody ?? 0} />
            </View>

            <View style={s.remitCard}>
              <Text style={s.remitLabel}>Return to the DS</Text>
              <Text style={s.remitValue}>{money(stats.cash_to_remit)}</Text>
              <Text style={s.remitText}>
                This is COD cash you collected at the door. The DS cashier
                records the remit; riders never remit cash from the app.
              </Text>
              <Text style={s.remitText}>
                Ceiling {money(summary.custody?.ceiling_amount ?? 0)} · float{' '}
                {money(summary.custody?.current_float ?? 0)}
              </Text>
            </View>

            <SectionHead title="Ride earnings" />
            <View style={s.panel}>
              <Row label="Today" value={money(stats.earnings_today)} />
              <Row label="This week" value={money(stats.earnings_week)} />
              <Row label="Lifetime" value={money(stats.earnings_total)} />
              <Row label="Paid" value={money(stats.earnings_paid)} />
              <Row label="Pending payout" value={money(stats.earnings_pending)} />
            </View>

            {(summary.earnings || []).length ? (
              <View style={s.panel}>
                {(summary.earnings || []).map((earning: any) => (
                  <View key={earning.earning_id} style={s.listRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.listTitle}>{earning.order_no || 'Delivery'}</Text>
                      <Text style={s.listSub}>{when(earning.created_at)} · {earning.status}</Text>
                    </View>
                    <Text style={s.listAmount}>{money(earning.amount)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>
                  A ride pays its delivery fee when you close the delivery.
                </Text>
              </View>
            )}

            <SectionHead title="Cash trail" />
            {(summary.cash_movements || []).length ? (
              <View style={s.panel}>
                {(summary.cash_movements || []).map((movement: any) => (
                  <View key={movement.entry_id} style={s.listRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.listTitle}>{titleCase(movement.movement_type)}</Text>
                      <Text style={s.listSub}>
                        {when(movement.created_at)} · {movement.from_container || '—'} →{' '}
                        {movement.to_container || '—'}
                      </Text>
                    </View>
                    <Text style={s.listAmount}>{money(movement.amount)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>
                  COD collections, float and remits appear here once the store
                  records them.
                </Text>
              </View>
            )}
          </>
        ) : null}

        {tab === 'history' ? (
          <>
            <SectionHead title={`Delivered (${delivered.length})`} />
            {delivered.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyTitle}>No completed rides yet</Text>
                <Text style={s.emptyText}>Finished deliveries and their payout appear here.</Text>
              </View>
            ) : delivered.map((task) => (
              <View key={task.task_id} style={s.panel}>
                <View style={s.jobTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.orderNo}>{task.order_no}</Text>
                    <Text style={s.jobMeta}>{when(task.delivered_at)}</Text>
                    <Text style={s.jobMeta}>{task.delivery_address || 'Address hidden'}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.jobPay}>{money(task.delivery_fee)}</Text>
                    <Text style={s.paidSmall}>
                      {task.payment_method === 'COD' ? 'Cash collected' : 'Paid online'}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {tab === 'profile' ? (
          <>
            <View style={s.profileCard}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>
                  {(profile.name || user?.full_name || 'R').slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.profileName}>{profile.name || user?.full_name}</Text>
                <Text style={s.profileSub}>{profile.phone || user?.phone || 'No phone on file'}</Text>
                <Text style={s.profileSub}>{profile.vehicle_type || 'Vehicle'} · {profile.vehicle_number || '—'}</Text>
              </View>
            </View>

            <View style={s.panel}>
              <Row label="KYC" value={profile.kyc_status || '—'} />
              <Row label="Store" value={summary.activation.site || '—'} />
              <Row label="Rating" value={profile.rating != null ? String(profile.rating) : '—'} />
              <Row label="Handoffs" value={`${summary.activation.shift_id ? 'On shift' : 'Off shift'}`} />
              <Row label="Email" value={user?.email || '—'} />
            </View>

            <SectionHead title="My handoff QR" />
            <View style={[s.panel, { alignItems: 'center' }]}>
              {qrInfo ? (
                <>
                  <QrMatrix value={qrInfo.payload || qrInfo.code} size={200} />
                  <Text style={s.qrCode}>{qrInfo.code}</Text>
                  <Text style={s.qrNote}>
                    The DS counter scans this to hand you a tote. It rotates after
                    every scan — this screen refreshes itself while it is open.
                  </Text>
                  <TouchableOpacity style={s.ghostBtn} onPress={loadQr} disabled={busy}>
                    <Text style={s.ghostBtnText}>Refresh QR</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={s.qrNote}>
                    Show the store counter a fresh code when collecting a tote.
                  </Text>
                  <TouchableOpacity style={s.primaryBtn} onPress={loadQr} disabled={busy}>
                    <Text style={s.primaryBtnText}>Show my QR</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <TouchableOpacity style={s.ghostBtn} onPress={endShift} disabled={busy}>
              <Text style={s.ghostBtnText}>End shift</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.signOutBtn} onPress={() => logout()}>
              <Text style={s.signOutText}>Sign out</Text>
            </TouchableOpacity>
            <Text style={s.version}>Zippzo Rider · store-activated deliveries</Text>
          </>
        ) : null}
      </ScrollView>

      <View style={s.nav}>
        {([
          ['home', 'Home', 'home-outline', 'home', 0],
          ['jobs', 'Jobs', 'cube-outline', 'cube', jobBadge],
          ['money', 'Money', 'wallet-outline', 'wallet', 0],
          ['history', 'History', 'time-outline', 'time', 0],
          ['profile', 'Profile', 'person-outline', 'person', 0],
        ] as [typeof tab, string, keyof typeof Ionicons.glyphMap, keyof typeof Ionicons.glyphMap, number][]).map(([key, label, icon, iconOn, badge]) => (
          <TouchableOpacity
            key={key}
            style={s.navItem}
            onPress={() => setTab(key)}
            activeOpacity={0.7}
          >
            <View style={[s.navIconWrap, tab === key && s.navIconWrapOn]}>
              <Ionicons name={tab === key ? iconOn : icon} size={20} color={tab === key ? C.yellow : C.faint} />
              {badge > 0 ? (
                <View style={s.navBadge}><Text style={s.navBadgeText}>{badge}</Text></View>
              ) : null}
            </View>
            <Text style={[s.navLabel, tab === key && s.navLabelOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Scanner
        visible={scanner === 'activation'}
        title="Scan the DS activation QR"
        subtitle="Point at the dark store check-in code."
        onScan={handleScan}
        onClose={() => setScanner(null)}
      />

      <PodModal
        task={podTask}
        onClose={() => setPodTask(null)}
        onDone={async () => {
          setPodTask(null);
          flash('Delivered. Your ride earning has been credited.');
          await load();
          refreshQrQuiet();
        }}
        onRefresh={load}
      />
    </SafeAreaView>
  );
}

function ActivationView({
  summary, busy, error, notice, onScan, onRefresh,
}: {
  summary: Summary;
  busy: boolean;
  error: string;
  notice: string;
  onScan: () => void;
  onRefresh: () => void;
}) {
  const profile = summary.profile || {};
  return (
    <ScrollView contentContainerStyle={s.activationWrap}>
      <View style={s.lockCircle}><Ionicons name="qr-code-outline" size={34} color={C.yellow} /></View>
      <Text style={s.activationTitle}>Activation needed</Text>
      <Text style={s.activationText}>
        {profile.name || 'This rider'} is registered at{' '}
        {summary.activation?.site || profile.current_site_code || 'no store yet'} but
        is inactive. Scan the activation QR printed on the dark store's
        Authentication screen to open a shift and join the delivery queue.
      </Text>

      {error ? <Text style={s.activationError}>{error}</Text> : null}
      {notice ? <Text style={s.activationNotice}>{notice}</Text> : null}

      <TouchableOpacity style={s.bigScanBtn} onPress={onScan} disabled={busy}>
        <Ionicons name="scan-outline" size={21} color="#241503" />
        <Text style={s.bigScanText}>{busy ? 'Activating…' : 'Scan activation QR'}</Text>
      </TouchableOpacity>

      <View style={s.panel}>
        <Row label="Rider" value={profile.name || '—'} />
        <Row label="Phone" value={profile.phone || '—'} />
        <Row label="Vehicle" value={`${profile.vehicle_type || '—'} · ${profile.vehicle_number || '—'}`} />
        <Row label="KYC" value={profile.kyc_status || '—'} />
        <Row label="Home store" value={profile.current_site_code || '—'} />
      </View>

      <Text style={s.activationHint}>
        The QR changes nothing on your account; it records that the store has
        accepted you on shift today. If the code is unreadable, the scanner also
        accepts the store code typed by hand (for example DS-VERIFY-1).
      </Text>
      <TouchableOpacity style={s.ghostBtn} onPress={onRefresh} disabled={busy}>
        <Text style={s.ghostBtnText}>Refresh status</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SetupView({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('BIKE');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (!siteCode.trim()) {
      setError('Enter the dark store code you ride for.');
      return;
    }
    setBusy(true);
    try {
      await api.bootstrapRider(siteCode.trim().toUpperCase(), {
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        vehicle_type: vehicle,
        vehicle_number: vehicleNumber.trim() || undefined,
      });
      await onDone();
    } catch (err) {
      setError(errMsg(err, 'Could not create your rider profile.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.activationWrap}>
      <View style={s.activationBadge}><Text style={s.activationBadgeText}>Z</Text></View>
      <Text style={s.activationTitle}>Set up your rider profile</Text>
      <Text style={s.activationText}>
        Your sign-in worked but this account has no delivery profile yet.
        These details are what the store checks before handing you a tote.
      </Text>

      <View style={s.panel}>
        <Text style={s.label}>Full name</Text>
        <TextInput
          style={s.input}
          value={name}
          onChangeText={setName}
          placeholder="Name on your ID"
          placeholderTextColor={C.faint}
        />
        <Text style={s.label}>Phone</Text>
        <TextInput
          style={s.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="10-digit number"
          placeholderTextColor={C.faint}
          keyboardType="phone-pad"
        />
        <Text style={s.label}>Vehicle</Text>
        <View style={s.chips}>
          {['BIKE', 'SCOOTER', 'CYCLE', 'CAR'].map((value) => (
            <TouchableOpacity
              key={value}
              style={[s.chip, vehicle === value && s.chipOn]}
              onPress={() => setVehicle(value)}
            >
              <Text style={[s.chipText, vehicle === value && s.chipTextOn]}>{titleCase(value)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.label}>Vehicle number</Text>
        <TextInput
          style={s.input}
          value={vehicleNumber}
          onChangeText={setVehicleNumber}
          placeholder="KA-01-AB-1234"
          placeholderTextColor={C.faint}
          autoCapitalize="characters"
        />
        <Text style={s.label}>Home store code</Text>
        <TextInput
          style={s.input}
          value={siteCode}
          onChangeText={(v) => setSiteCode(v.toUpperCase())}
          placeholder="e.g. DS-BLR-01"
          placeholderTextColor={C.faint}
          autoCapitalize="characters"
        />
        <Text style={s.hint}>Ask your DS manager for the store code.</Text>
        {error ? <Text style={s.activationError}>{error}</Text> : null}
        <TouchableOpacity style={s.primaryBtn} onPress={submit} disabled={busy}>
          <Text style={s.primaryBtnText}>{busy ? 'Saving…' : 'Create profile'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function JobCard({
  task, busy, compact, onAdvance, onPod, myPos,
}: {
  task: Task;
  busy: boolean;
  compact: boolean;
  myPos?: { lat: number; lng: number } | null;
  onAdvance: (task: Task, to: string) => void;
  onPod: (task: Task) => void;
}) {
  const map = () => {
    const url = task.geo_lat && task.geo_lng
      ? `https://www.google.com/maps/dir/?api=1&destination=${task.geo_lat},${task.geo_lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.delivery_address || '')}`;
    Linking.openURL(url).catch(() => undefined);
  };
  const call = () => {
    if (task.customer_phone) {
      Linking.openURL(`tel:${task.customer_phone}`).catch(() => undefined);
    }
  };
  const step = (() => {
    switch (task.status) {
      case 'ACCEPTED':
        return { label: "I'm at the store", run: () => onAdvance(task, 'AT_DS') };
      case 'AT_DS':
        // The picker confirms the handoff at the store; the rider only taps
        // through once the order is physically in hand.
        return { label: 'Waiting for the store to hand it over…', run: () => null, disabled: true };
      case 'PICKED_UP':
        return { label: 'Start delivery', run: () => onAdvance(task, 'EN_ROUTE') };
      case 'EN_ROUTE':
        return { label: "I've arrived", run: () => onAdvance(task, 'ARRIVED') };
      case 'ARRIVED':
      case 'POD_PENDING':
        return { label: 'Complete delivery', run: () => onPod(task) };
      default:
        return null;
    }
  })();

  const paidOnline = task.payment_method !== 'COD' || task.payment_status === 'CAPTURED';

  return (
    <View style={s.jobCard}>
      <View style={s.jobTop}>
        <View style={{ flex: 1 }}>
          <View style={s.jobNoRow}>
            <View style={s.jobNoIcon}>
              <Ionicons name="cube-outline" size={14} color={C.yellow} />
            </View>
            <Text style={s.orderNo}>{task.order_no}</Text>
          </View>
          <View style={s.statusChip}>
            <View style={s.statusDot} />
            <Text style={s.statusChipText}>
              {titleCase(task.status)}{task.staging_bin ? ` · ${task.staging_bin}` : ''}
            </Text>
          </View>
        </View>
        <View style={s.jobPayBox}>
          <Text style={s.jobPay}>{money(task.delivery_fee)}</Text>
          <Text style={s.paidSmall}>RIDE PAY</Text>
        </View>
      </View>

      <RiderMap
        riderLat={myPos?.lat}
        riderLng={myPos?.lng}
        destLat={task.geo_lat}
        destLng={task.geo_lng}
        address={task.delivery_address}
      />

      <View style={s.addressBox}>
        <View style={s.addressHead}>
          <Ionicons name="person-circle-outline" size={17} color={C.yellow} />
          <Text style={s.addressName}>{task.customer_name || 'Customer'}</Text>
        </View>
        <View style={s.addressRow}>
          <Ionicons name="location-outline" size={14} color={C.faint} />
          <Text style={s.addressLine}>
            {task.delivery_address || 'The address appears once this job is yours.'}
          </Text>
        </View>
        {task.customer_phone ? (
          <View style={s.addressRow}>
            <Ionicons name="call-outline" size={13} color={C.faint} />
            <Text style={s.addressPhone}>{task.customer_phone}</Text>
          </View>
        ) : null}
      </View>

      <View style={[s.payPill, paidOnline ? s.payPillOk : s.payPillCash]}>
        <Ionicons
          name={paidOnline ? 'checkmark-circle' : 'cash'}
          size={13}
          color={paidOnline ? '#15803d' : C.yellow}
        />
        <Text style={[s.payPillText, paidOnline ? s.payPillTextOk : s.payPillTextCash]}>
          {paidOnline
            ? 'Paid online · collect nothing'
            : `Collect ${money(task.grand_total)} cash at the door`}
        </Text>
      </View>

      <View style={s.rowBtns}>
        {task.customer_phone ? (
          <TouchableOpacity style={[s.ghostBtn, s.rowBtn, s.btnInline]} onPress={call}>
            <Ionicons name="call" size={15} color={C.yellow} />
            <Text style={s.ghostBtnText}>Call</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={[s.ghostBtn, s.rowBtn, s.btnInline]} onPress={map}>
          <Ionicons name="navigate" size={15} color={C.yellow} />
          <Text style={s.ghostBtnText}>Navigate</Text>
        </TouchableOpacity>
      </View>

      {step ? (
        <TouchableOpacity
          style={[s.primaryBtn, step.disabled && s.primaryBtnDisabled]}
          onPress={step.disabled ? undefined : step.run}
          disabled={busy || step.disabled}
          accessibilityState={{ disabled: busy || step.disabled }}
        >
          <Text style={s.primaryBtnText}>{busy ? 'Working…' : step.label}</Text>
          {!busy && !step.disabled ? <Ionicons name="arrow-forward" size={16} color="#241503" /> : null}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function PodModal({
  task, onClose, onDone, onRefresh,
}: {
  task: Task | null;
  onClose: () => void;
  onDone: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [otp, setOtp] = useState('');
  const [mode, setMode] = useState<'cash' | 'online'>('cash');
  const [cash, setCash] = useState('');
  const [phone, setPhone] = useState('');
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (task) {
      setOtp('');
      setMode('cash');
      setCash(String(task.grand_total ?? ''));
      setPhone(task.customer_phone || '');
      setPaid(task.payment_method !== 'COD' || task.payment_status === 'CAPTURED');
      setBusy(false);
      setNote('');
      setError('');
    }
  }, [task?.task_id]);

  if (!task) return null;

  const cashDue = !paid;

  const sendCode = async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await api.podDelivery(task.task_id, '', undefined);
      // A successful close here means the order did not need a code.
      await onDone();
    } catch (err: any) {
      if (err?.status === 409 && err?.body?.otp_required) {
        setNote('A pickup code has been sent to the customer. Ask them to read it to you.');
      } else {
        setError(errMsg(err, 'Could not request a pickup code.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const collectOnline = async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const started = await api.riderStartDoorPayment(task.task_id, phone);
      await payWithCashfree(started.cashfree);
      let status: any = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        status = await api.riderDoorPaymentStatus(task.task_id);
        if (status.payment_status === 'CAPTURED' || status.attempt_status === 'EXPIRED') break;
        await wait(2000);
      }
      if (status?.payment_status === 'CAPTURED') {
        setPaid(true);
        setNote('Payment received by card / UPI. Now confirm the delivery with the customer code.');
        await onRefresh();
      } else {
        setNote(`Payment is ${status?.attempt_status || 'processing'}. Ask the customer to finish, or collect cash instead.`);
      }
    } catch (err: any) {
      if (err?.status === 400 && err?.body?.phone_required) {
        setError('Enter the customer mobile number, then try the card / UPI button again.');
      } else {
        setError(errMsg(err, 'The online payment could not be completed.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await api.podDelivery(
        task.task_id,
        otp.trim(),
        cashDue && mode === 'cash' ? Number(cash || 0) : undefined,
      );
      await onDone();
    } catch (err: any) {
      const body = err?.body || {};
      if (body.otp_required) {
        setNote(body.error || 'Ask the customer for their pickup code.');
      } else if (body.cod_required) {
        setNote(`${body.error} (${money(body.cod_due)} due)`);
      } else {
        setError(errMsg(err, 'The delivery could not be closed.'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.modalWrap}>
          <View style={s.modalHead}>
            <View style={{ flex: 1 }}>
              <Text style={s.modalTitle}>Proof of delivery</Text>
              <Text style={s.modalSub}>{task.order_no} · {task.customer_name || 'Customer'}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.modalClose} accessibilityLabel="Close">
              <Ionicons name="close" size={19} color={C.sub} />
            </TouchableOpacity>
          </View>

          <View style={s.panel}>
            <Text style={s.label}>Customer pickup code</Text>
            <TextInput
              style={[s.input, s.codeInput]}
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code"
              placeholderTextColor={C.faint}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TouchableOpacity style={s.ghostBtn} onPress={sendCode} disabled={busy}>
              <Text style={s.ghostBtnText}>Send / resend code to the customer</Text>
            </TouchableOpacity>
          </View>

          <View style={s.panel}>
            <Text style={s.panelTitle}>Money at the door</Text>
            {paid ? (
              <Text style={s.paidLine}>
                Paid online · {money(task.grand_total)}. Collect no cash.
              </Text>
            ) : (
              <>
                <View style={s.segment}>
                  <TouchableOpacity
                    style={[s.segmentItem, mode === 'cash' && s.segmentOn]}
                    onPress={() => setMode('cash')}
                  >
                    <Text style={[s.segmentText, mode === 'cash' && s.segmentTextOn]}>Cash</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.segmentItem, mode === 'online' && s.segmentOn]}
                    onPress={() => setMode('online')}
                  >
                    <Text style={[s.segmentText, mode === 'online' && s.segmentTextOn]}>
                      Card / UPI / QR
                    </Text>
                  </TouchableOpacity>
                </View>

                {mode === 'cash' ? (
                  <>
                    <Text style={s.label}>Cash collected</Text>
                    <TextInput
                      style={s.input}
                      value={cash}
                      onChangeText={setCash}
                      placeholder={String(task.grand_total ?? '')}
                      placeholderTextColor={C.faint}
                      keyboardType="decimal-pad"
                    />
                    <Text style={s.hint}>
                      Due {money(task.grand_total)}. Any variance is recorded
                      against the order.
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={s.label}>Customer mobile (for Cashfree)</Text>
                    <TextInput
                      style={s.input}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="10-digit number"
                      placeholderTextColor={C.faint}
                      keyboardType="phone-pad"
                    />
                    <Text style={s.hint}>
                      Opens the same Cashfree checkout the shopper app uses.
                      The customer can pay by card, UPI or by scanning the UPI QR.
                    </Text>
                    <TouchableOpacity
                      style={s.primaryBtn}
                      onPress={collectOnline}
                      disabled={busy}
                    >
                      <Text style={s.primaryBtnText}>
                        {busy ? 'Waiting for payment…' : `Collect ${money(task.grand_total)} online`}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}
          </View>

          {note ? <Text style={s.note}>{note}</Text> : null}
          {error ? <Text style={s.activationError}>{error}</Text> : null}

          <TouchableOpacity
            style={[s.primaryBtn, cashDue && mode === 'online' && !paid && s.disabledBtn]}
            onPress={confirm}
            disabled={busy || (cashDue && mode === 'online' && !paid)}
          >
            <Text style={s.primaryBtnText}>
              {busy ? 'Closing…' : 'Confirm delivery'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={onClose} disabled={busy}>
            <Text style={s.ghostBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={s.stat}>
      <View style={s.statIcon}>
        <Ionicons name={icon || 'stats-chart-outline'} size={14} color={C.yellow} />
      </View>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function SectionHead({ title, right }: { title: string; right?: string }) {
  return (
    <View style={s.sectionHead}>
      <Text style={s.sectionTitle}>{title}</Text>
      {right ? <Text style={s.sectionRight}>{right}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  splash: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  splashText: { color: C.sub, marginTop: 10, fontSize: 13 },

  header: {
    paddingHorizontal: 18, paddingTop: TOP_INSET + 12, paddingBottom: 16,
    backgroundColor: '#ffffff', borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    borderBottomWidth: 1, borderColor: C.border, marginBottom: 6,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  headerAvatar: {
    width: 44, height: 44, borderRadius: 15, backgroundColor: C.yellow,
    alignItems: 'center', justifyContent: 'center',
  },
  headerAvatarText: { color: '#241503', fontSize: 19, fontWeight: '900' },
  logoSmall: { width: 108, height: 32 },
  hello: { color: C.text, fontSize: 21, fontWeight: '900', marginTop: 2, letterSpacing: -0.3 },
  headerMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.green, marginRight: 6 },
  headerMetaText: { color: C.sub, fontSize: 11 },
  shiftPill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12,
    backgroundColor: 'rgba(34,197,94,0.10)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)',
    borderRadius: 12, paddingHorizontal: 11, paddingVertical: 8,
  },
  shiftPillText: { color: '#15803d', fontSize: 11.5, fontWeight: '700', flex: 1 },
  shiftPillMeta: { color: C.sub, fontSize: 10.5, fontWeight: '700' },
  refreshBtn: {
    width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(109,74,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(109,74,255,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  refreshText: { color: C.yellow, fontSize: 20, fontWeight: '700' },

  bannerError: { marginHorizontal: 16, marginBottom: 8, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 10 },
  bannerErrorText: { color: '#b91c1c', fontSize: 12 },
  bannerOk: { marginHorizontal: 16, marginBottom: 8, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 10, padding: 10 },
  bannerOkText: { color: '#15803d', fontSize: 12 },

  content: { paddingHorizontal: 16, paddingBottom: 28 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stat: {
    flex: 1, backgroundColor: C.card, borderRadius: 16, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  statIcon: {
    width: 26, height: 26, borderRadius: 9, backgroundColor: 'rgba(109,74,255,0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  statValue: { color: C.text, fontSize: 18, fontWeight: '900' },
  statLabel: { color: C.sub, fontSize: 9.5, marginTop: 2, textAlign: 'center' },

  earnCard: {
    backgroundColor: '#ffffff', borderRadius: 20, padding: 18, borderWidth: 1,
    borderColor: '#e4e4e7', marginBottom: 12, overflow: 'hidden',
  },
  earnRow: { flexDirection: 'row', alignItems: 'flex-start' },
  earnBadge: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(109,74,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(109,74,255,0.25)', alignItems: 'center', justifyContent: 'center',
  },
  earnLabel: { color: '#52525b', fontSize: 9.5, fontWeight: '900', letterSpacing: 1.1 },
  earnValue: { color: C.yellow, fontSize: 32, fontWeight: '900', marginTop: 3, letterSpacing: -0.8 },
  earnSub: { color: C.sub, fontSize: 11, marginTop: 4 },
  earnDivider: { height: 1, backgroundColor: '#e4e4e7', marginVertical: 14 },
  earnFoot: { flexDirection: 'row', justifyContent: 'space-between' },
  earnMiniCol: { flex: 1 },
  earnMiniLabel: { color: '#a1a1aa', fontSize: 8.5, fontWeight: '900', letterSpacing: 0.8 },
  earnMini: { color: C.text, fontSize: 13.5, fontWeight: '800', marginTop: 3 },

  cashBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fffbeb',
    borderWidth: 1, borderColor: '#fde68a', borderRadius: 14, padding: 13, marginBottom: 12,
  },
  cashBannerTitle: { color: C.yellow, fontSize: 13, fontWeight: '800' },
  cashBannerText: { color: '#92400e', fontSize: 11, marginTop: 3, lineHeight: 15 },
  cashBannerArrow: { color: C.yellow, fontSize: 26, marginLeft: 8 },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, marginBottom: 8 },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  sectionRight: { color: C.yellow, fontSize: 11, fontWeight: '700' },

  emptyCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 10 },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  emptyText: { color: C.sub, fontSize: 12, lineHeight: 17, marginTop: 5 },

  panel: {
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    padding: 13, marginBottom: 10,
  },
  panelTitle: { color: C.text, fontSize: 13, fontWeight: '800', marginBottom: 8 },

  jobCard: {
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    padding: 14, marginBottom: 10,
  },
  jobTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  jobNoRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  jobNoIcon: {
    width: 24, height: 24, borderRadius: 8, backgroundColor: 'rgba(109,74,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  orderNo: { color: C.text, fontSize: 16, fontWeight: '900' },
  jobMeta: { color: C.sub, fontSize: 11, marginTop: 3, lineHeight: 15 },
  jobPayBox: { alignItems: 'flex-end' },
  jobPay: { color: C.yellow, fontSize: 17, fontWeight: '900' },
  paidSmall: { color: C.faint, fontSize: 8.5, marginTop: 2, fontWeight: '800', letterSpacing: 0.7 },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: 'rgba(124,58,237,0.18)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.45)',
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginTop: 7,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.sky },
  statusChipText: { color: C.sky, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.2 },

  addressBox: { backgroundColor: '#ffffff', borderRadius: 13, padding: 11, marginTop: 11, gap: 5 },
  addressHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addressName: { color: C.text, fontSize: 13, fontWeight: '800' },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  addressLine: { color: C.sub, fontSize: 11, lineHeight: 16, flex: 1 },
  addressPhone: { color: C.yellow, fontSize: 11, fontWeight: '700' },

  payPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 10, marginTop: 10, alignSelf: 'flex-start',
  },
  payPillCash: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a' },
  payPillOk: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  payPillText: { fontSize: 11, fontWeight: '700' },
  payPillTextCash: { color: C.yellow },
  payPillTextOk: { color: '#15803d' },

  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  rowBtn: { flex: 1, marginTop: 0 },
  btnInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: C.yellow, borderRadius: 12, paddingVertical: 14, marginTop: 11,
  },
  primaryBtnDisabled: { backgroundColor: C.border },
  primaryBtnText: { color: '#241503', fontWeight: '900', fontSize: 14 },
  ghostBtn: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border, borderRadius: 11, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  ghostBtnText: { color: C.text, fontSize: 13, fontWeight: '700' },
  disabledBtn: { opacity: 0.45 },
  jobHint: { color: C.faint, fontSize: 10, lineHeight: 14, marginTop: 8 },
  looseLink: {
    color: C.yellow, fontSize: 10, fontWeight: '700', marginTop: 8,
    textDecorationLine: 'underline',
  },

  offerTeaser: { backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#f4f4f7', padding: 12, marginBottom: 10 },
  offerTeaserTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
  offerTeaserText: { color: C.yellow, fontSize: 11, marginTop: 3 },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  rowLabel: { color: C.sub, fontSize: 12, flex: 1 },
  rowValue: { color: C.text, fontSize: 12, fontWeight: '700', maxWidth: '58%', textAlign: 'right' },

  remitCard: { backgroundColor: '#fffbeb', borderRadius: 16, borderWidth: 1, borderColor: '#fde68a', padding: 16, marginBottom: 12 },
  remitLabel: { color: '#92400e', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  remitValue: { color: C.yellow, fontSize: 30, fontWeight: '900', marginTop: 4 },
  remitText: { color: '#92400e', fontSize: 11, lineHeight: 16, marginTop: 6 },

  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  listTitle: { color: C.text, fontSize: 12, fontWeight: '700' },
  listSub: { color: C.faint, fontSize: 10, marginTop: 2 },
  listAmount: { color: C.yellow, fontSize: 13, fontWeight: '800' },

  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 10 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 22, fontWeight: '900' },
  profileName: { color: C.text, fontSize: 17, fontWeight: '900' },
  profileSub: { color: C.sub, fontSize: 11, marginTop: 2 },

  qrCode: { color: C.text, fontSize: 11, fontWeight: '700', marginTop: 10, textAlign: 'center' },
  qrNote: { color: C.sub, fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 8 },

  signOutBtn: { borderRadius: 11, paddingVertical: 12, alignItems: 'center', marginTop: 6, borderWidth: 1, borderColor: '#fecaca' },
  signOutText: { color: '#b91c1c', fontSize: 13, fontWeight: '700' },
  version: { color: C.faint, fontSize: 10, textAlign: 'center', marginTop: 14 },

  nav: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border,
    backgroundColor: '#ffffff', paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 22 : 10,
  },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 1 },
  navIconWrap: { width: 46, height: 30, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navIconWrapOn: { backgroundColor: 'rgba(109,74,255,0.13)' },
  navGlyph: { color: C.faint, fontSize: 17 },
  navGlyphOn: { color: C.yellow },
  navLabel: { color: C.faint, fontSize: 9.5, marginTop: 2, fontWeight: '700' },
  navLabelOn: { color: C.yellow, fontWeight: '900' },
  navBadge: {
    position: 'absolute', top: -4, right: 2, backgroundColor: C.red,
    borderRadius: 8, minWidth: 15, height: 15, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#ffffff',
  },
  navBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },

  activationWrap: { padding: 20, paddingBottom: 40, alignItems: 'stretch' },
  lockCircle: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 18 },
  lockGlyph: { color: C.yellow, fontSize: 34, fontWeight: '900' },
  activationTitle: { color: C.text, fontSize: 23, fontWeight: '900', textAlign: 'center', marginTop: 14 },
  activationText: { color: C.sub, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  activationError: { color: '#b91c1c', fontSize: 12, lineHeight: 17, marginTop: 12 },
  activationNotice: { color: '#15803d', fontSize: 12, lineHeight: 17, marginTop: 12 },
  activationHint: { color: C.faint, fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 14 },
  bigScanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.yellow, borderRadius: 14, paddingVertical: 16, marginTop: 18 },
  bigScanGlyph: { color: '#241503', fontSize: 20, fontWeight: '900' },
  bigScanText: { color: '#241503', fontSize: 15, fontWeight: '900' },

  activationBadge: { width: 56, height: 56, borderRadius: 20, backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 18 },
  activationBadgeText: { color: '#241503', fontSize: 26, fontWeight: '900' },

  label: { color: C.sub, fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 10 },
  input: { backgroundColor: '#ffffff', color: C.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: C.border, fontSize: 14 },
  hint: { color: C.faint, fontSize: 10, lineHeight: 15, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: '#ffffff', borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.purple, borderColor: C.purple },
  chipText: { color: C.sub, fontSize: 12, fontWeight: '700' },
  chipTextOn: { color: '#fff' },

  modalWrap: { padding: 18, paddingTop: TOP_INSET + 12, paddingBottom: 36 },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  modalTitle: { color: C.text, fontSize: 21, fontWeight: '900' },
  modalSub: { color: C.sub, fontSize: 11, marginTop: 3 },
  modalClose: { padding: 8 },
  modalCloseText: { color: C.sub, fontSize: 19 },
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontWeight: '800' },
  paidLine: { color: '#15803d', fontSize: 13, fontWeight: '700', lineHeight: 19 },
  note: { color: C.yellow, fontSize: 11, lineHeight: 16, marginTop: 8 },
  segment: { flexDirection: 'row', backgroundColor: '#ffffff', borderRadius: 10, padding: 3, marginBottom: 2 },
  segmentItem: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segmentOn: { backgroundColor: C.purple },
  segmentText: { color: C.sub, fontSize: 12, fontWeight: '700' },
  segmentTextOn: { color: '#fff' },
});
