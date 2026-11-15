import React from 'react';
import { Menu, LogOut, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/**
 * Top app header — hamburger | breadcrumb context | user + logout
 * Design: dark surface, Zepto WMS production style
 */
export default function Header({ onToggleSidebar }) {
  const { user, facility, logout, facilitiesList, switchFacility, appKey } = useAuth();

  const isStoreConsole =
    appKey === 'store' || appKey === 'wms' || appKey === 'darkstore';

  const sites = facilitiesList?.all_facilities || [];

  const canSee = (s) => {
    if (user?.is_super_admin) return true;
    if (appKey === 'darkstore') return s.site_type === 'DS';
    return true;
  };

  const visibleSites = sites.filter(canSee);
  const darkStores = visibleSites.filter((s) => s.site_type === 'DS');
  const warehouses = visibleSites.filter((s) => s.site_type !== 'DS');
  const currentCode = facility?.code || '';
  const currentInList =
    !!currentCode && visibleSites.some((s) => s.code === currentCode);
  const canSwitchFacility = user?.is_super_admin || visibleSites.length > 1;

  /* Build the breadcrumb string from facility data */
  const networkCode = facility?.network_code || 'MH_FWCG';
  const hubCode = facility?.code || 'HYD080M';
  const hubName = facility?.name
    ? facility.name.toUpperCase()
    : 'HYD DRY MH2 · KANDLAKOYA';

  return (
    <header className="header">
      {/* Left: hamburger */}
      <div className="header-left">
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleSidebar}
          title="Toggle Sidebar"
          aria-label="Toggle sidebar"
        >
          <Menu size={15} />
        </button>
      </div>

      {/* Center: facility breadcrumb context */}
      {isStoreConsole && (
        <div className="header-breadcrumb" aria-label="Facility context">
          {canSwitchFacility ? (
            <select
              data-testid="facility-switcher"
              aria-label="Switch facility"
              className="facility-select"
              value={currentInList ? currentCode : ''}
              onChange={(e) => {
                const site = visibleSites.find((s) => s.code === e.target.value);
                if (site) switchFacility(site);
              }}
            >
              {!currentInList && (
                <option value="" disabled>
                  {currentCode || 'Select site'}
                </option>
              )}
              {darkStores.length > 0 && (
                <optgroup label="Dark stores">
                  {darkStores.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name || s.code}
                    </option>
                  ))}
                </optgroup>
              )}
              {warehouses.length > 0 && (
                <optgroup label="Warehouses & hubs">
                  {warehouses.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name || s.code}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          ) : (
            <span className="breadcrumb-text">
              <span className="breadcrumb-seg">{networkCode}</span>
              <ChevronRight size={11} className="breadcrumb-sep" />
              <span className="breadcrumb-seg">{hubCode}</span>
              <ChevronRight size={11} className="breadcrumb-sep" />
              <span className="breadcrumb-seg breadcrumb-seg--active">{hubName}</span>
            </span>
          )}
        </div>
      )}

      {/* Right: user chip + logout */}
      <div className="header-right">
        <div className="user-chip">
          <span className="user-chip__avatar">{user?.avatar || (user?.name?.[0] || 'Z')}</span>
          <span className="user-chip__name">{user?.name || user?.email || '—'}</span>
          <span className="user-chip__role">{user?.role || ''}</span>
        </div>

        <button
          type="button"
          className="logout-btn"
          onClick={logout}
          title="Logout"
          aria-label="Logout"
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
