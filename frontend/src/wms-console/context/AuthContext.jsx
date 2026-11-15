import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_BASE } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount, check if we have a saved session
  useEffect(() => {
    const savedToken = localStorage.getItem('zippzo_jwt');
    const savedUser = localStorage.getItem('zippzo_auth_user');
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('zippzo_jwt');
        localStorage.removeItem('zippzo_auth_user');
      }
    }
    setLoading(false);
  }, []);

  const login = (tokenVal, userData) => {
    setToken(tokenVal);
    setUser(userData);
    localStorage.setItem('zippzo_jwt', tokenVal);
    localStorage.setItem('zippzo_auth_user', JSON.stringify(userData));
  };

  const logout = () => {
    // Fire-and-forget logout call
    const savedToken = localStorage.getItem('zippzo_jwt');
    if (savedToken) {
      fetch(`${API_BASE}/iam/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${savedToken}`,
        },
      }).catch(() => {});
    }
    setToken(null);
    setUser(null);
    localStorage.removeItem('zippzo_jwt');
    localStorage.removeItem('zippzo_auth_user');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
