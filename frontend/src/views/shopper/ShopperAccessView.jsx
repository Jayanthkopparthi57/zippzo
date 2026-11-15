import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { describeError, postApi } from '../../api/client';

export default function ShopperAccessView() {
  const { login, appMeta } = useAuth();
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

  const input = { width: '100%', boxSizing: 'border-box', padding: '13px 14px', marginBottom: 12, borderRadius: 10, border: '1px solid #dce5de', background: '#fff', color: '#16251b', fontSize: 14 };
  const button = { width: '100%', border: 0, borderRadius: 10, padding: 14, color: '#fff', background: '#177a45', fontSize: 15, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' };
  const title = { login: 'Groceries at your door', register: 'Create your shopper account', reset: 'Reset your password', 'reset-confirm': 'Choose a new password' }[stage];

  return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f4f7f4', fontFamily: 'Inter, system-ui, sans-serif' }}>
    <section style={{ width: '100%', maxWidth: 420, padding: 30, background: '#fff', borderRadius: 18, boxShadow: '0 16px 50px #15251b12' }}>
      <img src="/zippzo-logo-192.png" alt="Zippzo" style={{ width: 125, height: 125, objectFit: 'contain', marginBottom: 10 }} />
      <h1 style={{ color: '#16251b', fontSize: 24, margin: '0 0 8px' }}>{title}</h1>
      <p style={{ color: '#65736a', fontSize: 14, lineHeight: 1.5, margin: '0 0 22px' }}>Shop the products available at the dark store serving your delivery address.</p>
      {message && <div role="status" style={{ padding: 12, marginBottom: 14, borderRadius: 9, background: '#e8f6ec', color: '#147242', fontSize: 13 }}>{message}</div>}
      {error && <div role="alert" style={{ padding: 12, marginBottom: 14, borderRadius: 9, background: '#fff0ee', color: '#b42318', fontSize: 13 }}>{error}</div>}
      <form onSubmit={run}>
        {stage === 'register' && <><input aria-label="Full name" required autoComplete="name" placeholder="Full name" value={name} onChange={e => setName(e.target.value)} style={input} /><input aria-label="Mobile number" required autoComplete="tel" inputMode="tel" placeholder="Mobile number" value={phone} onChange={e => setPhone(e.target.value)} style={input} /></>}
        <input aria-label="Email" required type="email" autoComplete="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} style={input} />
        {['login', 'register', 'reset-confirm'].includes(stage) && <input aria-label="Password" required type="password" autoComplete={stage === 'login' ? 'current-password' : 'new-password'} minLength={stage === 'login' ? 1 : 12} placeholder={stage === 'login' ? 'Password' : 'Password (12+ characters)'} value={password} onChange={e => setPassword(e.target.value)} style={input} />}
        {['reset-confirm'].includes(stage) && <input aria-label="Email code" required inputMode="numeric" maxLength={6} placeholder="6-digit email code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} style={input} />}
        <button type="submit" disabled={busy} style={button}>{busy ? 'Please wait…' : ({ login: 'Sign in', register: 'Create account', reset: 'Send reset code', 'reset-confirm': 'Change password' }[stage])}</button>
      </form>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 18, fontSize: 13 }}>
        {stage === 'login' ? <><button type="button" onClick={() => { setStage('register'); setError(''); setMessage(''); }} style={{ border: 0, padding: 0, background: 'none', color: '#147242', cursor: 'pointer' }}>Create account</button><button type="button" onClick={() => { setStage('reset'); setError(''); setMessage(''); }} style={{ border: 0, padding: 0, background: 'none', color: '#147242', cursor: 'pointer' }}>Forgot password?</button></> : <button type="button" onClick={() => { setStage('login'); setError(''); setMessage(''); }} style={{ border: 0, padding: 0, background: 'none', color: '#147242', cursor: 'pointer' }}>Back to sign in</button>}
      </div>
      <p style={{ color: '#738078', fontSize: 12, margin: '20px 0 0' }}>Email verification is currently disabled for new accounts. Staff accounts use the operations sign-in.</p>
    </section>
  </main>;
}
