import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, ActivityIndicator, RefreshControl, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/** Android status-bar height; these screens draw edge-to-edge. */
export const TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;

/**
 * Staff console design tokens — Zippzo Dark Store WMS.
 *
 * Zinc-light palette: zinc-100 canvas, white cards, near-black text,
 * a single restrained violet accent. Semantic green / amber / red carry
 * status only.
 */
export const C = {
  bg: '#f4f4f7',
  card: '#ffffff',
  cardAlt: '#f4f4f5',
  border: '#e4e4e7',
  line: '#ececef',
  text: '#18181b',
  sub: '#52525b',
  faint: '#a1a1aa',
  blue: '#6d4aff',
  sky: '#8b5cf6',
  purple: '#6d4aff',
  purpleDeep: '#5b39f0',
  yellow: '#6d4aff',
  gold: '#6d4aff',
  goldDeep: '#5b39f0',
  green: '#16a34a',
  red: '#dc2626',
  amber: '#d97706',
  picker: '#7c3aed',
  inbound: '#ea580c',
  putaway: '#16a34a',
  inventory: '#2563eb',
  manager: '#18181b',
};

export function Header({ title, subtitle, right, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void }) {
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={s.backRow} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={16} color={C.yellow} />
            <Text style={s.back}>Back</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.sub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Chip({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'red' | 'amber' | 'muted' }) {
  const map = {
    blue: { bg: '#ede9fe', fg: '#5b39f0', bd: '#d6c9ff' },
    green: { bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' },
    red: { bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' },
    amber: { bg: '#fffbeb', fg: '#b45309', bd: '#fde68a' },
    muted: { bg: '#f4f4f5', fg: '#52525b', bd: '#e4e4e7' },
  } as const;
  const t = map[tone];
  return (
    <View style={[s.chip, { backgroundColor: t.bg, borderColor: t.bd }]}>
      <Text style={[s.chipText, { color: t.fg }]}>{children}</Text>
    </View>
  );
}

export function Stat({ label, value, hint, icon }: { label: string; value: string | number; hint?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={s.stat}>
      {icon ? (
        <View style={s.statIcon}>
          <Ionicons name={icon} size={13} color={C.yellow} />
        </View>
      ) : null}
      <Text style={s.statVal} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.statLab}>{label}</Text>
      {hint ? <Text style={s.statHint}>{hint}</Text> : null}
    </View>
  );
}

export function PrimaryBtn({ children, onPress, disabled, color }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; color?: string }) {
  return (
    <TouchableOpacity
      style={[s.btn, color ? { backgroundColor: color } : null, disabled ? { opacity: 0.5 } : null]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      <Text style={s.btnText}>{children}</Text>
    </TouchableOpacity>
  );
}

export function GhostBtn({ children, onPress, disabled }: { children: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={[s.ghostBtn, disabled ? { opacity: 0.5 } : null]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={s.ghostText}>{children}</Text>
    </TouchableOpacity>
  );
}

export function Stepper({ value, onChange, min = 0, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const clamp = (v: number) => {
    let n = v;
    if (n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  };
  return (
    <View style={s.stepRow}>
      <TouchableOpacity style={s.stepBtn} onPress={() => onChange(clamp(value - 1))} accessibilityLabel="Decrease">
        <Ionicons name="remove" size={18} color={C.text} />
      </TouchableOpacity>
      <Text style={s.stepVal}>{value}</Text>
      <TouchableOpacity style={s.stepBtn} onPress={() => onChange(clamp(value + 1))} accessibilityLabel="Increase">
        <Ionicons name="add" size={18} color={C.text} />
      </TouchableOpacity>
    </View>
  );
}

export function SearchRow({
  value, onChange, onScan, placeholder, onSubmit, busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onScan: () => void;
  placeholder?: string;
  onSubmit?: () => void;
  busy?: boolean;
}) {
  return (
    <View style={s.searchRow}>
      <View style={s.searchField}>
        <Ionicons name="search-outline" size={16} color={C.faint} />
        <TextInput
          style={s.searchInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder || 'Search…'}
          placeholderTextColor={C.faint}
          returnKeyType="search"
          onSubmitEditing={onSubmit}
        />
      </View>
      <TouchableOpacity style={s.scanMini} onPress={onScan} accessibilityLabel="Scan barcode">
        <Ionicons name="scan-outline" size={17} color="#ffffff" />
        <Text style={s.scanMiniText}>Scan</Text>
      </TouchableOpacity>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={s.loadWrap}>
      <ActivityIndicator color={C.yellow} size="large" />
      {label ? <Text style={s.loadText}>{label}</Text> : null}
    </View>
  );
}

export function Empty({ msg }: { msg: string }) {
  return (
    <View style={s.emptyWrap}>
      <View style={s.emptyIcon}>
        <Ionicons name="file-tray-outline" size={24} color={C.faint} />
      </View>
      <Text style={s.empty}>{msg}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingTop: TOP_INSET + 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 4 },
  back: { color: C.yellow, fontWeight: '800', fontSize: 12 },
  title: { fontSize: 23, fontWeight: '900', color: C.text, letterSpacing: -0.4 },
  sub: { fontSize: 12, color: C.sub, marginTop: 3 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start', marginTop: 7, borderWidth: 1 },
  chipText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.1 },
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 15, padding: 11, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  statIcon: { width: 24, height: 24, borderRadius: 8, backgroundColor: 'rgba(109,74,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  statVal: { fontSize: 19, fontWeight: '900', color: C.text },
  statLab: { fontSize: 9.5, color: C.sub, marginTop: 2, textAlign: 'center' },
  statHint: { fontSize: 9, color: C.faint, marginTop: 2 },
  btn: { backgroundColor: C.yellow, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 10, flexDirection: 'row', gap: 7 },
  btnText: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  ghostBtn: { backgroundColor: C.cardAlt, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, marginTop: 8, flexDirection: 'row', gap: 6 },
  ghostText: { color: C.text, fontWeight: '700', fontSize: 13 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 42, height: 42, borderRadius: 10, backgroundColor: C.cardAlt, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  stepSym: { color: C.text, fontSize: 20, fontWeight: '800' },
  stepVal: { fontSize: 20, fontWeight: '900', color: C.text, minWidth: 40, textAlign: 'center' },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  searchField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.card, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, color: C.text, paddingVertical: 11, fontSize: 13 },
  scanMini: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.yellow, paddingHorizontal: 13, justifyContent: 'center', borderRadius: 10 },
  scanMiniText: { color: '#ffffff', fontWeight: '800', fontSize: 12 },
  loadWrap: { justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  loadText: { color: C.sub, marginTop: 10, fontSize: 12 },
  emptyWrap: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 20 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  empty: { color: C.sub, textAlign: 'center', lineHeight: 19, fontSize: 12.5 },
});
