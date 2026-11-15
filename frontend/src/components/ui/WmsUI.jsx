import React from 'react';
import { Search } from 'lucide-react';

/**
 * Small page-level primitives that mirror the reference WMS:
 *   PageHead  — uppercase screen title + record-count chip + right actions
 *   SubTabs   — bordered pill rail with optional counts
 *   FilterBar — "Filter table rows…" + "Showing N of N records"
 *
 * They exist so operational screens stop inventing their own header markup.
 */

export function PageHead({ title, count, countLabel = 'records', subtitle, actions }) {
  return (
    <div className="screen-header">
      <div style={{ minWidth: 0 }}>
        <div className="screen-title">
          <span>{title}</span>
          {count != null && (
            <span className="screen-count-tag">
              {count} {countLabel}
            </span>
          )}
        </div>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="screen-actions">{actions}</div>}
    </div>
  );
}

export function SubTabs({ tabs = [], active, onChange, search, onSearch, searchPlaceholder = 'Filter records...' }) {
  return (
    <div className="subtabs-rail">
      <div className="subtabs-list">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`subtab-btn ${active === tab.id ? 'active' : ''}`}
            onClick={() => onChange?.(tab.id)}
          >
            {tab.label}
            {tab.count != null && <span style={{ opacity: 0.75 }}>({tab.count})</span>}
          </button>
        ))}
      </div>

      {onSearch && (
        <div className="subtabs-search">
          <input
            type="text"
            value={search ?? ''}
            onChange={e => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <Search size={12} />
        </div>
      )}
    </div>
  );
}

export function FilterBar({ value, onChange, shown, total, placeholder = 'Filter table rows...', children }) {
  return (
    <div className="wms-filterbar">
      <div className="wms-filterbar__left">
        <input
          type="text"
          value={value}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          aria-label="Filter table rows"
        />
        {children}
      </div>
      <div className="wms-shown">
        Showing <b>{shown ?? total ?? 0}</b> of <b>{total ?? 0}</b> records
      </div>
    </div>
  );
}

export default { PageHead, SubTabs, FilterBar };
