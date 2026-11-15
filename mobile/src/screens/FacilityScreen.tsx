import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform, StatusBar, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth';
import { C } from '../components/Ui';

const zippzoLogo = require('../assets/zippzo-logo.png');

const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

export default function FacilityScreen() {
  const { facilities, selectFacility, loading } = useAuth();
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: TOP_INSET + 24, paddingBottom: 32 }}>
        <Image source={zippzoLogo} style={styles.logoImg} resizeMode="contain" accessibilityLabel="Zippzo" />
        <Text style={styles.title}>Choose your facility</Text>
        <Text style={styles.subtitle}>
          You are assigned to more than one site. Pick where you are working today.
        </Text>

        {facilities.map((f) => (
          <TouchableOpacity
            key={f.code}
            style={styles.card}
            onPress={() => selectFacility(f.code)}
            disabled={loading}
            activeOpacity={0.85}
          >
            <View style={styles.icon}>
              <Ionicons
                name={f.site_type === 'MH' ? 'business-outline' : 'storefront-outline'}
                size={19}
                color={C.yellow}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{f.name || f.code}</Text>
              <Text style={styles.cardSub}>
                {f.site_type === 'MH' ? 'Warehouse' : 'Dark store'} · {f.code}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={C.faint} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  logoImg: { width: 155, height: 155, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 24, fontWeight: '900', color: C.text, marginTop: 6, letterSpacing: -0.4 },
  subtitle: { fontSize: 12.5, color: C.sub, marginTop: 6, marginBottom: 20, lineHeight: 18 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.card, padding: 14, borderRadius: 16, marginBottom: 10,
    borderWidth: 1, borderColor: C.border,
  },
  icon: {
    width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(109,74,255,0.10)',
    borderWidth: 1, borderColor: 'rgba(109,74,255,0.3)', alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { color: C.text, fontWeight: '800', fontSize: 14.5 },
  cardSub: { color: C.sub, fontSize: 11.5, marginTop: 3 },
});
