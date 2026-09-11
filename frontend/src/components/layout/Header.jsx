import React from 'react';
import { Menu, User, Building2, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Header({ onToggleSidebar }) {
  const { user, logout } = useAuth();

  return (
    <header className="facility-bar">
      <div className="facility-bar-left">
        <button
          onClick={onToggleSidebar}
          className="btn-ui neutral"
          style={{ padding: '5px 8px', border: '1px solid var(--border-subtle)' }}
          title="Toggle Navigation"
        >
          <Menu size={15} />
        </button>

        {/* Zepto Facility Location Pill */}
        <div className="facility-pill">
          <Building2 size={13} style={{ color: 'var(--c-amber)' }} />
          <span>MH_FMCG | HYD080M - HYD-DRY-MH2-KANDLAKOYA</span>
        </div>
      </div>

      <div className="facility-bar-right">
        {/* User Info */}
        {user && (
          <div
            className="btn-ui neutral"
            style={{ fontSize: 11, cursor: 'default', display: 'flex', alignItems: 'center', gap: 6 }}
            title={`Logged in as ${user.email}`}
          >
            <User size={13} />
            <span>{user.name || user.email}</span>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          className="btn-ui neutral"
          title="Sign out"
          style={{ color: 'var(--c-rust)' }}
        >
          <LogOut size={13} />
        </button>
      </div>
    </header>
  );
}
