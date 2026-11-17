import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  fetchApi, postApi, setAuthToken, getAuthToken, describeError, liveEventsUrl, ApiError,
} from '../api/client';
import { APP, APPS, APP_KEY } from '../apps/registry';

const AuthContext = createContext();

// Namespaced per app — the same physical origin serves all four bundles, and
// a shared key lets one app's logout/mismatch wipe every other app's session.
const STORAGE_KEY_USER = `zippzo_auth_user:${APP_KEY}`;
const STORAGE_KEY_FACILITY = `zippzo_auth_facility:${APP_KEY}`;
const STORAGE_KEY_MODE = `zippzo_auth_app_mode:${APP_KEY}`;
const STORAGE_KEY_REFRESH = `zippzo_refresh_token:${APP_KEY}`;

function getLoginSurface() {
  const declaredAppSurface = typeof document !== 'undefined'
    && document.documentElement?.dataset?.surface === 'app';
  return Capacitor.isNativePlatform() || declaredAppSurface ? 'mobile' : 'web';
}

// Roles the backend routes to the WMS console (see iam.views.LoginAPIView).
const ADMIN_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER'];

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Which console this bundle renders is fixed at build time by the HTML entry
// point (src/apps/registry.js), not chosen at runtime. There is no longer an
// appMode state to switch: a rider bundle cannot render the shopper shell
// because those view modules are not in its chunk, and a shopper bundle cannot
// reach the store console for the same reason.
//
/**
 * Backend `user` is {user_id,email,full_name,role,status}.
 * Views render `name`/`avatar`/`is_admin`/`is_super_admin`, so derive them here.
 */
function normaliseUser(raw, allowedApps = raw?.allowed_apps || []) {
  if (!raw) return null;
  const fullName = raw.full_name || raw.name || '';
  const isSuperAdmin = raw.role === 'SUPER_ADMIN' || raw.is_super_admin === true;
  return {
    user_id: raw.user_id,
    email: raw.email || '',
    full_name: fullName,
    name: fullName || raw.email || 'Operator',
    role: raw.role || 'CUSTOMER',
    status: raw.status || 'ACTIVE',
    is_admin: ADMIN_ROLES.includes(raw.role) || isSuperAdmin,
    is_super_admin: isSuperAdmin,
    can_access_warehouse: isSuperAdmin || allowedApps.includes('WMS') || raw.can_access_warehouse === true,
    can_access_dark_store: isSuperAdmin || allowedApps.includes('DARK_STORE') || raw.can_access_dark_store === true,
    avatar: (fullName || raw.email || 'Z').trim().charAt(0).toUpperCase(),
  };
}

function splitSites(sites) {
  const list = Array.isArray(sites) ? sites : [];
  return {
    warehouses: list.filter(s => s.site_type === 'MH'),
    dark_stores: list.filter(s => s.site_type === 'DS'),
    all_facilities: list,
  };
}

// One-time hygiene: drop the shared legacy keys so no app ever reads another
// app's half-written session from before namespacing landed.
(function dropLegacySharedAuthKeys() {
  if (typeof localStorage === 'undefined') return;
  for (const key of ['zippzo_jwt', 'zippzo_auth_user', 'zippzo_auth_facility', 'zippzo_auth_app_mode', 'zippzo_refresh_token']) {
    try { localStorage.removeItem(key); } catch { /* storage may be unavailable */ }
  }
})();

export function AuthProvider({ appKey = APP.key, children }) {
  const appMeta = APPS[appKey] || APP;
  // Never trust a browser-cached user before `/iam/auth/me` validates the
  // session. Rendering the shell from cached state caused it to fire protected
  // API requests with revoked/expired tokens during the validation window.
  const [user, setUser] = useState(null);
  const [facility, setFacility] = useState(() => readStorage(STORAGE_KEY_FACILITY, null));
  // The console is the one this bundle was built as. It never changes.
  const appMode = appMeta.targetApp;
  const [appMismatch, setAppMismatch] = useState(null);
  const [facilitiesList, setFacilitiesList] = useState({
    warehouses: [],
    dark_stores: [],
    all_facilities: [],
  });
  const [loading, setLoading] = useState(() => Boolean(getAuthToken()));
  const [routeNotice, setRouteNotice] = useState(null);

  // Realtime is an enhancement over the durable notification inbox. If the
  // socket or Redis is unavailable, the product screens keep their API polling.
  useEffect(() => {
    const token = getAuthToken();
    if (!user?.user_id || !token || typeof WebSocket === 'undefined') return undefined;
    let socket;
    let timer;
    let closed = false;
    let retryMs = 1000;
    const connect = () => {
      if (closed) return;
      socket = new WebSocket(liveEventsUrl(), ['zippzo.events.v1', `auth.${token}`]);
      socket.onopen = () => {
        retryMs = 1000;
        // Broadcast reconnection so open views catch up on missed events immediately
        window.dispatchEvent(new CustomEvent('zippzo:live-event', {
          detail: { type: 'reconnected', at: new Date().toISOString() }
        }));
      };
      socket.onmessage = (message) => {
        try {
          const detail = JSON.parse(message.data);
          window.dispatchEvent(new CustomEvent('zippzo:live-event', { detail }));
        } catch { /* Ignore malformed frames and keep the connection alive. */ }
      };
      socket.onclose = () => {
        if (closed) return;
        timer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    // Fast reconnect when the device comes back online
    const onOnline = () => {
      if (closed) return;
      clearTimeout(timer);
      retryMs = 1000;
      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        connect();
      }
    };
    window.addEventListener('online', onOnline);

    return () => {
      closed = true;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      socket?.close(1000, 'session ended');
    };
  }, [user?.user_id]);

  // Drop the in-memory session and everything persisted for it.
  const clearSession = () => {
    const refresh = localStorage.getItem(STORAGE_KEY_REFRESH);
    if (refresh) {
      // Best effort: revoke the server session. The local state is cleared
      // regardless so a failed network call cannot strand the operator.
      postApi('/iam/auth/logout', { refresh_token: refresh }).catch(() => {});
    }
    setAuthToken(null);
    setUser(null);
    setFacility(null);
    localStorage.removeItem(STORAGE_KEY_USER);
    localStorage.removeItem(STORAGE_KEY_FACILITY);
    localStorage.removeItem(STORAGE_KEY_MODE);
    localStorage.removeItem(STORAGE_KEY_REFRESH);
  };

  const isDarkStore = appMeta.targetApp === 'DARK_STORE' || (
    facility?.site_type
      ? facility.site_type === 'DS'
      : (facilitiesList.all_facilities || []).find(s => s.code === facility?.code)?.site_type === 'DS'
  );

  const loadFacilities = useCallback(async () => {
    try {
      const res = await fetchApi('/network/overview');
      const list = Array.isArray(res?.all_facilities)
        ? res.all_facilities
        : [
            ...(res?.warehouses ?? []).map(s => ({ ...s, site_type: 'MH' })),
            ...(res?.dark_stores ?? []).map(s => ({ ...s, site_type: 'DS' })),
          ];
      const expectedType = appMeta.targetApp === 'DARK_STORE'
        ? 'DS'
        : appMeta.targetApp === 'WMS' ? 'MH' : null;
      const productSites = expectedType
        ? list.filter(site => site.site_type === expectedType)
        : list;
      setFacilitiesList(splitSites(productSites));

      // A console facility is a staff switching concept. For the shopper and
      // rider apps the newest store in the directory is not "their" store —
      // picking one persisted a facility the account may not even enter, and
      // the boot check then failed authorization and signed the account out on
      // every reload. Shopper/Rider keep the list for pickers but never pin a
      // facility of their own.
      if (productSites.length > 0) {
        const staffApp = appMeta.targetApp === 'DARK_STORE' || appMeta.targetApp === 'WMS';
        if (staffApp) {
          const preferred = productSites[0];
          setFacility(prev => {
            if (!prev || !productSites.some(s => s.code === prev.code)) {
              localStorage.setItem(STORAGE_KEY_FACILITY, JSON.stringify(preferred));
              return preferred;
            }
            return prev;
          });
        } else {
          setFacility(prev => (prev ? null : prev));
          localStorage.removeItem(STORAGE_KEY_FACILITY);
        }
      } else {
        setFacility(null);
        localStorage.removeItem(STORAGE_KEY_FACILITY);
      }
      return list;
    } catch (err) {
      console.error('Could not load sites from backend:', describeError(err));
      setFacilitiesList({ warehouses: [], dark_stores: [], all_facilities: [] });
      return [];
    }
  }, [appMeta.targetApp]);

  // Validate a restored token against the real user list before trusting the session.
  useEffect(() => {
    let cancelled = false;
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      return;
    }
    const savedMode = localStorage.getItem(STORAGE_KEY_MODE);
    if (savedMode && savedMode !== appMeta.targetApp) {
      // Allow switching between apps if user has multi-app permissions, but don't force clear unless invalid
    }
    setLoading(true);
    const restoredFacility = readStorage(STORAGE_KEY_FACILITY, null);
    const facilityQuery = restoredFacility?.code
      ? `?facility_code=${encodeURIComponent(restoredFacility.code)}`
      : '';
    fetchApi(`/iam/auth/me${facilityQuery}`)
      .then((me) => {
        if (cancelled) return;
        if (me?.user) {
          const allowedApps = me.allowed_apps || [me.target_app];
          const fresh = normaliseUser(me.user, allowedApps);
          if (!fresh.is_super_admin && !allowedApps.includes(appMeta.targetApp)) {
            clearSession();
            setAppMismatch({ expected: appMeta, actualKey: Object.values(APPS).find(a => a.targetApp === me.target_app)?.key || null });
            return;
          }
          setUser(fresh);
          localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(fresh));
          if (me.facility) {
            setFacility(me.facility);
            localStorage.setItem(STORAGE_KEY_FACILITY, JSON.stringify(me.facility));
          }
        }
        loadFacilities();
      })
      .catch((err) => {
        if (cancelled) return;
        // Only the server's own authorization verdicts end the session. A
        // dropped connection or a 5xx must not sign the person out — the views
        // can retry the read on their own schedule.
        const status = err?.status;
        if (status === 401 || status === 403) clearSession();
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadFacilities, appMeta]);

  const applySession = (resp) => {
    const allowedApps = resp.allowed_apps || [resp.target_app];
    const loggedUser = normaliseUser(resp?.user, allowedApps);
    if (!loggedUser) {
      throw new Error('Login response did not include a user record.');
    }
    const isAllowedInThisApp = loggedUser.is_super_admin
      || allowedApps.includes(appMeta.targetApp)
      || resp?.capabilities?.workspace === appMeta.targetApp;

    if (!isAllowedInThisApp) {
      setAuthToken(null);
      setAppMismatch({
        expected: appMeta,
        actualKey: Object.values(APPS).find(a => a.targetApp === resp.target_app)?.key || null,
      });
      return { success: false, mismatch: true, targetApp: resp.target_app };
    }

    if (resp.token) setAuthToken(resp.token);
    if (resp.refresh_token) localStorage.setItem(STORAGE_KEY_REFRESH, resp.refresh_token);
    setUser(loggedUser);
    if (resp.facility) {
      setFacility(resp.facility);
      localStorage.setItem(STORAGE_KEY_FACILITY, JSON.stringify(resp.facility));
    }

    localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(loggedUser));
    localStorage.setItem(STORAGE_KEY_MODE, appMeta.targetApp);

    loadFacilities();

    if (resp.has_warning) {
      setRouteNotice({ type: 'warning', message: resp.route_reason });
    }
    return {
      success: true,
      targetApp: appMeta.targetApp,
      warning: !!resp.has_warning,
      reason: resp.route_reason,
    };
  };

  const challengeFrom = (body) => ({
    challengeId: body?.challenge_id,
    challengeToken: body?.challenge_token,
    facilities: body?.facilities || [],
    facility: body?.facility || null,
    otpSentTo: body?.otp_sent_to || null,
    attemptsRemaining: body?.attempts_remaining,
  });

  /**
   * Step 1: password. The server decides what comes next.
   *
   * - `facility_required` -> the caller shows a chooser of the returned sites.
   * - `otp_required`      -> the caller shows the one-time-code screen.
   * - `success`           -> rider/consumer products receive a token directly.
   */
  const login = async (email, password) => {
    // `loading` is the bootstrap flag that AuthGate uses to decide whether to
    // render the app shell. Setting it here unmounted <LoginView> mid-wizard,
    // which threw away the OTP/facility challenge and dropped the person back
    // on the password form. The wizard tracks its own `submitting` state.
    setRouteNotice(null);
    setAppMismatch(null);
    try {
      const resp = await postApi('/iam/auth/login', {
        email, password, app: appMeta.targetApp, surface: getLoginSurface(),
      });
      if (resp?.facility_required) {
        return { success: false, facilityRequired: true, ...challengeFrom(resp) };
      }
      if (resp?.otp_required) {
        return { success: false, otpRequired: true, ...challengeFrom(resp) };
      }
      return applySession(resp);
    } catch (err) {
      // A 403 with an OTP challenge in the body is a normal step, not a failure.
      if (err instanceof ApiError && err.status === 403 && err.body?.otp_required) {
        return { success: false, otpRequired: true, ...challengeFrom(err.body) };
      }
      throw err;
    }
  };

  /** Step 2 (multi-site only): choose one of the server-authorized sites. */
  const selectFacility = async (challengeId, challengeToken, facilityCode) => {
    const body = await postApi('/iam/auth/facility', {
      challenge_id: challengeId,
      challenge_token: challengeToken,
      facility_code: facilityCode,
    });
    return { success: false, otpRequired: true, ...challengeFrom(body) };
  };

  /** Step 3: verify the one-time code and receive a revocable session. */
  const verifyOtp = async (challengeId, challengeToken, otp) => {
    const resp = await postApi('/iam/auth/otp/verify', {
      challenge_id: challengeId,
      challenge_token: challengeToken,
      otp,
    });
    return applySession(resp);
  };

  /** Ask for a fresh code when the previous one expired. */
  const resendOtp = async (challengeId, challengeToken) => {
    const body = await postApi('/iam/auth/otp/resend', {
      challenge_id: challengeId,
      challenge_token: challengeToken,
    });
    return { ...challengeFrom(body), otpRequired: true };
  };

  const switchFacility = async (newFacility) => {
    if (!newFacility) return false;
    try {
      // The server re-derives the authorized set; a client-side list is not
      // trusted. A rejected switch leaves the current session facility intact.
      await postApi('/iam/auth/switch-facility', { facility_code: newFacility.code });
    } catch (err) {
      setRouteNotice({
        type: 'warning',
        message: describeError(err) || 'Access Denied: you are not assigned to that facility.',
      });
      return false;
    }
    setFacility(newFacility);
    localStorage.setItem(STORAGE_KEY_FACILITY, JSON.stringify(newFacility));
    setRouteNotice(null);
    return true;
  };

  const logout = () => {
    clearSession();
    setAppMismatch(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        facility,
        isDarkStore,
        appKey: appMeta.key,
        appMode,
        appMeta,
        appMismatch,
        appName: appMeta.name,
        appBrand: appMeta.brand,
        facilitiesList,
        loading,
        routeNotice,
        setRouteNotice,
        login,
        selectFacility,
        verifyOtp,
        resendOtp,
        logout,
        switchFacility,
        refreshFacilities: loadFacilities,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
