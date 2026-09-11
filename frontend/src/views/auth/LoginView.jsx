import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { API_BASE } from '../../api/client';
import { Mail, ArrowRight, ShieldCheck, Loader2, AlertCircle } from 'lucide-react';

export default function LoginView() {
  const { login } = useAuth();
  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [emailDelivered, setEmailDelivered] = useState(true);

  const handleSendCode = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/platform/auth/send-code/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to send code.');
        return;
      }
      setEmailDelivered(data.email_delivered !== false);
      setInfo(data.message || 'Code sent. Check your inbox.');
      setStep('otp');
    } catch (err) {
      setError('Network error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    if (!otpCode.trim() || otpCode.trim().length !== 6) {
      setError('Enter the 6-digit code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/platform/auth/verify-code/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: otpCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Verification failed.');
        return;
      }
      login(data.token, data.user);
    } catch (err) {
      setError('Network error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-badge">Z</div>
          <div>
            <div className="login-logo-brand">ZIPPZO</div>
            <div className="login-logo-sub">WMS CORE V2.4</div>
          </div>
        </div>

        <div className="login-divider"></div>

        <h2 className="login-title">
          {step === 'email' ? 'Sign in to Operations Console' : 'Enter Verification Code'}
        </h2>
        <p className="login-subtitle">
          {step === 'email'
            ? 'Enter your email to receive a one-time login code.'
            : emailDelivered
              ? `A 6-digit code was sent to ${email}. Check your inbox (and spam).`
              : `Email delivery failed. Use the OTP printed in the Django server terminal for ${email}.`}
        </p>

        {error && (
          <div className="login-error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {info && !error && step === 'otp' && (
          <div className={emailDelivered ? 'login-info' : 'login-warn'}>
            <ShieldCheck size={14} />
            <span>{info}</span>
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="login-form">
            <label className="login-label">Email Address</label>
            <div className="login-input-wrap">
              <Mail size={16} className="login-input-icon" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoFocus
                required
                className="login-input"
                disabled={loading}
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
              <span>{loading ? 'Sending...' : 'Send Verification Code'}</span>
            </button>

            <div className="login-demo-row">
              <span className="login-demo-label">Quick sign-in</span>
              {['ops@company.com', 'admin@zippzo.com', 'planner@zippzo.com'].map((demoEmail) => (
                <button
                  key={demoEmail}
                  type="button"
                  className="login-demo-btn"
                  disabled={loading}
                  onClick={() => {
                    setEmail(demoEmail);
                    setError('');
                  }}
                >
                  {demoEmail.split('@')[0]}
                </button>
              ))}
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="login-form">
            <label className="login-label">6-Digit Code</label>
            <div className="login-input-wrap">
              <ShieldCheck size={16} className="login-input-icon" />
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
                required
                maxLength={6}
                className="login-input login-input-otp"
                disabled={loading}
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
              <span>{loading ? 'Verifying...' : 'Verify & Sign In'}</span>
            </button>
            <button
              type="button"
              className="login-back-btn"
              onClick={() => { setStep('email'); setError(''); setOtpCode(''); }}
              disabled={loading}
            >
              Back to email
            </button>
          </form>
        )}

        <div className="login-footer">
          Warehouse Management System
        </div>
      </div>
    </div>
  );
}
