import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { C } from '../components/Ui';

export default function OtpScreen() {
  const { verifyOtp, resendOtp, facility, loading } = useAuth();
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await verifyOtp(otp);
    } catch (err: any) {
      setError(err?.body?.error || err?.message || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.badge}><Ionicons name="shield-checkmark-outline" size={24} color={C.yellow} /></View>
      <Text style={styles.title}>One-time code</Text>
      <Text style={styles.subtitle}>
        {facility ? `${facility.name || facility.code} · ${facility.code}` : 'Enter the code sent to you'}
      </Text>
      <TextInput
        style={styles.input}
        placeholder="● ● ● ● ● ●"
        placeholderTextColor={C.faint}
        value={otp}
        onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity style={styles.button} onPress={submit} disabled={busy || loading}>
        {busy || loading ? <ActivityIndicator color="#241503" /> : <Text style={styles.buttonText}>Verify &amp; sign in</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={resendOtp} style={{ marginTop: 16, alignItems: 'center' }}>
        <Text style={{ color: C.yellow, fontWeight: '800', fontSize: 12 }}>Send a new code</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: C.bg },
  badge: { width: 52, height: 52, borderRadius: 17, backgroundColor: 'rgba(109,74,255,0.10)', borderWidth: 1, borderColor: 'rgba(109,74,255,0.3)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 23, fontWeight: '900', color: C.text, marginBottom: 4 },
  subtitle: { fontSize: 12.5, color: C.sub, marginBottom: 16 },
  input: { backgroundColor: C.bg, color: C.yellow, borderRadius: 14, padding: 14, fontSize: 22, letterSpacing: 6, fontWeight: '800', textAlign: 'center', borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  button: { backgroundColor: C.yellow, padding: 15, borderRadius: 13, alignItems: 'center' },
  buttonText: { color: '#241503', fontWeight: '900', fontSize: 14.5 },
  error: { color: C.red, marginBottom: 12, fontSize: 12 },
});
