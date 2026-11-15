import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useAuth } from '../auth';
import { C } from '../components/Ui';

type Mode = 'PHONE' | 'MANAGER';

export default function LoginScreen() {
  const { login, phoneLogin, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('PHONE');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (mode === 'PHONE') {
        if (phone.replace(/\D/g, '').length < 10) {
          setError('Enter the 10-digit mobile number registered for you.');
          return;
        }
        if (!storeCode.trim()) {
          setError('Enter the store code shown on the Authentication screen.');
          return;
        }
        await phoneLogin(phone.trim(), storeCode.trim(), siteCode.trim() || undefined);
      } else {
        await login(email.trim(), password);
      }
    } catch (err: any) {
      setError(
        err?.body?.error
        || err?.body?.detail
        || err?.message
        || 'Sign in failed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <View style={s.logo}>
          <Text style={s.logoMark}>Z</Text>
        </View>
        <Text style={s.title}>Zippzo Operations</Text>
        <Text style={s.subtitle}>
          {mode === 'PHONE'
            ? 'Store associate sign-in'
            : 'Manager / administrator sign-in'}
        </Text>

        <View style={s.tabs}>
          <TouchableOpacity
            style={[s.tab, mode === 'PHONE' && s.tabActive]}
            onPress={() => { setMode('PHONE'); setError(null); }}
          >
            <Text style={[s.tabText, mode === 'PHONE' && s.tabTextActive]}>Associate</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, mode === 'MANAGER' && s.tabActive]}
            onPress={() => { setMode('MANAGER'); setError(null); }}
          >
            <Text style={[s.tabText, mode === 'MANAGER' && s.tabTextActive]}>Manager</Text>
          </TouchableOpacity>
        </View>

        {mode === 'PHONE' ? (
          <>
            <Text style={s.label}>Mobile number</Text>
            <TextInput
              style={s.input}
              placeholder="98765 43210"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={15}
              placeholderTextColor={C.faint}
            />
            <Text style={s.label}>Store code</Text>
            <TextInput
              style={[s.input, s.codeInput]}
              placeholder="6-digit code"
              value={storeCode}
              onChangeText={setStoreCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholderTextColor={C.faint}
            />
            <Text style={s.hint}>
              The daily store code is on the Dark Store → Authentication screen.
              It stays the same for the whole day.
            </Text>
            <Text style={s.label}>Store code (only if you work at more than one)</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. DS-BLR-01 (optional)"
              value={siteCode}
              onChangeText={setSiteCode}
              autoCapitalize="characters"
              placeholderTextColor={C.faint}
            />
          </>
        ) : (
          <>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              placeholder="manager@zippzo.in"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor={C.faint}
            />
            <Text style={s.label}>Password</Text>
            <TextInput
              style={s.input}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholderTextColor={C.faint}
            />
            <Text style={s.hint}>
              Managers receive a one-time code after the password step.
            </Text>
          </>
        )}

        {error ? <Text style={s.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[s.button, (busy || loading) && { opacity: 0.6 }]}
          onPress={submit}
          disabled={busy || loading}
        >
          {busy || loading
            ? <ActivityIndicator color="#241503" />
            : <Text style={s.buttonText}>
              {mode === 'PHONE' ? 'Enter store' : 'Continue → OTP'}
            </Text>}
        </TouchableOpacity>

        <Text style={s.footnote}>
          Associates: ask your manager for the current store code. Riders sign in
          with the manager-issued QR.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  wrap: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  logo: {
    width: 62, height: 62, borderRadius: 18, backgroundColor: C.purple,
    alignSelf: 'center', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16, borderWidth: 2, borderColor: C.yellow,
  },
  logoMark: { color: C.yellow, fontSize: 34, fontWeight: '900' },
  title: { fontSize: 28, fontWeight: '900', color: C.text, textAlign: 'center' },
  subtitle: { fontSize: 14, color: C.sub, textAlign: 'center', marginTop: 4, marginBottom: 22 },
  tabs: {
    flexDirection: 'row', backgroundColor: C.card, borderRadius: 12,
    padding: 4, marginBottom: 20, borderWidth: 1, borderColor: C.border,
  },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  tabActive: { backgroundColor: C.purple },
  tabText: { color: C.sub, fontWeight: '700', fontSize: 13 },
  tabTextActive: { color: '#fff' },
  label: { color: C.sub, fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: C.card, color: C.text, borderRadius: 12, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: C.border, fontSize: 16,
  },
  codeInput: {
    fontSize: 24, letterSpacing: 8, textAlign: 'center',
    fontWeight: '800', borderColor: C.yellow,
  },
  button: {
    backgroundColor: C.yellow, padding: 15, borderRadius: 12,
    alignItems: 'center', marginTop: 10,
  },
  buttonText: { color: '#241503', fontWeight: '900', fontSize: 16 },
  error: { color: '#b91c1c', marginTop: 4, marginBottom: 6, fontSize: 13 },
  hint: { color: C.faint, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  footnote: {
    color: C.faint, fontSize: 12, textAlign: 'center',
    marginTop: 22, lineHeight: 18,
  },
});
