import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { describeError } from '../../api/client';

export default function LoginView() {
  const { login, loading, routeNotice, appMeta } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    flushSync(() => {
      setSubmitting(true);
      setLocalError(null);
    });
    try {
      // The backend authenticates against iam.User and derives which of the
      // three Zippzo applications the account belongs to from its role
      // (target_app_for() in bounded/iam/views.py). A login whose role belongs
      // to a different application is rejected here and AuthGate renders the
      // wrong-app screen pointing at the right one.
      const result = await login(email, password);
      if (result?.mismatch) {
        flushSync(() => {
          setLocalError(
            `This account does not sign in to ${appMeta.name}. Check which Zippzo app you opened.`,
          );
        });
      }
    } catch (err) {
      console.error('[LoginView] Login failed:', err);
      const msg = describeError(err);
      console.log('[LoginView] Setting localError:', msg);
      flushSync(() => {
        setLocalError(msg);
      });
    } finally {
      flushSync(() => {
        setSubmitting(false);
      });
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      background: 'radial-gradient(ellipse at 50% 20%, #1e1b4b 0%, #090d16 60%, #030712 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute',
        top: '-10%',
        left: '20%',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, transparent 70%)',
        filter: 'blur(60px)',
        pointerEvents: 'none',
        transition: 'all 0.5s ease'
      }} />

      <div style={{
        width: '100%',
        maxWidth: '450px',
        background: 'rgba(17, 24, 39, 0.85)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '20px',
        padding: '36px 32px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        position: 'relative',
        zIndex: 10
      }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #0284c7, #0369a1)',
            color: '#fff',
            fontWeight: '900',
            fontSize: '26px',
            marginBottom: '14px'
          }}>
            ZP
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: '800', margin: '0 0 6px 0' }}>
            {appMeta.name}
          </h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
            {appMeta.tagline}
          </p>
        </div>

        {routeNotice && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '10px',
            padding: '12px 14px',
            marginBottom: '20px',
            fontSize: '12px',
            color: '#fca5a5'
          }}>
            {routeNotice.message}
          </div>
        )}

        {localError && (
          <div
            data-testid="login-error"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '16px',
              fontSize: '12px',
              color: '#f87171'
            }}>
            {localError}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#e2e8f0', marginBottom: '6px' }}>
              {appMeta.emailLabel}
            </label>
            <input
              data-testid="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder={appMeta.emailPlaceholder}
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '10px',
                padding: '11px 14px',
                color: '#f8fafc',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#e2e8f0', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
              style={{
                width: '100%',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '10px',
                padding: '11px 14px',
                color: '#f8fafc',
                fontSize: '13px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <hr style={{ height: '1px', background: 'rgba(255,255,255,0.1)', margin: '4px 0', border: 'none' }} />

          <button
            type="submit"
            disabled={submitting || loading}
            style={{
              width: '100%',
              marginTop: '12px',
              padding: '13px',
              borderRadius: '10px',
              border: 'none',
              background: 'linear-gradient(135deg, #0284c7, #0369a1)',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: '700',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1
            }}
          >
            {submitting ? 'Authenticating...' : 'Sign In →'}
          </button>
        </form>
      </div>
    </div>
  );
}
