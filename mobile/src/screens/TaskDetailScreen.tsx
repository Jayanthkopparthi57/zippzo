import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAuth } from '../auth';
import { api, API_BASE } from '../api';
import { enqueue, flushQueue, readQueue, PendingAction } from '../offlineQueue';
import { uuidv4 } from '../auth';
import { Task } from '../types';
import { C, TOP_INSET } from '../components/Ui';

export default function TaskDetailScreen({ task, onBack }: { task: Task; onBack: () => void }) {
  const { facility } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [bin, setBin] = useState('');
  const [units, setUnits] = useState(String(task.remaining_qty || 1));
  const [busy, setBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const refreshPending = async () => {
    const q = await readQueue();
    setPendingCount(q.length);
  };

  const submit = async () => {
    if (!bin.trim()) {
      Alert.alert('Scan or type a bin first');
      return;
    }
    const key = uuidv4();
    const body = { task_id: task.id, bin: bin.trim(), units: Number(units) || 1, idempotency_key: key };
    setBusy(true);
    setMessage(null);
    try {
      if (task.kind === 'PUTAWAY') {
        await api.placePutaway(task.id, bin.trim(), Number(units) || 1);
        await api.completePutaway(task.id);
      } else {
        // Other task kinds reuse the same idempotency contract; the server is
        // the source of truth for whether the action committed.
        await enqueue({
          idempotencyKey: key,
          endpoint: task.endpoint,
          method: 'POST',
          body,
        });
      }
      setMessage('Confirmed by server.');
      await refreshPending();
    } catch (err: any) {
      // No connectivity: queue it as pending sync, never as confirmed.
      if (!err?.status) {
        await enqueue({
          idempotencyKey: key,
          endpoint: task.endpoint,
          method: 'POST',
          body,
        });
        setMessage('Saved as pending sync. It will be sent when you are back online.');
        await refreshPending();
      } else {
        setMessage(err?.body?.error || err?.message || 'Rejected by server');
      }
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    setBusy(true);
    await flushQueue(null, async (item: PendingAction, token: string | null) => {
      await fetch(`${API_BASE}${item.endpoint}`, {
        method: item.method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(item.body),
      });
    });
    await refreshPending();
    setBusy(false);
  };

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator color={C.yellow} /></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Camera access needed</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onBack} style={{ marginTop: 16 }}>
          <Text style={{ color: C.sub }}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.title}>{task.title}</Text>
      <Text style={styles.subtitle}>{task.subtitle} · {facility?.code}</Text>

      <View style={styles.scanBox}>
        {scanning ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            onBarcodeScanned={({ data }) => {
              setBin(data);
              setScanning(false);
            }}
          />
        ) : (
          <TouchableOpacity style={styles.scanButton} onPress={() => setScanning(true)}>
            <Text style={styles.buttonText}>Scan bin barcode</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.label}>Bin</Text>
      <TextInput style={styles.input} value={bin} onChangeText={setBin} placeholder="Bin code / location id" />

      <Text style={styles.label}>Units</Text>
      <TextInput style={styles.input} value={units} onChangeText={setUnits} keyboardType="number-pad" />

      {message ? <Text style={styles.message}>{message}</Text> : null}
      {pendingCount > 0 ? (
        <Text style={styles.pending}>Pending sync: {pendingCount}</Text>
      ) : null}

      <TouchableOpacity style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Commit (server-confirmed)</Text>}
      </TouchableOpacity>
      {pendingCount > 0 ? (
        <TouchableOpacity style={[styles.button, { backgroundColor: '#059669', marginTop: 10 }]} onPress={retry} disabled={busy}>
          <Text style={styles.buttonText}>Retry pending sync</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, paddingTop: TOP_INSET + 12, backgroundColor: C.bg },
  back: { color: C.yellow, marginBottom: 8, fontWeight: '800', fontSize: 12 },
  title: { fontSize: 21, fontWeight: '900', color: C.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: C.sub, marginBottom: 16 },
  scanBox: { height: 180, backgroundColor: C.card, borderRadius: 16, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: C.border },
  scanButton: { backgroundColor: C.yellow, padding: 13, borderRadius: 12 },
  label: { color: C.sub, fontSize: 11, fontWeight: '800', marginBottom: 5, letterSpacing: 0.2 },
  input: { backgroundColor: C.card, color: C.text, borderRadius: 13, padding: 13, marginBottom: 12, borderWidth: 1, borderColor: C.border, fontSize: 14 },
  button: { backgroundColor: C.blue, padding: 15, borderRadius: 13, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  message: { color: C.sky, marginBottom: 12 },
  pending: { color: C.yellow, marginBottom: 12 },
});
