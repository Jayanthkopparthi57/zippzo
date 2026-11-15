import React, { useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform,
  ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { errMsg } from '../api';
import { C, TOP_INSET } from '../components/Ui';

const zippzoLogo = require('../assets/zippzo-logo.png');

type AuthMode = 'PHONE' | 'EMAIL';

export default function AuthScreen() {
  const {
    login, phoneLogin, selectFacility, verifyOtp, resendOtp,
    loading, needsFacility, needsOtp, facilities,
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('PHONE');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [selectedFacilityCode, setSelectedFacilityCode] = useState<string>('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    try {
      if (mode === 'EMAIL') {
        if (!email.trim() || !password) {
          setError('Enter your email and password.');
          return;
        }
        await login(email.trim(), password);
      } else {
        const p = phone.replace(/\D/g, '');
        if (p.length < 10) {
          setError('Enter a valid 10-digit mobile number.');
          return;
        }
        if (!storeCode.trim()) {
          setError('Enter the 6-digit store code shown on the Authentication screen.');
          return;
        }
        await phoneLogin(phone.trim(), storeCode.trim(), siteCode.trim() || undefined);
      }
    } catch (err: any) {
      setError(errMsg(err, 'Sign in failed.'));
    }
  };

  const handleSelectFacility = async () => {
    if (!selectedFacilityCode) {
      setError('Please select a facility.');
      return;
    }
    try {
      await selectFacility(selectedFacilityCode);
    } catch (err: any) {
      setError(errMsg(err, 'Could not select facility.'));
    }
  };

  const handleVerifyOtp = async () => {
    const cleanOtp = otp.replace(/\D/g, '');
    if (cleanOtp.length < 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    try {
      await verifyOtp(cleanOtp);
    } catch (err: any) {
      setError(errMsg(err, 'Invalid code.'));
    }
  };

  const isBusy = loading;

  return (
    <View style={s.safe}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          {/* Brand */}
          <View style={s.brand}>
            <Image source={zippzoLogo} style={s.logoImg} resizeMode="contain" accessibilityLabel="Zippzo" />
            <Text style={s.logoTag}>ASSOCIATES APP</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardKicker}>
              {needsFacility ? 'SELECT FACILITY' : needsOtp ? 'VERIFICATION' : 'SIGN IN'}
            </Text>
            <Text style={s.cardTitle}>
              {needsFacility ? 'Which store?' : needsOtp ? 'Enter the code' : 'Welcome back'}
            </Text>
            <Text style={s.cardSub}>
              {needsFacility ? 'You are assigned to multiple sites. Choose where you work today.'
               : needsOtp ? 'A 6-digit code was sent to your registered phone.'
               : mode === 'PHONE' ? 'Sign in with your registered phone number and the store code.'
               : 'Managers and administrators sign in with email and password.'}
            </Text>

            {/* ============ LOGIN STEP ============ */}
            {!needsFacility && !needsOtp && (
              <>
                {/* Mode toggle */}
                <View style={s.tabs}>
                  <TouchableOpacity
                    onPress={() => { setMode('PHONE'); setError(null); }}
                    style={[s.tab, mode === 'PHONE' && s.tabActive]}
                  >
                    <Ionicons name="call" size={13} color={mode === 'PHONE' ? '#f4f4f7' : '#a1a1aa'} />
                    <Text style={[s.tabText, mode === 'PHONE' && s.tabTextActive]}>Phone</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setMode('EMAIL'); setError(null); }}
                    style={[s.tab, mode === 'EMAIL' && s.tabActive]}
                  >
                    <Ionicons name="mail" size={13} color={mode === 'EMAIL' ? '#f4f4f7' : '#a1a1aa'} />
                    <Text style={[s.tabText, mode === 'EMAIL' && s.tabTextActive]}>Email</Text>
                  </TouchableOpacity>
                </View>

                {mode === 'PHONE' ? (
                  <>
                    <Text style={s.label}>Mobile number</Text>
                    <TextInput
                      style={s.input}
                      placeholder="98765 43210"
                      placeholderTextColor="#a1a1aa"
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                    />
                    <Text style={s.label}>Store code</Text>
                    <TextInput
                      style={s.input}
                      placeholder="6-digit code"
                      placeholderTextColor="#a1a1aa"
                      value={storeCode}
                      onChangeText={setStoreCode}
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                    <Text style={s.label}>Store site code (optional)</Text>
                    <TextInput
                      style={s.input}
                      placeholder="e.g. DS-VERIFY-1"
                      placeholderTextColor="#a1a1aa"
                      value={siteCode}
                      onChangeText={setSiteCode}
                      autoCapitalize="characters"
                    />
                    <Text style={s.hint}>
                      The daily 6-digit code is on the Store’s Authentication screen — it is one code for the whole day.
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={s.label}>Email</Text>
                    <TextInput
                      style={s.input}
                      placeholder="manager@zippzo.in"
                      placeholderTextColor="#a1a1aa"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                    />
                    <Text style={s.label}>Password</Text>
                    <TextInput
                      style={s.input}
                      placeholder="Password"
                      placeholderTextColor="#a1a1aa"
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoComplete="current-password"
                    />
                    <Text style={s.hint}>Managers and administrators sign in with email and password.</Text>
                  </>
                )}

                {error && <Text style={s.error}>{error}</Text>}

                <TouchableOpacity
                  style={[s.button, isBusy && s.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={isBusy}
                  activeOpacity={0.85}
                >
                  {isBusy ? (
                    <ActivityIndicator color="#f4f4f7" size={16} />
                  ) : (
                    <>
                      <Text style={s.buttonText}>{mode === 'PHONE' ? 'Enter store' : 'Continue'}</Text>
                      <Ionicons name="arrow-forward" size={15} color="#f4f4f7" />
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* ============ FACILITY STEP ============ */}
            {needsFacility && (
              <>
                {facilities.map((f: any) => (
                  <TouchableOpacity
                    key={f.code}
                    style={[s.facilityCard, selectedFacilityCode === f.code && s.facilityCardActive]}
                    onPress={() => setSelectedFacilityCode(f.code)}
                    activeOpacity={0.8}
                  >
                    <View style={s.facilityRadio}>
                      {selectedFacilityCode === f.code ? (
                        <View style={s.facilityRadioOn} />
                      ) : null}
                    </View>
                    <View style={s.facilityInfo}>
                      <Text style={s.facilityName}>{f.name || f.code}</Text>
                      <Text style={s.facilityCode}>
                        {f.site_type === 'MH' ? 'Warehouse' : 'Dark Store'} · {f.code}
                      </Text>
                    </View>
                    <Ionicons name="storefront-outline" size={17} color={selectedFacilityCode === f.code ? '#6d4aff' : '#a1a1aa'} />
                  </TouchableOpacity>
                ))}
                {error && <Text style={s.error}>{error}</Text>}
                <TouchableOpacity
                  style={[s.button, (isBusy || !selectedFacilityCode) && s.buttonDisabled]}
                  onPress={handleSelectFacility}
                  disabled={isBusy || !selectedFacilityCode}
                  activeOpacity={0.85}
                >
                  {isBusy ? (
                    <ActivityIndicator color="#f4f4f7" size={16} />
                  ) : (
                    <Text style={s.buttonText}>Continue</Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* ============ OTP STEP ============ */}
            {needsOtp && (
              <>
                <TextInput
                  style={s.otpInput}
                  placeholderTextColor="#e4e4e7"
                  placeholder="······"
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                {error && <Text style={s.error}>{error}</Text>}
                <View style={s.otpActions}>
                  <TouchableOpacity
                    style={[s.button, isBusy && s.buttonDisabled, { flex: 1 }]}
                    onPress={handleVerifyOtp}
                    disabled={isBusy || otp.replace(/\D/g, '').length < 6}
                    activeOpacity={0.85}
                  >
                    {isBusy ? (
                      <ActivityIndicator color="#f4f4f7" size={16} />
                    ) : (
                      <Text style={s.buttonText}>Verify &amp; enter</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={resendOtp}
                    disabled={isBusy}
                    style={s.resendButton}
                  >
                    <Text style={s.resendText}>Resend</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          <Text style={s.footNote}>ZIPPZO Dark Store WMS · Associates</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f4f7' },
  wrap: { flexGrow: 1, paddingHorizontal: 22, paddingTop: TOP_INSET + 26, paddingBottom: 30, justifyContent: 'center' },

  brand: { alignItems: 'center', marginBottom: 24 },
  logoImg: { width: 180, height: 180 },
  logoTag: { color: '#6d4aff', fontSize: 10, fontWeight: '900', letterSpacing: 2.4, marginTop: 8 },

  card: {
    backgroundColor: '#f4f4f5', borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: 'rgba(109,74,255,0.16)',
  },
  cardKicker: { color: '#6d4aff', fontSize: 9, fontWeight: '900', letterSpacing: 1.6, marginBottom: 6 },
  cardTitle: { color: '#18181b', fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
  cardSub: { color: '#52525b', fontSize: 11.5, lineHeight: 16.5, marginTop: 6, marginBottom: 14 },

  tabs: {
    flexDirection: 'row', backgroundColor: '#f4f4f5',
    borderRadius: 10, padding: 4, marginBottom: 6, borderWidth: 1, borderColor: '#ececef',
  },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  tabActive: { backgroundColor: '#6d4aff' },
  tabText: { color: '#a1a1aa', fontSize: 12, fontWeight: '800' },
  tabTextActive: { color: '#ffffff' },

  label: { color: '#52525b', fontSize: 10.5, fontWeight: '800', marginBottom: 6, marginTop: 11, letterSpacing: 0.4 },
  input: {
    backgroundColor: '#f4f4f5', color: '#18181b', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)', fontSize: 14.5,
  },
  button: {
    flexDirection: 'row', gap: 7, backgroundColor: '#6d4aff', borderRadius: 10, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: 16,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: '#ffffff', fontWeight: '900', fontSize: 14.5 },
  error: { color: '#b91c1c', fontSize: 12, marginTop: 12, lineHeight: 17 },
  hint: { color: '#a1a1aa', fontSize: 10.5, lineHeight: 15, marginTop: 8 },

  facilityCard: {
    backgroundColor: '#f4f4f5', borderRadius: 12, padding: 13,
    marginBottom: 8, borderWidth: 1, borderColor: '#ececef',
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  facilityCardActive: { borderColor: '#6d4aff', backgroundColor: 'rgba(109,74,255,0.08)' },
  facilityRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2,
    borderColor: '#a1a1aa', alignItems: 'center', justifyContent: 'center' },
  facilityRadioOn: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#6d4aff' },
  facilityInfo: { flex: 1 },
  facilityName: { color: '#18181b', fontWeight: '800', fontSize: 13.5 },
  facilityCode: { color: '#a1a1aa', fontSize: 11, marginTop: 2 },

  otpInput: {
    backgroundColor: '#f4f4f5', color: '#6d4aff', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 15, borderWidth: 1,
    borderColor: 'rgba(109,74,255,0.3)', fontSize: 26, letterSpacing: 10,
    textAlign: 'center', fontWeight: '900', marginBottom: 4,
  },
  otpActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  resendButton: { paddingVertical: 10, paddingHorizontal: 16 },
  resendText: { color: '#6d4aff', fontSize: 12, fontWeight: '800' },

  footNote: { color: '#a1a1aa', fontSize: 9, textAlign: 'center', marginTop: 18, letterSpacing: 0.5 },
});
