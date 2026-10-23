import React from 'react';
import { Store, AlertTriangle } from 'lucide-react';
import { useDarkStore } from './useDarkStore';

/**
 * Every dark store screen is scoped to one site, and a screen with no site
 * cannot show anything real. Rather than letting each screen render an empty
 * queue (which an operator reads as "the store is idle"), they all gate on this:
 * it either names the store, offers a picker, or states exactly what is missing.
 */
export default function StoreGate({ children }) {
  const { site, darkStores, reason, canPick, pick } = useDarkStore();

  if (site) {
    return (
      <>
        {children}
      </>
    );
  }

  return (
    <div className="wf-panel" data-testid="ds-store-gate">
      <div className="wf-empty">
        {canPick ? (
          <Store size={40} className="wf-empty__icon" />
        ) : (
          <AlertTriangle size={40} className="wf-empty__icon" />
        )}
        <div className="wf-empty__title">
          {canPick ? 'Choose a dark store' : 'No dark store available'}
        </div>
        <div className="wf-empty__text" data-testid="ds-store-gate-reason">
          {reason}
        </div>
      </div>

      {canPick && (
        <div className="form-group">
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th style={{ width: 120 }}>Action</th>
                </tr>
              </thead>
              <tbody data-testid="ds-store-options">
                {darkStores.map((s) => (
                  <tr key={s.site_id}>
                    <td>{s.name || s.code}</td>
                    <td className="mono-num">{s.code}</td>
                    <td>{s.status || 'UNKNOWN'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary"
                        data-testid={`ds-store-option-${s.code}`}
                        onClick={() => pick(s)}
                      >
                        <Store size={14} /> Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/** Site badge shown in the panel header so the operator is never guessing. */
export function StoreBadge() {
  const { storeCode, storeName } = useDarkStore();
  if (!storeCode) return null;
  return (
    <span data-testid="ds-store-badge">
      {storeCode}{storeName && storeName !== storeCode ? ` · ${storeName}` : ''}
    </span>
  );
}
