import React from 'react';
import { RefreshCw, ScanLine } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import StoreGate from './StoreGate';
import { useDarkStore, useAsyncData } from './useDarkStore';
import { fetchApi } from '../../api/client';

export default function AuthenticationView() {
  const { storeCode, siteId } = useDarkStore();
  const { data, loading, reload } = useAsyncData(
    () => (storeCode ? fetchApi(`/iam/auth/store-code?site_code=${encodeURIComponent(storeCode)}`) : Promise.resolve(null)),
    [storeCode],
    { pollMs: 60000 },
  );
  const storeQr = storeCode ? `zippzo:site:${storeCode}` : '';

  return (
    <StoreGate>
      {siteId && (
        <div style={{ paddingBottom: 24, maxWidth: 760 }}>
          <div className="screen-header">
            <div className="screen-title"><span>AUTHENTICATION</span></div>
            <div className="screen-actions">
              <button className="btn-ui neutral" onClick={() => reload()} disabled={loading}>
                <RefreshCw size={12} className={loading ? 'spin' : ''} /> <span>Refresh</span>
              </button>
            </div>
          </div>

          <section className="wf-panel" style={{ textAlign: 'center', padding: 28 }}>
            <div className="mono-num" style={{ fontSize: 52, fontWeight: 800, letterSpacing: 8 }} data-testid="daily-otp">
              {data?.otp || '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
              {data?.site_name || storeCode} · {data?.date || 'today'}
            </div>
          </section>

          <section className="wf-panel" style={{ marginTop: 16, padding: 18 }}>
            <div className="wf-peek"><ScanLine size={15} /> Rider activation QR</div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
              {storeQr && <QRCodeSVG value={storeQr} size={150} data-testid="site-activation-qr" />}
              <strong className="mono-num" style={{ fontSize: 13 }}>{storeQr}</strong>
            </div>
          </section>
        </div>
      )}
    </StoreGate>
  );
}
