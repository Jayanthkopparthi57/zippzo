import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { describeError, postApi } from '../../api/client';
import { CheckCircle2, Timer, ShieldCheck, ArrowRight } from 'lucide-react';

const GREEN = '#177a45';
const GREEN_DEEP = '#0e5b30';
const GREEN_SOFT = '#e9f5ed';

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px 16px',
  marginBottom: 12,
  borderRadius: 12,
  border: '1px solid #dce5de',
  background: '#fff',
  color: '#16251b',
  fontSize: 15,
  fontFamily: 'inherit',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
};

const buttonStyle = (disabled) => ({
  width: '100%',
  border: 0,
  borderRadius: 12,
  padding: '15px 16px',
  color: '#fff',
  background: GREEN,
  fontSize: 16,
  fontWeight: 700,
  cursor: disabled ? 'wait' : 'pointer',
  boxShadow: '0 2px 0 #0e5b30',
});

export default function ShopperAccessView() {
  const { login } = useAuth();
  const [stage, setStage] = useState('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (stage === 'login') {
        await login(email.trim(), password);
      } else if (stage === 'register') {
        await postApi('/iam/auth/shopper/register', { email, name, phone, password });
        await login(email.trim(), password);
      } else if (stage === 'reset') {
        const response = await postApi('/iam/auth/shopper/password-reset', { email });
        setMessage(response.message); setStage('reset-confirm');
      } else {
        const response = await postApi('/iam/auth/shopper/password-reset/confirm', { email, code, new_password: password });
        setMessage(response.message); setStage('login'); setPassword(''); setCode('');
      }
    } catch (exception) { setError(describeError(exception)); }
    finally { setBusy(false); }
  };

  const title = {
    login: 'Welcome back',
    register: 'Create your account',
    reset: 'Reset your password',
    'reset-confirm': 'Choose a new password',
  }[stage];

  const cta = {
    login: 'Sign in',
    register: 'Create account',
    reset: 'Send reset code',
    'reset-confirm': 'Change password',
  }[stage];

  const helperText = {
    login: 'Use the email and password you registered with.',
    register: 'One step — your account is live the moment you submit.',
    reset: 'We will send a reset code to your email.',
    'reset-confirm': 'Enter the 6-digit code and a new password (12+ characters).',
  }[stage];

  return (
    <main style={{
      minHeight: '100vh', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif', background: '#f6faf8',
    }}>
      {/* brand panel */}
      <aside style={{
        background: GREEN,
        color: '#ffffff',
        padding: '40px 48px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 24,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* decorative circles */}
        <span aria-hidden="true" style={{ position: 'absolute', width: 380, height: 380, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', top: -140, right: -120 }} />
        <span aria-hidden="true" style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', bottom: -80, left: -80 }} />
        <div style={{ position: 'relative' }}>
          <img src="/zippzo-logo-192.png" alt="Zippzo" style={{ width: 112, height: 112, objectFit: 'contain', marginBottom: 18, background: '#ffffff', borderRadius: 26, padding: 12 }} />
          <h2 style={{ fontSize: 26, lineHeight: 1.25, fontWeight: 800, margin: '0 0 12px', maxWidth: 440 }}>
            Groceries at your door,<br />in minutes.
          </h2>
          <p style={{ color: '#d7ecdd', fontSize: 14.5, lineHeight: 1.6, margin: 0, maxWidth: 430 }}>
            Zippzo runs neighbourhood dark stores so your order is picked, packed and delivered
            in minutes — not days.
          </p>
        </div>
        <ul style={{ position: 'relative', listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12, fontSize: 13.5 }}>
          {[
            { icon: Timer, text: '15-minute delivery from a store near you' },
            { icon: ShieldCheck, text: 'Quality checks on every single pick' },
            { icon: CheckCircle2, text: 'Best price always — guaranteed' },
          ].map(({ icon: Icon, text }) => (
            <li key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon size={18} color="#b8f0cb" aria-hidden="true" />
              <span style={{ color: '#e6f5ec' }}>{text}</span>
            </li>
          ))}
        </ul>
      </aside>

      {/* form panel */}
      <section style={{ display: 'grid', placeItems: 'center', padding: '32px 24px' }}>
        <form onSubmit={run} style={{ width: '100%', maxWidth: 420 }}>
          <img src="/zippzo-logo-192.png" alt="Zippzo" style={{ width: 72, height: 72, objectFit: 'contain', margin: '0 auto 16px', opacity: 0.92 }} />
          <h1 style={{ color: '#16251b', fontSize: 26, fontWeight: 800, margin: '0 0 6px', textAlign: 'center' }}>{title}</h1>
          <p style={{ color: '#65736a', fontSize: 13.5, margin: '0 0 22px', textAlign: 'center' }}>{helperText}</p>

          {message && <div role="status" style={{ padding: 12, marginBottom: 12, borderRadius: 10, background: GREEN_SOFT, color: GREEN_DEEP, fontSize: 13 }}>{message}</div>}
          {error && <div role="alert" style={{ padding: 12, marginBottom: 12, borderRadius: 10, background: '#fdecea', color: '#a6301f', fontSize: 13 }}>{error}</div>}

          {stage === 'register' && (
            <>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#65736a', margin: '0 0 6px', letterSpacing: '.04em' }}>FULL NAME</label>
              <input aria-label="Full name" required autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#65736a', margin: '0 0 6px', letterSpacing: '.04em' }}>MOBILE NUMBER</label>
              <input aria-label="Mobile number" required autoComplete="tel" inputMode="numeric" placeholder="10-digit mobile number" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))} style={inputStyle} />
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#65736a', margin: '0 0 6px', letterSpacing: '.04em' }}>EMAIL</label>
              <input aria-label="Email" required autoComplete="email" inputMode="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} type="email" style={inputStyle} />
            </>
          )}

          {['login', 'reset'].includes(stage) && (
            <>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#65736a', margin: '0 0 6px', letterSpacing: '.04em' }}>EMAIL</label>
              <input aria-label="Email" required autoComplete="email" inputMode="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} type="email" style={inputStyle} />
            </>
          )}

          {['login', 'register', 'reset-confirm'].includes(stage) && (
            <>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#65736a', margin: '0 0 6px', letterSpacing: '.04em' }}>PASSWORD</label>
              <input
                aria-label="Password" required autoComplete={stage === 'login' ? 'current-password' : 'new-password'}
                type="password" minLength={stage === 'login' ? 1 : 12}
                placeholder={stage === 'login' ? 'Password' : 'Password (12+ characters)'}
                value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle}
              />
            </>
          )}

          {stage === 'reset-confirm' && (
            <>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#65736a', margin: '0 0 6px', letterSpacing: '.04em' }}>EMAIL CODE</label>
              <input aria-label="Email code" required inputMode="numeric" maxLength={6} placeholder="6-digit email code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={inputStyle} />
            </>
          )}

          <button type="submit" disabled={busy} style={buttonStyle(busy)}>
            {busy ? 'One moment…' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{cta}<ArrowRight size={17} /></span>}
          </button>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 18, marginTop: 18, fontSize: 13 }}>
            {stage === 'login' ? (
              <>
                <button type="button" onClick={() => { setStage('register'); setError(''); setMessage(''); }} style={{ border: 0, padding: 0, background: 'none', color: GREEN_DEEP, fontWeight: 700, cursor: 'pointer' }}>Create account</button>
                <button type="button" onClick={() => { setStage('reset'); setError(''); setMessage(''); }} style={{ border: 0, padding: 0, background: 'none', color: GREEN_DEEP, fontWeight: 700, cursor: 'pointer' }}>Forgot password?</button>
              </>
            ) : (
              <button type="button" onClick={() => { setStage('login'); setError(''); setMessage(''); }} style={{ border: 0, padding: 0, background: 'none', color: GREEN_DEEP, fontWeight: 700, cursor: 'pointer' }}>← Back to sign in</button>
            )}
          </div>

          <p style={{ color: '#889588', fontSize: 11.5, lineHeight: 1.5, margin: '22px 0 0', textAlign: 'center' }}>
            Shoppers on this device are delivered by the nearest dark store. Staff sign-in lives at the operations console.
          </p>
        </form>
      </section>
    </main>
  );
}
