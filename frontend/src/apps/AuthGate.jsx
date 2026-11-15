import React from 'react';
import { AlertTriangle, ExternalLink, LogOut } from 'lucide-react';
import LoginView from '../views/auth/LoginView';
import ShopperAccessView from '../views/shopper/ShopperAccessView';
import { useAuth } from '../context/AuthContext';
import { APPS } from './registry';

function LoadingScreen({ name, appKey }) {
  return (
    <div
      data-app-loading={appKey}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-secondary)',
      }}
    >
      Loading {name}...
    </div>
  );
}

/**
 * Shown when a login answered with a target_app belonging to a different
 * application — a rider account typed into the store console, for example.
 *
 * The token is already dropped by AuthContext; this only points the person at
 * the app their account actually lives in. On the web the sibling entry is one
 * click away; on Android each app is its own install, so the link is hidden.
 */
function WrongAppScreen({ expected, actualKey, onDismiss }) {
  const actual = actualKey ? APPS[actualKey] : null;
  const native = window.Capacitor?.isNativePlatform?.() === true;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', padding: '24px',
    }}>
      <div style={{
        maxWidth: '460px', width: '100%', padding: '28px', borderRadius: '14px',
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color, #2a2f3a)',
        color: 'var(--text-primary)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
          <AlertTriangle size={22} style={{ color: '#f0b429' }} />
          <h2 style={{ margin: 0, fontSize: '18px' }}>Wrong Zippzo app</h2>
        </div>

        <p style={{ margin: '0 0 12px', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          This account opens <strong style={{ color: 'var(--text-primary)' }}>
            {actual ? actual.name : 'a different Zippzo app'}</strong>, not{' '}
          <strong style={{ color: 'var(--text-primary)' }}>{expected.name}</strong>.
        </p>

        {!native && actual && (
          <a
            href={`/${actual.entry}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '10px 16px', borderRadius: '10px', marginBottom: '16px',
              background: 'var(--accent, #4c6fff)', color: '#fff',
              textDecoration: 'none', fontSize: '14px', fontWeight: 600,
            }}
            data-testid="wrong-app-open"
          >
            Open {actual.name} <ExternalLink size={15} />
          </a>
        )}

        {native && actual && (
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Please sign in with the {actual.name} app.
          </p>
        )}

        <button
          type="button"
          onClick={onDismiss}
          data-testid="wrong-app-signout"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 16px', borderRadius: '10px', cursor: 'pointer',
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid var(--border-color, #2a2f3a)', fontSize: '14px',
          }}
        >
          <LogOut size={15} /> Sign in with a different account
        </button>
      </div>
    </div>
  );
}

/**
 * Every app boots through this: loading, logged out, wrong application, or the
 * app's own authenticated shell (passed in as children).
 */
export default function AuthGate({ appKey, children }) {
  const { user, loading, appMeta, appMismatch, logout } = useAuth();

  if (loading) return <LoadingScreen name={appMeta.name} />;
  if (appMismatch) {
    return (
      <WrongAppScreen
        expected={appMismatch.expected || appMeta}
        actualKey={appMismatch.actualKey}
        onDismiss={logout}
      />
    );
  }
  if (!user) return appKey === 'shopper' ? <ShopperAccessView /> : <LoginView />;
  return children;
}
