import React, { useState } from 'react';
import { Menu, User, Building2, LogOut, Download } from 'lucide-react';
import ExportModal from '../ui/ExportModal';

export default function Header({ user, logout, onToggleSidebar, facilityLabel, appKey = 'wms' }) {
  const [exportOpen, setExportOpen] = useState(false);
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
          <span>{facilityLabel || 'WMS | Select facility'}</span>
        </div>
      </div>

      <div className="facility-bar-right">
        {/* Export */}
        <button
          type="button"
          className="btn-ui neutral"
          onClick={() => setExportOpen(true)}
          title="Export data to Excel"
        >
          <Download size={13} />
          <span>Export</span>
        </button>
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
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} appKey={appKey} />
    </header>
  );
}
