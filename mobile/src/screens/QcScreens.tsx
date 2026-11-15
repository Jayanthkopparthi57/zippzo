import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { api, errMsg } from '../api';
import { GrnLine, QcInspection, Sku } from '../types';
import { Header, C, Chip, PrimaryBtn, GhostBtn, SearchRow, Empty } from '../components/Ui';
import { Scanner } from '../components/Scanner';
import { skuMatches, norm } from '../utils';

function uninspected(l: GrnLine): number {
  return Math.max(0, (l.received_qty || 0) - (l.accepted_qty || 0) - (l.damaged_qty || 0));
}

// ---------------- List ----------------
export function QcListScreen({
  lines,
  onOpen,
  onBack,
  onRefresh,
}: {
  lines: GrnLine[];
  onOpen: (line: GrnLine) => void;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const pending = lines.filter((l) => uninspected(l) > 0);
  const done = lines.filter((l) => uninspected(l) === 0);
  const [q, setQ] = useState('');
  const [scan, setScan] = useState(false);

  const filtered = (arr: GrnLine[]) =>
    q.trim()
      ? arr.filter((l) => `${l.sku_code || ''} ${l.sku_name || ''} ${l.sku}`.toLowerCase().includes(q.trim().toLowerCase()))
      : arr;

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Header title="2 · Q.C." subtitle={`${pending.length} product(s) awaiting check`} onBack={onBack} />
      <SearchRow value={q} onChange={setQ} placeholder="Search SKU / name" onScan={() => setScan(true)} />
      <TouchableOpacity style={s.refresh} onPress={onRefresh}><Text style={s.refreshText}>⟳ Refresh</Text></TouchableOpacity>

      <Text style={s.section}>One by one — tap to inspect</Text>
      {filtered(pending).length === 0 ? (
        <Empty msg={q ? 'No match. Clear the search.' : 'All received stock has been checked. Move to Putaway.'} />
      ) : (
        filtered(pending).map((l, i) => (
          <TouchableOpacity key={l.line_id} style={s.card} onPress={() => onOpen(l)}>
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>
                {i + 1}. {l.sku_code || 'SKU'} — {l.sku_name || ''}
              </Text>
              <Text style={s.cardSub}>
                Received {l.received_qty} · Accepted {l.accepted_qty} · Damaged {l.damaged_qty} · Pending {uninspected(l)}
              </Text>
            </View>
            <Chip tone="amber">QC</Chip>
          </TouchableOpacity>
        ))
      )}

      {filtered(done).length ? (
        <>
          <Text style={s.section}>Checked</Text>
          {filtered(done).slice(0, 10).map((l) => (
            <View key={l.line_id} style={[s.card, s.cardDone]}>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle}>{l.sku_code || 'SKU'}</Text>
                <Text style={s.cardSub}>Accepted {l.accepted_qty} · Failed {l.damaged_qty}</Text>
              </View>
              <Chip tone="green">Done</Chip>
            </View>
          ))}
        </>
      ) : null}

      <Scanner
        visible={scan}
        title="Scan product"
        subtitle="Find the Q.C. card for the scanned product"
        onScan={async (code) => {
          setScan(false);
          const c = code.trim();
          const sku = await api.resolveBarcodeToSku(c).catch(() => null);
          const hits = lines.filter((l) =>
            (sku && l.sku === sku.sku_id) ||
            norm(c) === norm(l.sku_code) ||
            l.sku === c
          );
          if (hits.length) onOpen(hits[0]);
          else setQ(code);
        }}
        onClose={() => setScan(false)}
      />
    </ScrollView>
  );
}

// ---------------- Detail ----------------
export function QcDetailScreen({
  line,
  onBack,
  onSaved,
  onNext,
}: {
  line: GrnLine;
  onBack: () => void;
  onSaved: (line: GrnLine) => void;
  onNext: () => void;
}) {
  const received = line.received_qty || 0;
  const [scanned, setScanned] = useState<string | null>(null);
  const [scanMatch, setScanMatch] = useState<null | 'match' | 'mismatch' | 'pending'>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [pass, setPass] = useState(0);
  const [fail, setFail] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Seed the steppers with whatever is already recorded.
  useEffect(() => {
    setPass(line.accepted_qty || 0);
    setFail(line.damaged_qty || 0);
    setScanned(null);
    setScanMatch(null);
    setError(null);
  }, [line.line_id]);

  // Resolve a scanned barcode against the catalogue (EAN / SKU code / barcode
  // table), not just against the line's SKU code. Warehouse products arrive with
  // the brand EAN on the pack, so the scan almost never equals sku_code.
  const resolveScan = useCallback(async (code: string): Promise<boolean> => {
    const c = code.trim();
    if (!c) return false;
    if (skuMatches(c, { sku_id: line.sku, sku_code: line.sku_code || '' } as any)) return true;
    try {
      const sku = await api.resolveBarcodeToSku(c);
      return !!(sku && sku.sku_id === line.sku);
    } catch {
      return false;
    }
  }, [line.sku, line.sku_code]);

  const okScan = scanMatch === 'match';

  const save = async (verdict: 'PASSED' | 'FAILED' | 'PARTIAL', goNext: boolean) => {
    if (!okScan) {
      setError('Scan this product first to confirm you are checking the right item.');
      return;
    }
    if (pass + fail > received) {
      setError(`${pass + fail} inspected but only ${received} received.`);
      return;
    }
    if (pass + fail === 0) {
      // A single full verdict is the normal one-by-one path.
      const pending = uninspected(line);
      if (verdict === 'PASSED') { setPass(received); }
      else if (verdict === 'FAILED') { setFail(received); }
      if (pending > 0 && pass + fail === 0) {
        setError('Choose Pass or Fail, or set quantities with + / −.');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      // Find or create the inspection for this line.
      let qc: QcInspection | null = null;
      const existing = await api.listQc({ grn_line: line.line_id }).catch(() => [] as QcInspection[]);
      qc = existing[0] ?? null;
      const payloadPass = pass + fail === 0 ? (verdict === 'PASSED' ? received : 0) : pass;
      const payloadFail = pass + fail === 0 ? (verdict === 'FAILED' ? received : 0) : fail;
      if (!qc) {
        qc = await api.createQc({
          grn_line: line.line_id,
          sample_size: payloadPass + payloadFail,
          pass_count: payloadPass,
          fail_count: payloadFail,
          status: verdict,
        });
      }
      const verified = await api.verifyQc(qc.qc_id, {
        pass_count: payloadPass,
        fail_count: payloadFail,
        status: verdict,
      });
      const nextLine: GrnLine = {
        ...line,
        accepted_qty: verified.accepted_qty ?? payloadPass,
        damaged_qty: verified.damaged_qty ?? payloadFail,
      };
      onSaved(nextLine);
      setInfo(verdict === 'PASSED' ? 'Passed — saved.' : verdict === 'FAILED' ? 'Failed — saved.' : 'Saved.');
      if (goNext) {
        // Move straight on to the next product in the queue.
        onNext();
      }
    } catch (e) {
      setError(errMsg(e, 'Could not save Q.C. result'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={s.root} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Header title={line.sku_code || 'Q.C. check'} subtitle={line.sku_name || ''} onBack={onBack} />

      <View style={s.card}>
        <Text style={s.cardSub}>Received {received} · Accepted {line.accepted_qty} · Failed {line.damaged_qty} · Pending {uninspected(line)}</Text>
        {line.expiry_date ? <Text style={s.cardSub}>Expiry {line.expiry_date}</Text> : null}
        {line.lot ? <Text style={s.cardSub}>Lot {line.lot}</Text> : null}
      </View>

      <Text style={s.section}>1 · Scan the product</Text>
      {scanned ? (
        <View style={[s.scanState, okScan ? s.scanOk : s.scanBad]}>
          <Text style={s.scanStateText}>
            {okScan ? `✓ ${scanned} — matches this item` : `✕ ${scanned} — does not match. Scan the right product.`}
          </Text>
        </View>
      ) : null}
      <TouchableOpacity style={s.scanBtn} onPress={() => setScanOpen(true)}>
        <Text style={s.scanBtnText}>▦ {scanned ? 'Scan again' : 'Scan product barcode'}</Text>
      </TouchableOpacity>
      {scanMatch === 'pending' ? <Text style={s.cardSub}>Checking barcode…</Text> : null}

      <Text style={s.section}>2 · Pass / Fail</Text>
      <View style={s.stepperRow}>
        <View style={s.stepCol}>
          <Text style={s.stepLab}>Pass</Text>
          <View style={s.stepper}>
            <TouchableOpacity style={s.stepBtn} onPress={() => setPass(Math.max(0, pass - 1))}><Text style={s.stepSym}>−</Text></TouchableOpacity>
            <Text style={s.stepVal}>{pass}</Text>
            <TouchableOpacity style={s.stepBtn} onPress={() => setPass(Math.min(received, pass + 1))}><Text style={s.stepSym}>+</Text></TouchableOpacity>
          </View>
        </View>
        <View style={s.stepCol}>
          <Text style={s.stepLab}>Fail</Text>
          <View style={s.stepper}>
            <TouchableOpacity style={s.stepBtn} onPress={() => setFail(Math.max(0, fail - 1))}><Text style={s.stepSym}>−</Text></TouchableOpacity>
            <Text style={s.stepVal}>{fail}</Text>
            <TouchableOpacity style={s.stepBtn} onPress={() => setFail(Math.min(received, fail + 1))}><Text style={s.stepSym}>+</Text></TouchableOpacity>
          </View>
        </View>
      </View>
      <Text style={s.hint}>Tip: Pass / Fail on the right marks the whole pending quantity; use + / − only for a partial check.</Text>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {info ? <Text style={s.info}>{info}</Text> : null}

      <View style={s.halfRow}>
        <TouchableOpacity style={[s.half, { backgroundColor: '#059669' }]} onPress={() => save('PASSED', false)} disabled={busy}>
          <Text style={s.halfText}>{busy ? '…' : '✓ Pass'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.half, { backgroundColor: '#b91c1c' }]} onPress={() => save('FAILED', false)} disabled={busy}>
          <Text style={s.halfText}>{busy ? '…' : '✕ Fail'}</Text>
        </TouchableOpacity>
      </View>
      <PrimaryBtn onPress={() => save(pass > 0 && fail > 0 ? 'PARTIAL' : pass > 0 ? 'PASSED' : 'FAILED', true)} disabled={busy}>
        {busy ? 'Saving…' : 'Save & Next →'}
      </PrimaryBtn>
      <GhostBtn onPress={onNext}>Skip to next product</GhostBtn>

      <Scanner
        visible={scanOpen}
        title="Scan product"
        subtitle={`Expected: ${line.sku_code || line.sku}`}
        onScan={(code) => {
          setScanned(code);
          setScanMatch('pending');
          setScanOpen(false);
          resolveScan(code).then((ok) => setScanMatch(ok ? 'match' : 'mismatch'));
        }}
        onClose={() => setScanOpen(false)}
      />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  card: { backgroundColor: C.card, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDone: { opacity: 0.75 },
  cardTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  cardSub: { color: C.sub, fontSize: 12, marginTop: 3, lineHeight: 16 },
  section: { color: C.text, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  refresh: { alignSelf: 'flex-end', marginBottom: 6 },
  refreshText: { color: C.yellow, fontWeight: '700' },
  scanState: { padding: 10, borderRadius: 10, marginBottom: 8 },
  scanOk: { backgroundColor: '#064e3b' },
  scanBad: { backgroundColor: '#fecaca' },
  scanStateText: { color: '#3f3f46', fontSize: 13, lineHeight: 18 },
  scanBtn: { backgroundColor: C.blue, padding: 16, borderRadius: 12, alignItems: 'center' },
  scanBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  stepperRow: { flexDirection: 'row', gap: 10 },
  stepCol: { flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  stepLab: { color: C.sub, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: C.cardAlt, justifyContent: 'center', alignItems: 'center' },
  stepSym: { color: C.text, fontSize: 18, fontWeight: '800' },
  stepVal: { color: C.text, fontSize: 20, fontWeight: '800', minWidth: 36, textAlign: 'center' },
  hint: { color: C.faint, fontSize: 12, marginTop: 8, lineHeight: 16 },
  error: { color: '#b91c1c', backgroundColor: '#fecaca', padding: 10, borderRadius: 10, marginTop: 10 },
  info: { color: '#6ee7b7', backgroundColor: '#064e3b', padding: 10, borderRadius: 10, marginTop: 10 },
  halfRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  half: { flex: 1, padding: 16, borderRadius: 10, alignItems: 'center' },
  halfText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
