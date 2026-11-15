import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

// `qrcode` is a pure-JavaScript encoder: it gives us the module matrix and we
// paint it with Views, so the rider app does not need a native SVG dependency
// just to show the handoff code the store scanner reads. The browser entry is
// imported directly: the package's default entry pulls in the Node image
// renderer (fs, pngjs), which Metro cannot bundle for a phone.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const QRCode = require('qrcode/lib/browser');

export function QrMatrix({ value, size = 196 }: { value: string; size?: number }) {
  const matrix = useMemo(() => {
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      return { size: qr.modules.size as number, data: qr.modules.data as Uint8Array };
    } catch {
      return null;
    }
  }, [value]);

  if (!matrix) return null;
  const cell = Math.max(2, Math.floor(size / matrix.size));
  const side = cell * matrix.size;

  return (
    <View style={[s.frame, { width: side + 16, height: side + 16 }]}>
      <View style={{ width: side, height: side, flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from(matrix.data).map((on, index) => (
          <View
            key={index}
            style={{
              width: cell,
              height: cell,
              backgroundColor: on ? '#120a24' : '#ffffff',
            }}
          />
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  frame: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
