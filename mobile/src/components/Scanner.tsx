import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator, Modal } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

/**
 * Full-screen barcode / QR scanner with a manual-entry fallback.
 * Returns the raw scanned string via onScan. Close with onClose.
 */
export function Scanner({
  visible,
  title = 'Scan barcode',
  subtitle,
  onScan,
  onClose,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  onScan: (data: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  const [scanned, setScanned] = useState(false);

  if (!visible) return null;

  const handleBarcode = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    onScan(String(data ?? '').trim());
    // Reset shortly so the same component can be reused for the next scan.
    setTimeout(() => setScanned(false), 600);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        <View style={styles.head}>
          <Text style={styles.headTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}

        {!permission ? (
          <ActivityIndicator color="#38bdf8" style={{ marginTop: 40 }} />
        ) : !permission.granted ? (
          <View style={styles.permBox}>
            <Text style={styles.permText}>Camera access is needed to scan barcodes.</Text>
            <TouchableOpacity style={styles.btn} onPress={requestPermission}>
              <Text style={styles.btnText}>Grant camera access</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>You can type the code below instead.</Text>
          </View>
        ) : (
          <View style={styles.camBox}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              onBarcodeScanned={scanned ? undefined : handleBarcode}
            />
            <View style={styles.frame} />
            <Text style={styles.camHint}>Point at a barcode or QR code</Text>
          </View>
        )}

        <Text style={styles.label}>Or type the code</Text>
        <TextInput
          style={styles.input}
          value={manual}
          onChangeText={setManual}
          placeholder="Barcode / QR / bin code"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
        />
        <TouchableOpacity
          style={styles.btn}
          onPress={() => {
            const v = manual.trim();
            if (v) onScan(v);
          }}
        >
          <Text style={styles.btnText}>Use typed code</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#0b1220' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headTitle: { fontSize: 20, fontWeight: '800', color: '#3f3f46' },
  close: { padding: 8 },
  closeText: { fontSize: 20, color: '#94a3b8' },
  sub: { color: '#94a3b8', fontSize: 13, marginTop: 4, marginBottom: 12 },
  camBox: { height: 280, backgroundColor: '#111827', borderRadius: 12, overflow: 'hidden', justifyContent: 'flex-end', alignItems: 'center', borderWidth: 1, borderColor: '#1f2937', position: 'relative' },
  frame: { position: 'absolute', top: '28%', left: '18%', right: '18%', bottom: '28%', borderWidth: 2, borderColor: '#38bdf8', borderRadius: 12 },
  camHint: { position: 'absolute', bottom: 12, color: '#52525b', fontSize: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  label: { color: '#52525b', fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: '#111827', color: '#3f3f46', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#1f2937' },
  btn: { backgroundColor: '#0284c7', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  cancel: { marginTop: 16, alignItems: 'center' },
  cancelText: { color: '#94a3b8', fontWeight: '600' },
  permBox: { padding: 16, backgroundColor: '#111827', borderRadius: 12, borderWidth: 1, borderColor: '#1f2937', marginTop: 8 },
  permText: { color: '#52525b', marginBottom: 12 },
  hint: { color: '#64748b', fontSize: 12, marginTop: 10 },
});
