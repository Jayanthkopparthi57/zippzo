import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchApi, postApi, patchApi, describeError, unwrapList } from '../api/client';
import DataTable from '../components/ui/DataTable';
import DeliveryAreasPanel from './admin/DeliveryAreasPanel';
import RiderAdminPanel from './admin/RiderAdminPanel';
import ManpowerPanel, { monthlyCost } from './admin/ManpowerPanel';
import {
  ShieldCheck, Building2, Users, X, Pencil, Ban, RotateCcw, Wallet, IndianRupee,
  MapPin, Bike, Clock,
} from 'lucide-react';

const COMP_BASIS = ['MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY', 'PER_TASK'];

function blankCompForm() {
  return {
    user: '', site: '', basis: 'MONTHLY', amount: '',
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: '', notes: '',
  };
}

export default function AdminSettingsView() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [stores, setStores] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('employees');

  useEffect(() => {
    let cancelled = false;
    loadData(() => cancelled);
    return () => { cancelled = true; };
  }, [activeTab]);

  const loadData = async (isCancelled = () => false) => {
    setLoading(true);
    try {
      // Every panel needs the store list and the people list, so they load
      // once per tab switch instead of being re-fetched by each panel. The
      // tab's own data rides along in the same round trip: publishing the
      // stores before their pricing rules arrive would let a save fire
      // against a rule the panel has not seen yet.
      const [usersRes, sitesRes, tabRes] = await Promise.all([
        fetchApi('/iam/users/').catch(() => []),
        fetchApi('/network/sites/'),
        activeTab === 'compensation'
          ? fetchApi('/network/payroll/?page_size=500')
          : activeTab === 'pricing'
            ? fetchApi('/money/pricing-rules/?page_size=500')
            : Promise.resolve(null),
      ]);
      if (isCancelled()) return;
      setEmployees(Array.isArray(usersRes) ? usersRes : []);
      setStores(Array.isArray(sitesRes) ? sitesRes : []);
      if (activeTab === 'compensation') {
        setPayroll(unwrapList(tabRes) || []);
      } else if (activeTab === 'pricing') {
        setPricing(unwrapList(tabRes) || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  // iam.User ROLE_CHOICES
  const USER_ROLES = ['SUPER_ADMIN', 'OPS_MANAGER', 'WAREHOUSE_STAFF', 'RIDER', 'CUSTOMER', 'SENDER'];

  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showStoreModal, setShowStoreModal] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({ full_name: '', email: '', role: 'WAREHOUSE_STAFF', password: '' });
  const [storeForm, setStoreForm] = useState({ code: '', name: '', site_type: 'DS', address: '' });

  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({ full_name: '', role: 'WAREHOUSE_STAFF', status: 'ACTIVE', password: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [tableError, setTableError] = useState('');

  const [showCompModal, setShowCompModal] = useState(false);
  const [compForm, setCompForm] = useState(blankCompForm);
  const [compError, setCompError] = useState('');

  // Delivery pricing: one fee per dark store, edited straight on the row.
  const [pricing, setPricing] = useState([]);
  const [feeDrafts, setFeeDrafts] = useState({});
  const [freeDrafts, setFreeDrafts] = useState({});
  const [pricingError, setPricingError] = useState('');
  const [savingFeeSite, setSavingFeeSite] = useState('');
  const [storeError, setStoreError] = useState('');
  const [storeBusy, setStoreBusy] = useState('');

  const openEdit = (row) => {
    setEditingUser(row);
    setEditForm({ full_name: row.full_name || '', role: row.role, status: row.status, password: '' });
    setEditError('');
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    if (!editForm.full_name.trim()) {
      setEditError('Full name is required.');
      return;
    }
    setSavingEdit(true);
    setEditError('');
    try {
      const payload = {
        full_name: editForm.full_name.trim(),
        role: editForm.role,
        status: editForm.status,
      };
      if (editForm.password) payload.password = editForm.password;
      await patchApi(`/iam/users/${editingUser.user_id}/`, payload);
      setEditingUser(null);
      await loadData();
    } catch (e) {
      setEditError(describeError(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleBlock = async (row) => {
    const next = row.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    if (next === 'BLOCKED' && row.user_id === user?.user_id) {
      setTableError('You cannot block your own account.');
      return;
    }
    setTableError('');
    try {
      await patchApi(`/iam/users/${row.user_id}/`, { status: next });
      await loadData();
    } catch (e) {
      setTableError(describeError(e));
    }
  };

  const saveFee = async (site) => {
    const rule = pricing.find((r) => String(r.site) === String(site.site_id));
    const raw = String(feeDrafts[site.site_id] ?? (rule ? rule.base_fee : '20')).trim();
    const fee = Number(raw);
    if (!raw || Number.isNaN(fee) || fee < 0 || fee > 1000) {
      setPricingError('A delivery fee is a number between ₹0 and ₹1000.');
      return;
    }
    const rawFree = String(freeDrafts[site.site_id] ?? (rule ? rule.free_above : '0')).trim();
    const freeAbove = rawFree === '' ? 0 : Number(rawFree);
    if (Number.isNaN(freeAbove) || freeAbove < 0 || (freeAbove > 0 && freeAbove < 50)) {
      setPricingError('Free-delivery threshold is ₹0 (never free) or at least ₹50.');
      return;
    }
    setPricingError('');
    setSavingFeeSite(site.site_id);
    try {
      const payload = {
        base_fee: fee.toFixed(2),
        free_above: freeAbove.toFixed(2),
      };
      if (rule) {
        await patchApi(`/money/pricing-rules/${rule.rule_id}/`, payload);
      } else {
        await postApi('/money/pricing-rules/', { site: site.site_id, ...payload });
      }
      setFeeDrafts((p) => {
        const next = { ...p };
        delete next[site.site_id];
        return next;
      });
      setFreeDrafts((p) => {
        const next = { ...p };
        delete next[site.site_id];
        return next;
      });
      await loadData();
    } catch (e) {
      setPricingError(describeError(e));
    } finally {
      setSavingFeeSite('');
    }
  };

  const toggleSiteSelling = async (site) => {
    setStoreBusy(site.site_id);
    setStoreError('');
    try {
      await patchApi(`/network/sites/${site.site_id}/`,
        { is_accepting_orders: !site.is_accepting_orders });
      await loadData();
    } catch (e) {
      setStoreError(describeError(e));
    } finally {
      setStoreBusy('');
    }
  };

  const handleAddEmployee = async () => {
    if (!user?.is_admin) {
      setModalError('Only administrators can create users.');
      setShowEmployeeModal(true);
      return;
    }
    if (!employeeForm.full_name.trim() || !employeeForm.email.trim() || !employeeForm.password) {
      setModalError('Name, email and password are all required.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      await postApi('/iam/users/', {
        full_name: employeeForm.full_name.trim(),
        email: employeeForm.email.trim(),
        role: employeeForm.role,
        status: 'ACTIVE',
        password: employeeForm.password,
      });
      setShowEmployeeModal(false);
      setEmployeeForm({ full_name: '', email: '', role: 'WAREHOUSE_STAFF', password: '' });
      await loadData();
    } catch (e) {
      setModalError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleAddStore = async () => {
    if (!user?.is_admin) {
      setModalError('Only administrators can register sites.');
      setShowStoreModal(true);
      return;
    }
    if (!storeForm.code.trim() || !storeForm.name.trim()) {
      setModalError('Site code and name are required.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      await postApi('/network/sites/', {
        code: storeForm.code.trim().toUpperCase(),
        name: storeForm.name.trim(),
        site_type: storeForm.site_type,
        address: storeForm.address.trim(),
      });
      setShowStoreModal(false);
      setStoreForm({ code: '', name: '', site_type: 'DS', address: '' });
      await loadData();
    } catch (e) {
      setModalError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleAddComp = async () => {
    if (!compForm.user || !compForm.site || !compForm.amount || !compForm.effective_from) {
      setCompError('Person, site, amount and start date are all required.');
      return;
    }
    if (Number(compForm.amount) <= 0) {
      setCompError('Amount must be greater than zero.');
      return;
    }
    setSaving(true);
    setCompError('');
    try {
      const payload = {
        user: compForm.user,
        site: compForm.site,
        basis: compForm.basis,
        amount: compForm.amount,
        effective_from: compForm.effective_from,
      };
      if (compForm.effective_to) payload.effective_to = compForm.effective_to;
      if (compForm.notes.trim()) payload.notes = compForm.notes.trim();
      await postApi('/network/payroll/', payload);
      setShowCompModal(false);
      setCompForm(blankCompForm());
      await loadData();
    } catch (e) {
      setCompError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!user?.is_admin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>
        <ShieldCheck size={48} style={{ margin: '0 auto 16px' }} />
        <h2>Access Denied</h2>
        <p>You must be an Administrator to view this page.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <ShieldCheck size={28} color="#7c3aed" />
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: '#1e293b' }}>Admin & System Configuration</h1>
          <p style={{ margin: 0, color: '#64748b' }}>Manage system users, roles, and facilities across the network.</p>
        </div>
        {loading && (
          <span data-testid="admin-loading" style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
            Loading…
          </span>
        )}
      </div>

      <div className="subtabs-bar" style={{ marginBottom: 24, flexWrap: 'wrap' }}>
        <button className={`subtab-btn ${activeTab === 'employees' ? 'active' : ''}`}
          data-testid="admin-tab-employees" onClick={() => setActiveTab('employees')}>
          <Users size={16} /> Employees & Roles
        </button>
        <button className={`subtab-btn ${activeTab === 'stores' ? 'active' : ''}`}
          data-testid="admin-tab-stores" onClick={() => setActiveTab('stores')}>
          <Building2 size={16} /> Dark Stores
        </button>
        <button className={`subtab-btn ${activeTab === 'areas' ? 'active' : ''}`}
          data-testid="admin-tab-areas" onClick={() => setActiveTab('areas')}>
          <MapPin size={16} /> Delivery Areas
        </button>
        <button className={`subtab-btn ${activeTab === 'pricing' ? 'active' : ''}`}
          data-testid="admin-tab-pricing" onClick={() => setActiveTab('pricing')}>
          <IndianRupee size={16} /> Pricing
        </button>
        <button className={`subtab-btn ${activeTab === 'compensation' ? 'active' : ''}`}
          data-testid="admin-tab-compensation" onClick={() => setActiveTab('compensation')}>
          <Wallet size={16} /> Compensation
        </button>
        <button className={`subtab-btn ${activeTab === 'manpower' ? 'active' : ''}`}
          data-testid="admin-tab-manpower" onClick={() => setActiveTab('manpower')}>
          <Clock size={16} /> Manpower
        </button>
        <button className={`subtab-btn ${activeTab === 'riders' ? 'active' : ''}`}
          data-testid="admin-tab-riders" onClick={() => setActiveTab('riders')}>
          <Bike size={16} /> Riders
        </button>
      </div>

      {activeTab === 'employees' && (
        <>
          {tableError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
              padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12, fontWeight: 600,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{tableError}</span>
              <button className="modal-close" style={{ border: 'none' }} onClick={() => setTableError('')}>
                <X size={14} />
              </button>
            </div>
          )}
        <DataTable
          title="System Users & Employees"
          subtitle="Manage warehouse associates, pickers, riders, and administrators."
          onAdd={() => { setModalError(''); setShowEmployeeModal(true); }}
          addLabel="Create User"
          searchPlaceholder="Search name, email, role..."
          columns={[
            { header: 'User ID', key: 'user_id', render: r => (
              <span className="code-cell" style={{ fontSize: 10 }}>{String(r.user_id).slice(0, 8)}</span>
            )},
            { header: 'Name', key: 'full_name', render: r => <strong>{r.full_name || '—'}</strong> },
            { header: 'Email', key: 'email' },
            { header: 'Phone', key: 'phone', render: r => r.phone || '—' },
            { header: 'System Role', key: 'role', render: r => (
              <span className={`badge ${r.role === 'SUPER_ADMIN' ? 'badge-purple' : r.role === 'OPS_MANAGER' ? 'badge-info' : 'badge-default'}`}>
                {r.role}
              </span>
            )},
            { header: 'Status', key: 'status', render: r => (
              <span className={`badge ${r.status === 'ACTIVE' ? 'badge-success' : r.status === 'BLOCKED' ? 'badge-danger' : 'badge-warning'}`}>
                {r.status}
              </span>
            )},
            { header: 'Last Login', key: 'last_login_at', render: r => r.last_login_at
              ? <span style={{ fontSize: 11, color: '#64748b' }}>{new Date(r.last_login_at).toLocaleString()}</span>
              : <span style={{ color: '#94a3b8' }}>Never</span> },
            { header: 'Actions', key: 'actions', render: r => (
              <span style={{ display: 'inline-flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                <button className="btn-secondary" title="Edit user"
                  data-testid={`user-edit-${String(r.user_id).slice(0, 8)}`}
                  style={{ height: 26, padding: '0 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  onClick={() => openEdit(r)}>
                  <Pencil size={12} /> Edit
                </button>
                <button className="btn-secondary"
                  title={r.status === 'BLOCKED' ? 'Reactivate account' : 'Block account'}
                  data-testid={`user-toggle-${String(r.user_id).slice(0, 8)}`}
                  style={{ height: 26, padding: '0 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4,
                    color: r.status === 'BLOCKED' ? '#15803d' : '#b91c1c',
                    borderColor: r.status === 'BLOCKED' ? '#bbf7d0' : '#fecaca' }}
                  disabled={r.user_id === user?.user_id}
                  onClick={() => toggleBlock(r)}>
                  {r.status === 'BLOCKED' ? <RotateCcw size={12} /> : <Ban size={12} />}
                  {r.status === 'BLOCKED' ? 'Reactivate' : 'Block'}
                </button>
              </span>
            )},
          ]}
          data={employees}
        />
        </>
      )}

      {activeTab === 'stores' && (
        <>
          {storeError && (
            <div className="scan-feedback scan-feedback--error" data-testid="store-error"
              style={{ marginBottom: 12 }}>{storeError}</div>
          )}
          <DataTable
            title="Facility Registry"
            subtitle="Manage Mother Hubs and localized Dark Stores, including whether a store is taking orders."
            onAdd={() => { setModalError(''); setShowStoreModal(true); }}
            addLabel="Register New Site"
            searchPlaceholder="Search site code, name, address..."
            columns={[
              { header: 'Site Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
              { header: 'Name', key: 'name', render: r => <strong>{r.name}</strong> },
              { header: 'Type', key: 'site_type', render: r => (
                <span className={`badge ${r.site_type === 'MH' ? 'badge-info' : 'badge-purple'}`}>{r.site_type}</span>
              )},
              { header: 'Parent Site', key: 'parent_site', render: r => r.parent_site || '—' },
              { header: 'Address', key: 'address', render: r => r.address || '—' },
              { header: 'Accepting orders', key: 'is_accepting_orders', render: r => (
                <span onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn-secondary"
                    data-testid={`site-accepting-${r.code}`}
                    disabled={storeBusy === r.site_id}
                    onClick={() => toggleSiteSelling(r)}
                    title={r.is_accepting_orders ? 'Stop taking new orders' : 'Open the store for orders'}
                    style={{ height: 26, padding: '0 8px', fontSize: 11 }}
                  >
                    <span className={`badge ${r.is_accepting_orders ? 'badge-success' : 'badge-danger'}`}>
                      {r.is_accepting_orders ? 'OPEN' : 'CLOSED'}
                    </span>
                  </button>
                </span>
              )},
              { header: 'Geo', key: 'geo_lat', render: r => r.geo_lat && r.geo_lng
                ? <span style={{ fontSize: 11 }}>{r.geo_lat}, {r.geo_lng}</span>
                : '—' },
            ]}
            data={stores}
          />
        </>
      )}

      {activeTab === 'areas' && <DeliveryAreasPanel stores={stores} />}

      {activeTab === 'manpower' && (
        <ManpowerPanel sites={stores} employees={employees} />
      )}

      {activeTab === 'riders' && <RiderAdminPanel sites={stores} />}

      {activeTab === 'compensation' && (
        <div data-testid="emp-payroll-table">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            {(() => {
              const active = payroll.filter((r) => r.is_active);
              const monthly = active.reduce((sum, r) => sum + monthlyCost(r), 0);
              const people = new Set(active.map((r) => r.user || r.employee)).size;
              return [
                { label: 'Active rates', value: active.length, testid: 'pay-stat-rates' },
                { label: 'People priced', value: people, testid: 'pay-stat-people' },
                {
                  label: 'Committed / month',
                  value: `₹${Math.round(monthly).toLocaleString('en-IN')}`,
                  testid: 'pay-stat-monthly',
                },
              ].map((c) => (
                <div key={c.label} className="panel" style={{ padding: '12px 16px', minWidth: 160 }}>
                  <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800 }} data-testid={c.testid}>{c.value}</div>
                </div>
              ));
            })()}
          </div>
          <DataTable
            title="Compensation"
            subtitle="Pay rates per person and site — payroll reference data, admin-managed."
            onAdd={() => { setCompError(''); setShowCompModal(true); }}
            addLabel="Add Rate"
            searchPlaceholder="Search person, employee code, site..."
            columns={[
              { header: 'Person', key: 'user_name', render: r => (
                <strong>{r.user_name || r.user_email || r.employee}</strong>
              )},
              { header: 'Email', key: 'user_email', render: r => r.user_email || <span style={{ color: '#94a3b8' }}>—</span> },
              { header: 'Employee', key: 'employee', render: r => (
                r.employee ? <span className="code-cell">{r.employee}</span> : <span style={{ color: '#94a3b8' }}>—</span>
              )},
              { header: 'Site', key: 'site_code', render: r => <span className="code-cell">{r.site_code}</span> },
              { header: 'Basis', key: 'basis', render: r => (
                <span className="badge badge-info">{r.basis}</span>
              )},
              { header: 'Amount', key: 'amount', render: r => (
                <strong>₹{Number(r.amount).toLocaleString('en-IN')}
                  <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>{r.currency}</span>
                </strong>
              )},
              { header: 'Effective', key: 'effective_from', render: r => (
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  {r.effective_from} → {r.effective_to || 'open'}
                </span>
              )},
              { header: 'Status', key: 'is_active', render: r => (
                <span className={`badge ${r.is_active ? 'badge-success' : 'badge-default'}`}>
                  {r.is_active ? 'ACTIVE' : 'ENDED'}
                </span>
              )},
              { header: 'Rate set by', key: 'created_by', render: r => {
                if (!r.created_by) return <span style={{ color: '#94a3b8' }}>—</span>;
                const by = employees.find((e) => String(e.user_id) === String(r.created_by));
                return <span style={{ fontSize: 11 }}>{by ? (by.full_name || by.email) : String(r.created_by).slice(0, 8)}</span>;
              }},
            ]}
            data={payroll}
          />
        </div>
      )}

      {activeTab === 'pricing' && (
        <div data-testid="pricing-table" className="panel" style={{ padding: 16 }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 800 }}>Delivery pricing</h2>
          <p style={{ margin: '0 0 14px', color: '#64748b', fontSize: 12 }}>
            What each dark store charges for delivery. A store with no rule of its own
            charges the flat default — <strong>₹20</strong> — so checkout is never blocked
            on configuration nobody has done yet. Orders already placed keep the fee they
            were charged.
          </p>
          {pricingError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
              padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12, fontWeight: 600 }}
              data-testid="pricing-error">
              {pricingError}
            </div>
          )}
          <table className="data-table">
            <thead>
              <tr>
                <th>Store</th><th>Name</th><th>Current</th><th>Fee (₹)</th>
                <th>Free above (₹)</th><th></th>
              </tr>
            </thead>
            <tbody>
              {stores
                .filter((s) => s.site_type === 'DS' || s.site_type === 'DARK_STORE')
                .map((s) => {
                  const rule = pricing.find((r) => String(r.site) === String(s.site_id));
                  const current = rule
                    ? `₹${rule.base_fee}${Number(rule.free_above) > 0
                      ? ` · free above ₹${rule.free_above}` : ''}${rule.is_active ? '' : ' (inactive)'}`
                    : 'default (₹20, never free)';
                  const value = feeDrafts[s.site_id] ?? (rule ? String(rule.base_fee) : '20');
                  const freeValue = freeDrafts[s.site_id]
                    ?? (rule ? String(rule.free_above ?? '0') : '0');
                  return (
                    <tr key={s.site_id} data-testid={`pricing-row-${s.code}`}>
                      <td><span className="code-cell">{s.code}</span></td>
                      <td>{s.name || '—'}</td>
                      <td data-testid={`pricing-current-${s.code}`}>{current}</td>
                      <td>
                        <input type="number" min="0" max="1000" step="0.01" className="form-input"
                          style={{ width: 100, height: 30, fontSize: 12 }}
                          value={value}
                          onChange={(e) => setFeeDrafts((p) => ({ ...p, [s.site_id]: e.target.value }))}
                          data-testid={`pricing-fee-${s.code}`} />
                      </td>
                      <td>
                        <input type="number" min="0" step="0.01" className="form-input"
                          style={{ width: 120, height: 30, fontSize: 12 }}
                          value={freeValue}
                          placeholder="0 = never free"
                          onChange={(e) => setFreeDrafts((p) => ({ ...p, [s.site_id]: e.target.value }))}
                          data-testid={`pricing-free-${s.code}`} />
                      </td>
                      <td>
                        <button className="btn-primary" style={{ height: 28, fontSize: 12 }}
                          disabled={savingFeeSite === s.site_id}
                          data-testid={`pricing-save-${s.code}`}
                          onClick={() => saveFee(s)}>
                          {savingFeeSite === s.site_id ? 'Saving…' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p style={{ margin: '10px 2px 0', color: '#64748b', fontSize: 11 }}>
            Free-delivery threshold waives the fee once the basket subtotal reaches it. Leave it at
            0 to always charge the fee. A store with no rule charges the flat default ₹20.
          </p>
        </div>
      )}

      {showEmployeeModal && (
        <div className="modal-overlay" onClick={() => setShowEmployeeModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '90vw' }}>
            <div className="modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Create System User</h2>
                <div style={{ fontSize: 12, color: '#64748b' }}>Stored in iam_users with a hashed password</div>
              </div>
              <button className="modal-close" onClick={() => setShowEmployeeModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleAddEmployee(); }}>
              {modalError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                  padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14, fontWeight: 600 }}>
                  {modalError}
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Full name</label>
                <input type="text" className="form-input" value={employeeForm.full_name}
                  placeholder="e.g. Priya Sharma"
                  onChange={e => setEmployeeForm(p => ({ ...p, full_name: e.target.value }))} required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Email</label>
                <input type="email" className="form-input" value={employeeForm.email}
                  onChange={e => setEmployeeForm(p => ({ ...p, email: e.target.value }))} required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Role</label>
                  <select className="form-input" value={employeeForm.role}
                    onChange={e => setEmployeeForm(p => ({ ...p, role: e.target.value }))}>
                    {USER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Password</label>
                  <input type="password" className="form-input" value={employeeForm.password} minLength={6}
                    onChange={e => setEmployeeForm(p => ({ ...p, password: e.target.value }))} required />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowEmployeeModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Creating' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStoreModal && (
        <div className="modal-overlay" onClick={() => setShowStoreModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '90vw' }}>
            <div className="modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Register Site</h2>
                <div style={{ fontSize: 12, color: '#64748b' }}>Mother Hub (MH) or Dark Store (DS)</div>
              </div>
              <button className="modal-close" onClick={() => setShowStoreModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleAddStore(); }}>
              {modalError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                  padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14, fontWeight: 600 }}>
                  {modalError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Site code</label>
                  <input className="form-input" value={storeForm.code} placeholder="DS-BH-002"
                    onChange={e => setStoreForm(p => ({ ...p, code: e.target.value }))} required />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Site type</label>
                  <select className="form-input" value={storeForm.site_type}
                    onChange={e => setStoreForm(p => ({ ...p, site_type: e.target.value }))}>
                    <option value="DS">DS — Dark Store</option>
                    <option value="MH">MH — Mother Hub</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Name</label>
                <input type="text" className="form-input" value={storeForm.name}
                  placeholder="e.g. Indiranagar Dark Store"
                  onChange={e => setStoreForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Address</label>
                <input type="text" className="form-input" value={storeForm.address}
                  placeholder="Street, area, city"
                  onChange={e => setStoreForm(p => ({ ...p, address: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setShowStoreModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Registering' : 'Register Site'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520, width: '90vw' }}>
            <div className="modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Edit User</h2>
                <div style={{ fontSize: 12, color: '#64748b' }}>{editingUser.email}</div>
              </div>
              <button className="modal-close" data-testid="user-edit-close" onClick={() => setEditingUser(null)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleSaveEdit(); }}>
              {editError && (
                <div data-testid="user-edit-error"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                    padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14, fontWeight: 600 }}>
                  {editError}
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Full name</label>
                <input type="text" className="form-input" value={editForm.full_name}
                  data-testid="user-edit-name"
                  onChange={e => setEditForm(p => ({ ...p, full_name: e.target.value }))} required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Role</label>
                  <select className="form-input" value={editForm.role} data-testid="user-edit-role"
                    onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}>
                    {USER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Status</label>
                  <select className="form-input" value={editForm.status} data-testid="user-edit-status"
                    onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="BLOCKED">BLOCKED</option>
                    <option value="INACTIVE">INACTIVE</option>
                    <option value="PENDING">PENDING</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>
                  New password <span style={{ fontWeight: 500, color: '#94a3b8' }}>(leave blank to keep current)</span>
                </label>
                <input type="password" className="form-input" value={editForm.password} minLength={6}
                  placeholder="••••••"
                  onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditingUser(null)}>Cancel</button>
                <button type="submit" className="btn-primary" data-testid="user-edit-save" disabled={savingEdit}>
                  {savingEdit ? 'Saving' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCompModal && (
        <div className="modal-overlay" onClick={() => setShowCompModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: '90vw' }}>
            <div className="modal-header">
              <div>
                <h2 data-testid="emp-payroll-modal" style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Add Compensation Rate</h2>
                <div style={{ fontSize: 12, color: '#64748b' }}>Reference data — priced against shifts and task history</div>
              </div>
              <button className="modal-close" data-testid="emp-payroll-close" onClick={() => setShowCompModal(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleAddComp(); }}>
              {compError && (
                <div data-testid="emp-payroll-error"
                  style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b',
                    padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 14, fontWeight: 600 }}>
                  {compError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Person</label>
                  <select className="form-input" data-testid="emp-payroll-user" value={compForm.user}
                    onChange={e => setCompForm(p => ({ ...p, user: e.target.value }))} required>
                    <option value="">— Select —</option>
                    {employees.filter(e => e.role !== 'CUSTOMER').map(e => (
                      <option key={e.user_id} value={e.user_id}>{e.full_name || e.email}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Site</label>
                  <select className="form-input" data-testid="emp-payroll-site" value={compForm.site}
                    onChange={e => setCompForm(p => ({ ...p, site: e.target.value }))} required>
                    <option value="">— Select —</option>
                    {stores.map(s => (
                      <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Basis</label>
                  <select className="form-input" data-testid="emp-payroll-basis" value={compForm.basis}
                    onChange={e => setCompForm(p => ({ ...p, basis: e.target.value }))}>
                    {COMP_BASIS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Amount (₹)</label>
                  <input type="number" className="form-input" data-testid="emp-payroll-amount" min="0.01" step="0.01"
                    placeholder="e.g. 18000" value={compForm.amount}
                    onChange={e => setCompForm(p => ({ ...p, amount: e.target.value }))} required />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Currency</label>
                  <input className="form-input" value="INR" readOnly style={{ background: '#f4f4f5', color: '#64748b' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Effective from</label>
                  <input type="date" className="form-input" data-testid="emp-payroll-from" value={compForm.effective_from}
                    onChange={e => setCompForm(p => ({ ...p, effective_from: e.target.value }))} required />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>
                    Effective to <span style={{ fontWeight: 500, color: '#94a3b8' }}>(optional)</span>
                  </label>
                  <input type="date" className="form-input" data-testid="emp-payroll-to" value={compForm.effective_to}
                    onChange={e => setCompForm(p => ({ ...p, effective_to: e.target.value }))} />
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Notes</label>
                <input type="text" className="form-input" data-testid="emp-payroll-notes"
                  placeholder="e.g. night shift allowance" value={compForm.notes}
                  onChange={e => setCompForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn-secondary" data-testid="emp-payroll-cancel"
                  onClick={() => setShowCompModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" data-testid="emp-payroll-save" disabled={saving}>
                  {saving ? 'Saving' : 'Save Rate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
