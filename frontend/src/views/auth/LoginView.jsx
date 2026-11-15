import React, { useState } from 'react';
import { flushSync } from 'react-dom';
import { useAuth } from '../../context/AuthContext';
import { describeError } from '../../api/client';

const inputStyle = {
  width: '100%',
  background: 'rgba(15, 23, 42, 0.8)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: '10px',
  padding: '11px 14px',
  color: '#f8fafc',
  fontSize: '13px',
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  fontSize: '12px',
  fontWeight: '600',
  color: '#e2e8f0',
  marginBottom: '6px',
};

const buttonStyle = (disabled) => ({
  width: '100%',
  marginTop: '12px',
  padding: '13px',
  borderRadius: '10px',
  border: 'none',
  background: 'linear-gradient(135deg, #6d4aff, #4f35e0)',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '700',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.7 : 1,
});

const siteTypeLabel = (site) => {
  if (site.site_type === 'MH') return 'Warehouse';
  if (site.site_type === 'DS') return 'Dark store';
  return site.site_type || 'Site';
};

/**
 * Staff sign-in wizard.
 *
 * Step 1 is the password. The server then either resolves the employee's only
 * facility (straight to OTP), returns a chooser for a multi-site employee, or —
 * for rider/consumer accounts — issues a token immediately. Nothing here can
 * widen access: the facility list and the resulting session are both built on
 * the server.
 */
export default function LoginView() {
  const { login, selectFacility, verifyOtp, resendOtp, loading, routeNotice, appMeta } = useAuth();

  const [stage, setStage] = useState('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [challengeId, setChallengeId] = useState(null);
  const [challengeToken, setChallengeToken] = useState(null);
  const [facilities, setFacilities] = useState([]);
  const [chosenFacility, setChosenFacility] = useState(null);
  const [otpSentTo, setOtpSentTo] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [notice, setNotice] = useState(null);

  const enterChallenge = (result) => {
    setChallengeId(result.challengeId);
    setChallengeToken(result.challengeToken);
    if (result.facilities?.length) setFacilities(result.facilities);
    if (result.facility) setChosenFacility(result.facility);
    if (result.otpSentTo) setOtpSentTo(result.otpSentTo);
    if (result.facilityRequired) {
      setStage('facility');
    } else if (result.otpRequired) {
      setStage('otp');
    }
  };

  const handleCredentials = async (e) => {
    e.preventDefault();
    flushSync(() => {
      setSubmitting(true);
      setLocalError(null);
      setNotice(null);
    });
    try {
      const result = await login(email, password);
      if (result?.mismatch) {
        setLocalError(`This account does not sign in to ${appMeta.name}. Check which Zippzo app you opened.`);
      } else if (result?.facilityRequired || result?.otpRequired) {
        enterChallenge(result);
      }
    } catch (err) {
      console.error('[LoginView] Login failed:', err);
      setLocalError(describeError(err));
    } finally {
      flushSync(() => setSubmitting(false));
    }
  };

  const handleFacility = async (site) => {
    flushSync(() => {
      setSubmitting(true);
      setLocalError(null);
    });
    try {
      const result = await selectFacility(challengeId, challengeToken, site.code);
      setChosenFacility(site);
      if (result?.otpSentTo) setOtpSentTo(result.otpSentTo);
      setOtp('');
      setStage('otp');
    } catch (err) {
      setLocalError(describeError(err));
    } finally {
      flushSync(() => setSubmitting(false));
    }
  };

  const handleOtp = async (e) => {
    e.preventDefault();
    flushSync(() => {
      setSubmitting(true);
      setLocalError(null);
    });
    try {
      const result = await verifyOtp(challengeId, challengeToken, otp);
      if (result?.mismatch) {
        setLocalError(`This account does not sign in to ${appMeta.name}. Check which Zippzo app you opened.`);
      }
    } catch (err) {
      console.error('[LoginView] OTP verification failed:', err);
      setLocalError(describeError(err));
    } finally {
      flushSync(() => setSubmitting(false));
    }
  };

  const handleResend = async () => {
    setLocalError(null);
    try {
      const result = await resendOtp(challengeId, challengeToken);
      setNotice('A new code was sent. It expires in 5 minutes.');
    } catch (err) {
      setLocalError(describeError(err));
    }
  };

  const startOver = () => {
    setStage('credentials');
    setOtp('');
    setChallengeId(null);
    setChallengeToken(null);
    setFacilities([]);
    setChosenFacility(null);
    setLocalError(null);
    setNotice(null);
  };

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      background: 'radial-gradient(ellipse at 50% 20%, #1a1332 0%, #0b0820 60%, #040215 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        top: '-10%',
        left: '20%',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(109, 74, 255, 0.22) 0%, transparent 70%)',
        filter: 'blur(60px)',
        pointerEvents: 'none',
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
        zIndex: 10,
      }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <img src="/zippzo-logo-192.png" alt="Zippzo" style={{
            width: 84,
            height: 84,
            objectFit: 'contain',
            marginBottom: '14px',
            filter: 'drop-shadow(0 12px 30px rgba(109, 74, 255, 0.35))',
          }} />
          <h2 style={{ fontSize: '24px', fontWeight: '800', margin: '0 0 6px 0' }}>
            {appMeta.name}
          </h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
            {stage === 'credentials' && appMeta.tagline}
            {stage === 'facility' && 'Choose the facility you are working at'}
            {stage === 'otp' && 'Enter the one-time code sent to you'}
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
            color: '#fca5a5',
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
              color: '#f87171',
            }}>
            {localError}
          </div>
        )}

        {notice && (
          <div style={{
            background: 'rgba(14, 165, 233, 0.12)',
            border: '1px solid rgba(14, 165, 233, 0.35)',
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '16px',
            fontSize: '12px',
            color: '#7dd3fc',
          }}>
            {notice}
          </div>
        )}

        {stage === 'credentials' && (
          <form onSubmit={handleCredentials} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={labelStyle}>{appMeta.emailLabel}</label>
              <input
                data-testid="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder={appMeta.emailPlaceholder}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Password</label>
              <input
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Enter your password"
                style={inputStyle}
              />
            </div>
            <button type="submit" data-testid="login-submit" disabled={submitting || loading} style={buttonStyle(submitting || loading)}>
              {submitting ? 'Checking…' : 'Continue →'}
            </button>
          </form>
        )}

        {stage === 'facility' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '12px', color: '#94a3b8' }}>
              Your account is assigned to more than one facility.
            </p>
            {facilities.map((site) => (
              <button
                key={site.code}
                type="button"
                data-testid="login-facility-option"
                data-facility-code={site.code}
                disabled={submitting}
                onClick={() => handleFacility(site)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(15, 23, 42, 0.7)',
                  color: '#f8fafc',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                }}>
                <strong style={{ display: 'block', fontSize: '13px' }}>{site.name || site.code}</strong>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {siteTypeLabel(site)} · {site.code}
                </span>
              </button>
            ))}
            <button type="button" onClick={startOver} style={{ ...buttonStyle(false), background: 'transparent', border: '1px solid rgba(255,255,255,0.2)' }}>
              Use a different account
            </button>
          </div>
        )}

        {stage === 'otp' && (
          <form onSubmit={handleOtp} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Facility</label>
              <div style={{
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'rgba(15, 23, 42, 0.55)',
                border: '1px solid rgba(255,255,255,0.1)',
                fontSize: '13px',
              }}>
                {chosenFacility?.name || chosenFacility?.code || 'Selected facility'}
                <span style={{ color: '#94a3b8' }}> · {chosenFacility?.code}</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>One-time code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                data-testid="login-otp"
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                placeholder="6-digit code"
                style={{ ...inputStyle, color: '#38bdf8', fontSize: '18px', letterSpacing: '4px', fontWeight: '700' }}
              />
              <p style={{ margin: '5px 0 0', fontSize: '11px', color: '#94a3b8' }}>
                {otpSentTo
                  ? `Sent to ${otpSentTo}. It expires in 5 minutes and can be used once.`
                  : 'The code expires 5 minutes after it is sent. It can be used once.'}
              </p>
            </div>
            <button type="submit" data-testid="login-submit" disabled={submitting || loading} style={buttonStyle(submitting || loading)}>
              {submitting ? 'Verifying…' : 'Verify & sign in →'}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
              <button type="button" onClick={handleResend} style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', padding: 0 }}>
                Send a new code
              </button>
              <button type="button" onClick={startOver} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 0 }}>
                Start over
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
