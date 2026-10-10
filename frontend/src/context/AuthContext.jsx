import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchApi, postApi, setAuthToken, getAuthToken, describeError } from '../api/client';
import { APP, APPS } from '../apps/registry';

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

// Which console this bundle renders is fixed at build time by the HTML entry
// point (src/apps/registry.js), not chosen at runtime. There is no longer an
// appMode state to switch: a rider bundle cannot render the shopper shell
// because those view modules are not in its chunk, and a shopper bundle cannot
// reach the store console for the same reason.
//
// DARK_STORE is a retired mode — the store screens are a section of the store
// app selected by which facility the operator has picked — so an older backend
// still answering target_app='DARK_STORE' is normalised to 'WMS'.
const RETIRED_MODES = { DARK_STORE: 'WMS' };

function normaliseMode(raw) {
  return RETIRED_MODES[raw] || raw || null;
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

export function AuthProvider({ appKey = APP.key, children }) {
  const appMeta = APPS[appKey] || APP;
  const [user, setUser] = useState(() => normaliseUser(readStorage(STORAGE_KEY_USER, null)));
  const [facility, setFacility] = useState(() => readStorage(STORAGE_KEY_FACILITY, null));
  // The console is the one this bundle was built as. It never changes.
  const appMode = appMeta.targetApp;
  // Set when a login answered with a target_app for a different application,
  // e.g. a rider account typed into the store app. The token is dropped and
  // the user is told which app their account belongs to.
  const [appMismatch, setAppMismatch] = useState(null);
  const [facilitiesList, setFacilitiesList] = useState({
    warehouses: [],
    dark_stores: [],
    all_facilities: [],
  });
  const [loading, setLoading] = useState(false);
  const [routeNotice, setRouteNotice] = useState(null);

  // Drop the in-memory session and everything persisted for it.
  const clearSession = () => {
    setAuthToken(null);
    setUser(null);
    setFacility(null);
    localStorage.removeItem(STORAGE_KEY_USER);
    localStorage.removeItem(STORAGE_KEY_FACILITY);
    localStorage.removeItem(STORAGE_KEY_MODE);
  };

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
    // The three web entries share one origin, so they share localStorage: a
    // token restored here may belong to a different application. Drop it and
    // send that user to their own entry point instead of rendering an empty
    // console.
    if (normaliseMode(localStorage.getItem(STORAGE_KEY_MODE)) !== appMeta.targetApp) {
      clearSession();
      setAppMismatch({ expected: appMeta, actualKey: normaliseMode(localStorage.getItem(STORAGE_KEY_MODE)) });
      return;
    }
    setLoading(true);
    fetchApi('/iam/users/')
      .then(() => { if (!cancelled) loadFacilities(); })
      .catch(() => {
        if (cancelled) return;
        // Token rejected by the backend: drop the stale session.
        clearSession();
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadFacilities, appMeta]);

  const login = async (email, password) => {
    setLoading(true);
    setRouteNotice(null);
    setAppMismatch(null);
    try {
      const resp = await postApi('/iam/auth/login', { email, password });
      const loggedUser = normaliseUser(resp?.user);
      if (!loggedUser) {
        throw new Error('Login response did not include a user record.');
      }
      const targetApp = normaliseMode(resp.target_app);

      // Wrong application: this account belongs to a different console. Drop
      // the token rather than mounting a shell the backend will refuse, and
      // tell the user which app to open.
      if (targetApp !== appMeta.targetApp) {
        setAuthToken(null);
        setAppMismatch({
          expected: appMeta,
          actualKey: Object.values(APPS).find(a => a.targetApp === targetApp)?.key || null,
        });
        return { success: false, mismatch: true, targetApp };
      }

      if (resp.token) setAuthToken(resp.token);
      setUser(loggedUser);
      setFacility(resp.facility || null);

      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(loggedUser));
      if (resp.facility) localStorage.setItem(STORAGE_KEY_FACILITY, JSON.stringify(resp.facility));
      localStorage.setItem(STORAGE_KEY_MODE, appMeta.targetApp);

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
    // Picking a dark store keeps the operator in the store console — the
    // sidebar just swaps to the store-ops sections — so it still needs the
    // same clearance as the warehouse branch above.
    if (newFacility.site_type === 'DS' && !user?.can_access_dark_store) {
      setRouteNotice({
        type: 'warning',
        message: `Access Denied for Dark Store ${newFacility.name || newFacility.code}.`,
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
