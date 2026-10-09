import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchApi, postApi, setAuthToken, getAuthToken, describeError } from '../api/client';

const AuthContext = createContext();

const STORAGE_KEY_USER = 'zippzo_auth_user';
const STORAGE_KEY_FACILITY = 'zippzo_auth_facility';
const STORAGE_KEY_MODE = 'zippzo_auth_app_mode';

// Roles the backend routes to the WMS console (see iam.views.LoginAPIView).
const WMS_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER', 'WAREHOUSE_STAFF'];
const ADMIN_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER'];

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// App mode is persisted as a bare string (not JSON), so it must not go through
// readStorage(): JSON.parse('DARK_STORE') throws and would silently reset the
// operator back into the WMS console on every reload.
//
// RIDER and SHOPPER are produced by target_app_for() in iam.views: without
// them in this list readAppMode() rejected the backend's answer and fell back
// to 'WMS', which is why the rider app could never be reached after login.
//
// DARK_STORE is deliberately absent: the dark store console is not a separate
// app, it is a section of the WMS shell selected by which facility the operator
// has picked (Sidebar reads facility.site_type). Anything still carrying the
// retired value — an old localStorage write, or a backend that still answers
// target_app='DARK_STORE' — is normalised back to 'WMS' rather than dropped to
// the login screen.
const APP_MODES = ['WMS', 'SHOPPER', 'RIDER'];
const RETIRED_MODES = { DARK_STORE: 'WMS' };

function normaliseMode(raw) {
  if (RETIRED_MODES[raw]) return RETIRED_MODES[raw];
  return APP_MODES.includes(raw) ? raw : 'WMS';
}

function readAppMode() {
  return normaliseMode(localStorage.getItem(STORAGE_KEY_MODE));
}

/**
 * Backend `user` is {user_id,email,full_name,role,status}.
 * Views render `name`/`avatar`/`is_admin`, so derive them here from the real
 * payload instead of inventing a different identity client-side.
 */
function normaliseUser(raw) {
  if (!raw) return null;
  const fullName = raw.full_name || raw.name || '';
  return {
    user_id: raw.user_id,
    email: raw.email || '',
    full_name: fullName,
    name: fullName || raw.email || 'Operator',
    role: raw.role || 'CUSTOMER',
    status: raw.status || 'ACTIVE',
    is_admin: ADMIN_ROLES.includes(raw.role),
    can_access_warehouse: WMS_ROLES.includes(raw.role),
    // The dark store screens live inside the WMS shell, but they expose bin
    // locations, shelf counts and pick queues, so they are limited to the same
    // WMS roles that reach the warehouse console. Customers/riders were
    // previously given `true` here, which let any signed-in shopper walk into
    // the store screens through switchFacility().
    can_access_dark_store: WMS_ROLES.includes(raw.role),
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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => normaliseUser(readStorage(STORAGE_KEY_USER, null)));
  const [facility, setFacility] = useState(() => readStorage(STORAGE_KEY_FACILITY, null));
  const [appMode, setAppMode] = useState(readAppMode);
  const [facilitiesList, setFacilitiesList] = useState({
    warehouses: [],
    dark_stores: [],
    all_facilities: [],
  });
  const [loading, setLoading] = useState(false);
  const [routeNotice, setRouteNotice] = useState(null);

  // Whether the selected facility is a dark store drives the sidebar sections.
  // The facility object that arrives in the login payload does not always carry
  // site_type, so fall back to the directory loaded from /network/overview.
  const isDarkStore = facility?.site_type
    ? facility.site_type === 'DS'
    : (facilitiesList.all_facilities || []).find(s => s.code === facility?.code)?.site_type === 'DS';

  // Real sites only — no built-in fallback list.
  //
  // /network/sites/ is admin-only, so every DARK_STORE operator (CUSTOMER,
  // RIDER) got a 403 here, leaving the facility list empty and the dark store
  // console permanently stuck on "Loading the site directory...".
  // /network/overview is the authenticated-but-not-admin facility directory,
  // and it is the one that returns the real dark store list.
  const loadFacilities = useCallback(async () => {
    try {
      const res = await fetchApi('/network/overview');
      // all_facilities already carries site_type. The per-bucket lists are
      // only a fallback, and switchFacility() keys the app mode off
      // site_type, so stamp it on if the bucket came without it.
      const list = Array.isArray(res?.all_facilities)
        ? res.all_facilities
        : [
            ...(res?.warehouses ?? []).map(s => ({ ...s, site_type: 'MH' })),
            ...(res?.dark_stores ?? []).map(s => ({ ...s, site_type: 'DS' })),
          ];
      setFacilitiesList(splitSites(list));
      return list;
    } catch (err) {
      console.error('Could not load sites from backend:', describeError(err));
      setFacilitiesList({ warehouses: [], dark_stores: [], all_facilities: [] });
      return [];
    }
  }, []);

  // Validate a restored token against the real user list before trusting the session.
  useEffect(() => {
    let cancelled = false;
    const token = getAuthToken();
    if (!token) {
      setUser(null);
      return;
    }
    setLoading(true);
    fetchApi('/iam/users/')
      .then(() => { if (!cancelled) loadFacilities(); })
      .catch(() => {
        if (cancelled) return;
        // Token rejected by the backend: drop the stale session.
        setAuthToken(null);
        setUser(null);
        setFacility(null);
        localStorage.removeItem(STORAGE_KEY_USER);
        localStorage.removeItem(STORAGE_KEY_FACILITY);
        localStorage.removeItem(STORAGE_KEY_MODE);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadFacilities]);

  const login = async (email, password) => {
    setLoading(true);
    setRouteNotice(null);
    try {
      const resp = await postApi('/iam/auth/login', { email, password });
      const loggedUser = normaliseUser(resp?.user);
      if (!loggedUser) {
        throw new Error('Login response did not include a user record.');
      }
      const targetApp = normaliseMode(resp.target_app);

      if (resp.token) setAuthToken(resp.token);
      setUser(loggedUser);
      setAppMode(targetApp);
      setFacility(resp.facility || null);

      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(loggedUser));
      if (resp.facility) localStorage.setItem(STORAGE_KEY_FACILITY, JSON.stringify(resp.facility));
      localStorage.setItem(STORAGE_KEY_MODE, targetApp);

      loadFacilities();

      if (resp.has_warning) {
        setRouteNotice({ type: 'warning', message: resp.route_reason });
      }
      return { success: true, targetApp, warning: !!resp.has_warning, reason: resp.route_reason };
    } finally {
      setLoading(false);
    }
  };

  const switchFacility = (newFacility) => {
    if (!newFacility) return;
    if (newFacility.site_type === 'MH' && !user?.can_access_warehouse) {
      setRouteNotice({
        type: 'warning',
        message: `Access Denied for Warehouse ${newFacility.name || newFacility.code}.`,
      });
      return false;
    }
    // Picking a dark store keeps the operator in the WMS shell — the sidebar
    // just swaps to the store-ops sections — so it still needs the same
    // clearance as the warehouse branch above.
    if (newFacility.site_type === 'DS' && !user?.can_access_dark_store) {
      setRouteNotice({
        type: 'warning',
        message: `Access Denied for Dark Store ${newFacility.name || newFacility.code}.`,
      });
      return false;
    }
    setFacility(newFacility);
    localStorage.setItem(STORAGE_KEY_FACILITY, JSON.stringify(newFacility));
    // Facility drives which menu sections render, not which app is mounted.
    // Anything that is not a shopper or a rider console belongs to the WMS shell.
    if (appMode !== 'SHOPPER' && appMode !== 'RIDER') {
      setAppMode('WMS');
      localStorage.setItem(STORAGE_KEY_MODE, 'WMS');
    }
    setRouteNotice(null);
    return true;
  };

  const switchAppMode = (mode) => {
    if (mode === 'WMS' && !user?.can_access_warehouse) {
      setRouteNotice({
        type: 'warning',
        message: 'Your account does not have clearance for WMS Central Hub.',
      });
      return false;
    }
    setAppMode(mode);
    localStorage.setItem(STORAGE_KEY_MODE, mode);
    return true;
  };

  const logout = () => {
    setAuthToken(null);
    setUser(null);
    setFacility(null);
    setAppMode('WMS');
    setRouteNotice(null);
    localStorage.removeItem(STORAGE_KEY_USER);
    localStorage.removeItem(STORAGE_KEY_FACILITY);
    localStorage.removeItem(STORAGE_KEY_MODE);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        facility,
        isDarkStore,
        appMode,
        facilitiesList,
        loading,
        routeNotice,
        setRouteNotice,
        login,
        logout,
        switchFacility,
        switchAppMode,
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
