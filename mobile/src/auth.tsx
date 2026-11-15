import React, { createContext, useContext, useEffect, useState } from 'react';
import { clearSession, readAccess, readFacility, readRefresh, readUser, saveSession } from './storage';
import { api, setAccessToken, isApiError, getAccessToken } from './api';
import { ApiError, AuthResponse, Facility, User } from './types';
import * as Crypto from 'expo-crypto';

interface AuthState {
  loading: boolean;
  user: User | null;
  facility: Facility | null;
  department: string | null;
  capabilities: AuthResponse['capabilities'] | null;
  challengeId: string | null;
  challengeToken: string | null;
  facilities: Facility[];
  needsFacility: boolean;
  needsOtp: boolean;
  login: (email: string, password: string) => Promise<void>;
  phoneLogin: (phone: string, storeCode: string, siteCode?: string) => Promise<void>;
  selectFacility: (facilityCode: string) => Promise<void>;
  verifyOtp: (otp: string) => Promise<void>;
  resendOtp: () => Promise<void>;
  switchFacility: (facilityCode: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [facility, setFacility] = useState<Facility | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AuthResponse['capabilities'] | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [needsFacility, setNeedsFacility] = useState(false);
  const [needsOtp, setNeedsOtp] = useState(false);

  const applySession = async (resp: AuthResponse) => {
    setAccessToken(resp.token);
    await saveSession(resp.token, resp.refresh_token, resp.user, resp.facility);
    setUser(resp.user);
    setFacility(resp.facility);
    setDepartment((resp as any).department || resp.capabilities?.department || null);
    setCapabilities(resp.capabilities || null);
    setChallengeId(null);
    setChallengeToken(null);
    setNeedsFacility(false);
    setNeedsOtp(false);
    setFacilities([]);
  };

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const resp = await api.login(email, password);
      if ((resp as any).facility_required) {
        setChallengeId(resp.challenge_id!);
        setChallengeToken(resp.challenge_token!);
        setFacilities(resp.facilities || []);
        setNeedsFacility(true);
        setNeedsOtp(false);
        return;
      }
      if ((resp as any).otp_required) {
        setChallengeId(resp.challenge_id!);
        setChallengeToken(resp.challenge_token!);
        setFacilities(resp.facilities || []);
        setFacility(resp.facility);
        setNeedsOtp(true);
        return;
      }
      await applySession(resp);
    } finally {
      setLoading(false);
    }
  };

  const phoneLogin = async (phone: string, storeCode: string, siteCode?: string) => {
    setLoading(true);
    try {
      const resp = await api.phoneLogin(phone, storeCode, siteCode);
      await applySession(resp);
    } finally {
      setLoading(false);
    }
  };

  const selectFacility = async (facilityCode: string) => {
    if (!challengeId || !challengeToken) return;
    setLoading(true);
    try {
      const resp = await api.selectFacility(challengeId, challengeToken, facilityCode);
      setFacility(resp.facility);
      setNeedsFacility(false);
      setNeedsOtp(true);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (otp: string) => {
    if (!challengeId || !challengeToken) return;
    setLoading(true);
    try {
      const resp = await api.verifyOtp(challengeId, challengeToken, otp);
      await applySession(resp);
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!challengeId || !challengeToken) return;
    await api.resendOtp(challengeId, challengeToken);
  };

  const switchFacility = async (facilityCode: string) => {
    const resp = await api.switchFacility(facilityCode);
    setFacility(resp.facility);
    const refresh = await readRefresh();
    await saveSession(getAccessToken()!, refresh!, user, resp.facility);
  };

  const logout = async () => {
    const refresh = await readRefresh();
    try { await api.logout(refresh); } catch {}
    setAccessToken(null);
    await clearSession();
    setUser(null);
    setFacility(null);
    setDepartment(null);
    setCapabilities(null);
    setChallengeId(null);
    setChallengeToken(null);
    setNeedsFacility(false);
    setNeedsOtp(false);
  };

  useEffect(() => {
    (async () => {
      const token = await readAccess();
      if (!token) { setLoading(false); return; }
      setAccessToken(token);
      try {
        const me = await api.me();
        setUser(me.user);
        setFacility(me.facility);
        setDepartment(me.department || me.capabilities?.department || null);
        setCapabilities(me.capabilities || null);
      } catch (err) {
        if (isApiError(err) && err.status === 401) {
          const refresh = await readRefresh();
          if (refresh) {
            try {
              const rotated = await api.refresh(refresh);
              await applySession(rotated);
            } catch {
              await clearSession();
              setAccessToken(null);
            }
          } else {
            await clearSession();
            setAccessToken(null);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        loading,
        user,
        facility,
        department,
        capabilities,
        challengeId,
        challengeToken,
        facilities,
        needsFacility,
        needsOtp,
        login,
        phoneLogin,
        selectFacility,
        verifyOtp,
        resendOtp,
        switchFacility,
        logout,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function uuidv4(): string {
  return Crypto.randomUUID();
}
