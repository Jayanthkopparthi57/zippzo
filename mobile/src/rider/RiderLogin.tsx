import React, { useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { errMsg } from '../api';
import { C } from '../components/Ui';

const zippzoLogo = require('../assets/zippzo-logo.png');

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

/**
 * Dedicated sign-in for the delivery-partner app.
 *
 * Field riders sign in with the phone number the store registered plus the
 * daily six-digit store code shown on the dark store's Authentication
 * screen. Email and password stay available for office-provisioned accounts,
 * but the phone path is primary because that is what a rider actually has.
 */
export default function RiderLogin() {
  const { login, phoneLogin, loading } = useAuth();
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    try {
      if (mode === 'phone') {
        const p = phone.replace(/\D/g, '');
        if (p.length < 10) {
          setError('Enter the 10-digit mobile number your store registered.');
          return;
        }
        if (storeCode.trim().length < 4) {
          setError('Enter the store activation code shown on the DS console.');
          return;
        }
        await phoneLogin(phone.trim(), storeCode.trim(), siteCode.trim() || undefined);
      } else {
        if (!email.trim() || !password) {
          setError('Enter your email and password.');
          return;
        }
        await login(email.trim(), password);
      }
    } catch (e) {
      setError(errMsg(e, 'Could not sign in.'));
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          <View style={s.glowA} />
          <Image source={zippzoLogo} style={s.logoImg} resizeMode="contain" accessibilityLabel="Zippzo Rider" />
          <Text style={s.kicker}>DELIVERY PARTNER</Text>
          <Text style={s.tag}>Deliveries, earnings and COD in one place.</Text>

          <View style={s.card}>
            <View style={s.tabs}>
              <TouchableOpacity
                onPress={() => { setMode('phone'); setError(''); }}
                style={[s.tab, mode === 'phone' && s.tabOn]}
              >
                <Text style={[s.tabText, mode === 'phone' && s.tabTextOn]}>Phone + store code</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setMode('email'); setError(''); }}
                style={[s.tab, mode === 'email' && s.tabOn]}
              >
                <Text style={[s.tabText, mode === 'email' && s.tabTextOn]}>Email</Text>
              </TouchableOpacity>
            </View>

            {mode === 'phone' ? (
              <>
                <Text style={s.label}>Mobile number</Text>
                <TextInput
                  style={s.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="98765 43210"
                  placeholderTextColor={C.faint}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                />

                <Text style={s.label}>Store activation code</Text>
                <TextInput
                  style={s.input}
                  value={storeCode}
                  onChangeText={(v) => setStoreCode(v.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  placeholderTextColor={C.faint}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                <Text style={s.hint}>
                  The code is on the DS console under Authentication and changes
                  every minute. Ask your store manager if it has expired.
                </Text>

                <Text style={s.label}>Store code (only if you work at more than one)</Text>
                <TextInput
                  style={s.input}
                  value={siteCode}
                  onChangeText={(v) => setSiteCode(v.toUpperCase())}
                  placeholder="e.g. DS-BLR-01"
                  placeholderTextColor={C.faint}
                  autoCapitalize="characters"
                />
              </>
            ) : (
              <>
                <Text style={s.label}>Email</Text>
                <TextInput
                  style={s.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="rider@zippzo.in"
                  placeholderTextColor={C.faint}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />
                <Text style={s.label}>Password</Text>
                <TextInput
                  style={s.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  placeholderTextColor={C.faint}
                  secureTextEntry
                />
                <Text style={s.hint}>
                  Office accounts may be asked for a one-time code after the password.
                </Text>
              </>
            )}

            {error ? <Text style={s.error}>{error}</Text> : null}

            <TouchableOpacity style={s.button} onPress={submit} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#241503" />
                : (
                  <>
                    <Text style={s.buttonText}>Sign in</Text>
                    <Ionicons name="arrow-forward" size={16} color="#241503" />
                  </>
                )}
            </TouchableOpacity>
          </View>

          <Text style={s.footer}>
            After signing in you must scan the dark store's activation QR. Until
            then this rider is inactive and jobs are not offered.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  wrap: { flexGrow: 1, padding: 22, paddingTop: TOP_INSET + 34, paddingBottom: 40, alignItems: 'center', overflow: 'hidden' },
  glowA: { position: 'absolute', top: -90, right: -70, width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(124,92,255,0.16)' },
  logoImg: { width: 150, height: 150 },
  logoText: { fontSize: 34, fontWeight: '900', color: C.purpleDeep },
  kicker: { color: C.yellow, fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginTop: 12 },
  tag: { color: C.sub, fontSize: 12.5, marginTop: 5, textAlign: 'center' },
  card: {
    width: '100%', backgroundColor: C.card, borderRadius: 22, borderWidth: 1,
    borderColor: C.border, padding: 17, marginTop: 22,
  },
  tabs: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 3, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  tabOn: { backgroundColor: C.yellow },
  tabText: { color: C.sub, fontSize: 11.5, fontWeight: '800' },
  tabTextOn: { color: '#241503' },
  label: { color: C.sub, fontSize: 11, fontWeight: '800', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: C.bg, color: '#fff', borderRadius: 12, paddingHorizontal: 13,
    paddingVertical: 12, borderWidth: 1, borderColor: C.border, fontSize: 14,
  },
  hint: { color: C.faint, fontSize: 11, lineHeight: 16, marginTop: 7 },
  error: { color: '#b91c1c', fontSize: 12, marginTop: 12, lineHeight: 17 },
  button: {
    flexDirection: 'row', gap: 7, backgroundColor: C.yellow, borderRadius: 13, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: 18,
  },
  buttonText: { color: '#241503', fontWeight: '900', fontSize: 14.5 },
  footer: { color: C.faint, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 18 },
});
