import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { API_BASE } from '../../api/client';
import { Mail, LockKeyhole, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

export default function LoginView() {
  const { login } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/platform/auth/${isRegistering ? 'register' : 'login'}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          ...(isRegistering ? { name: name.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Authentication failed.');
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
          <img className="login-logo-image" src="/zippzo-logo.png" alt="Zippzo" />
          <div>
            <div className="login-logo-brand">ZIPPZO</div>
            <div className="login-logo-sub">WMS CORE V2.4</div>
          </div>
        </div>

        <div className="login-divider"></div>

        <h2 className="login-title">{isRegistering ? 'Create your account' : 'Sign in to Operations Console'}</h2>
        <p className="login-subtitle">Use your email address and password to access the warehouse console.</p>

        {error && (
          <div className="login-error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          {isRegistering && (
            <>
              <label className="login-label">Name</label>
              <div className="login-input-wrap">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required className="login-input" disabled={loading} />
              </div>
            </>
          )}
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
            <label className="login-label">Password</label>
            <div className="login-input-wrap">
              <LockKeyhole size={16} className="login-input-icon" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                minLength={8}
                className="login-input"
                disabled={loading}
              />
            </div>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}
              <span>{loading ? 'Please wait...' : isRegistering ? 'Register' : 'Sign In'}</span>
            </button>
        </form>

        <button type="button" className="login-back-btn" onClick={() => { setIsRegistering(!isRegistering); setError(''); }} disabled={loading}>
          {isRegistering ? 'Already have an account? Sign in' : 'Need an account? Register'}
        </button>

        <div className="login-footer">
          Warehouse Management System
        </div>
      </div>
    </div>
  );
}
