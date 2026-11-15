import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, TextInput } from 'react-native';
import { useAuth } from '../auth';
import { api, errMsg } from '../api';
import { Header, C, Chip, PrimaryBtn, GhostBtn, SearchRow, Empty } from '../components/Ui';
import { Scanner } from '../components/Scanner';

interface LpnRow {
  id: string;
  barcode: string;
  lpn_type?: string;
  status: string;
  mother_hub?: string;
  item_count?: number;
  total_units?: number;
  created_at?: string;
}

interface Placement {
  sku: string;
  sku_code?: string;
  lot?: string;
  qty: number;
  bin: string;
}

export default function DsInboundScreen({ onBack }: { onBack: () => void }) {
  const { facility } = useAuth();
  const storeCode = facility?.code || '';
  const [lpns, setLpns] = useState<LpnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanTarget, setScanTarget] = useState<null | 'receive' | 'shelfBin'>(null);
  const [selected, setSelected] = useState<LpnRow | null>(null);
  const [lpnContents, setLpnContents] = useState<any[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const rows = await api.incomingLpns(storeCode);
      setLpns(rows);
    } catch (e) {
      setError(errMsg(e, 'Could not load incoming LPNs'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [storeCode]);

  useEffect(() => { load(); }, [load]);

  const receive = async (barcode: string) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api.receiveLpn({ barcode, store_code: storeCode });
      setInfo(res?.message || `LPN ${barcode} received into dark-store custody.`);
      // Look up the LPN to open it for shelf putaway.
      const rows = await api.searchLpns(barcode).catch(() => [] as any[]);
      const found = rows.find((x: any) => x.barcode === barcode) || rows[0];
      if (found) {
        await openLpn({ id: found.lpn_id || found.id, barcode: found.barcode, status: found.status || 'RECEIVED', item_count: 0, total_units: 0 });
      }
      await load(true);
    } catch (e) {
      setError(errMsg(e, 'Receive failed'));
    } finally {
      setBusy(false);
      setScanTarget(null);
    }
  };

  const openLpn = async (lpn: LpnRow) => {
    setSelected(lpn);
    setPlacements([]);
    // Fetch full LPN with contents.
    try {
      const full = await api.receiveLpn ? null : null;
      // LpnMasterSerializer has no contents; fetch via the LPN-content endpoint.
      const res = await api.listLpnContents({ lpn: lpn.id }).catch(() => [] as any[]);
      const contents = Array.isArray(res) ? res : ((res as any)?.results || []);
      setLpnContents(contents);
      // Seed placements from contents (LpnContent: {id, lpn, sku, lot, qty}).
      setPlacements(contents.map((c: any) => ({
        sku: typeof c.sku === 'string' ? c.sku : c.sku?.sku_id || c.sku_id,
        sku_code: c.sku_code || c.sku?.sku_code,
        lot: typeof c.lot === 'string' ? c.lot : c.lot?.lot_id || c.lot_id,
        qty: c.qty,
        bin: '',
      })));
    } catch {
      setLpnContents([]);
    }
  };

  const commitShelf = async () => {
    if (!selected) return;
    const incomplete = placements.find((p) => !p.bin.trim() || p.qty <= 0);
    if (incomplete) {
      setError('Every placement needs a bin and a qty > 0.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.shelfPutaway({
        lpn: selected.id,
        placements: placements.map((p) => ({ sku: p.sku, lot: p.lot, bin: p.bin, qty: p.qty })),
      });
      setInfo(res?.message || `Shelved ${placements.length} line(s). ${res?.lpn_emptied ? 'LPN emptied.' : ''}`);
      setSelected(null);
      setLpnContents([]);
      setPlacements([]);
      await load(true);
    } catch (e) {
      setError(errMsg(e, 'Shelf putaway failed'));
    } finally {
      setBusy(false);
    }
  };

  const onBinScanned = (code: string, idx: number) => {
    setPlacements((prev) => prev.map((p, i) => (i === idx ? { ...p, bin: code } : p)));
    setScanTarget(null);
  };

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={C.yellow} />}
    >
      <Header title="DS Inbound" subtitle={`Incoming totes → receive → shelf putaway · ${storeCode}`} onBack={onBack} />

      <TouchableOpacity style={s.scanReceive} onPress={() => setScanTarget('receive')} disabled={busy}>
        <Text style={s.scanReceiveText}>▦ Scan tote to receive</Text>
      </TouchableOpacity>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {info ? <Text style={s.info}>{info}</Text> : null}

      {loading ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 24 }} />
      ) : lpns.length === 0 ? (
        <Empty msg="No incoming totes. Warehouse dispatches appear here once a transfer is in transit." />
      ) : (
        lpns.map((lpn) => (
          <TouchableOpacity key={lpn.id} style={[s.card, selected?.id === lpn.id ? s.cardOn : null]} onPress={() => openLpn(lpn)}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{lpn.barcode}</Text>
              <Text style={s.cardSub}>
                {lpn.mother_hub ? `${lpn.mother_hub} → ${storeCode} · ` : ''}{lpn.item_count || 0} items · {lpn.total_units || 0} units
              </Text>
            </View>
            <Chip tone={lpn.status === 'RECEIVED' ? 'green' : 'amber'}>{lpn.status}</Chip>
          </TouchableOpacity>
        ))
      )}

      {selected ? (
        <>
          <Text style={s.section}>Shelf putaway · {selected.barcode}</Text>
          <Text style={s.hint}>For each line, scan the destination bin. Stock moves out of the tote and onto the shelf.</Text>
          {placements.map((p, idx) => (
            <View key={`${p.sku}-${idx}`} style={s.placeRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.placeTitle}>{p.sku_code || p.sku}</Text>
                <Text style={s.placeSub}>qty {p.qty}{p.lot ? ` · lot ${String(p.lot).slice(0, 8)}` : ''}</Text>
              </View>
              <TouchableOpacity style={s.binBtn} onPress={() => setScanTarget('shelfBin')}>
                <Text style={s.binBtnText}>{p.bin || 'Scan bin'}</Text>
              </TouchableOpacity>
            </View>
          ))}
          {placements.length > 0 ? (
            <PrimaryBtn onPress={commitShelf} disabled={busy}>{busy ? 'Shelving…' : 'Commit shelf putaway'}</PrimaryBtn>
          ) : (
            <Text style={s.hint}>No contents found for this tote. Receive it first.</Text>
          )}
          <GhostBtn onPress={() => { setSelected(null); setPlacements([]); }}>Cancel</GhostBtn>
        </>
      ) : null}

      <Scanner visible={scanTarget === 'receive'} title="Scan tote" subtitle="Receive into dark-store custody" onScan={receive} onClose={() => setScanTarget(null)} />
      <Scanner
        visible={scanTarget === 'shelfBin'}
        title="Scan destination bin"
        subtitle="Pick-face bin for this line"
        onScan={(code) => {
          // Bind to the first placement without a bin.
          const idx = placements.findIndex((p) => !p.bin.trim());
          if (idx >= 0) onBinScanned(code, idx);
        }}
        onClose={() => setScanTarget(null)}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scanReceive: { backgroundColor: '#059669', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  scanReceiveText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.card, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  cardOn: { borderColor: '#059669' },
  cardTitle: { color: C.text, fontWeight: '700', fontSize: 14 },
  cardSub: { color: C.sub, fontSize: 12, marginTop: 3 },
  section: { color: C.text, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  hint: { color: C.faint, fontSize: 12, lineHeight: 16, marginBottom: 8 },
  placeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border, gap: 10 },
  placeTitle: { color: C.text, fontWeight: '700' },
  placeSub: { color: C.sub, fontSize: 12, marginTop: 2 },
  binBtn: { backgroundColor: C.blue, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  binBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  error: { color: '#b91c1c', backgroundColor: '#fecaca', padding: 10, borderRadius: 10, marginBottom: 10 },
  info: { color: '#6ee7b7', backgroundColor: '#064e3b', padding: 10, borderRadius: 10, marginBottom: 10 },
});
