import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Header, C } from '../components/Ui';

export type InboundTarget = 'consignment' | 'qc' | 'putaway';

export default function InboundScreen({
  counts,
  onNavigate,
  onBack,
}: {
  counts: { qc: number; putaway: number; grn: number };
  onNavigate: (t: InboundTarget) => void;
  onBack: () => void;
}) {
  const Step = ({
    n, title, desc, badge, onPress,
  }: {
    n: number; title: string; desc: string; badge?: number; onPress: () => void;
  }) => (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.num}><Text style={s.numText}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <View style={s.rowBetween}>
          <Text style={s.title}>{title}</Text>
          {badge ? <Text style={s.badge}>{badge}</Text> : null}
        </View>
        <Text style={s.desc}>{desc}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Header title="Inbound" subtitle="Consignment · QC · Putaway" onBack={onBack} />
      <Step n={1} title="Create Consignment"
        desc="Scan the vendor or transfer barcode, then scan each product."
        badge={counts.grn || undefined} onPress={() => onNavigate('consignment')} />
      <Step n={2} title="Quality Check"
        desc="Scan each product → Pass or Fail → Next."
        badge={counts.qc || undefined} onPress={() => onNavigate('qc')} />
      <Step n={3} title="Putaway"
        desc="Scan product and destination bin to put stock away."
        badge={counts.putaway || undefined} onPress={() => onNavigate('putaway')} />
      <Text style={s.tip}>Stock is not sellable until putaway confirms it.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  card: {
    flexDirection: 'row', backgroundColor: C.card, borderRadius: 10,
    padding: 14, borderWidth: 1, borderColor: C.border,
    marginBottom: 10, gap: 12, alignItems: 'center',
  },
  num: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(109,74,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(109,74,255,0.34)',
    justifyContent: 'center', alignItems: 'center',
  },
  numText: { color: C.yellow, fontWeight: '900', fontSize: 14 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 15, fontWeight: '800', color: C.text },
  desc: { color: C.sub, fontSize: 12, lineHeight: 17, marginTop: 4 },
  badge: { color: C.yellow, fontWeight: '900', fontSize: 13 },
  tip: { color: C.faint, fontSize: 12, marginTop: 8 },
});
