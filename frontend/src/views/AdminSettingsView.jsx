import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchApi, postApi, describeError } from '../api/client';
import DataTable from '../components/ui/DataTable';
import { ShieldCheck, Building2, Users, X } from 'lucide-react';

export default function AdminSettingsView() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('employees');

  useEffect(() => {
    loadData();
  }, [activeTab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'employees') {
        const res = await fetchApi('/iam/users/');
        setEmployees(Array.isArray(res) ? res : []);
      } else {
        const res = await fetchApi('/network/sites/');
        setStores(Array.isArray(res) ? res : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
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

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center' }}>Loading Admin Panel...</div>;
  }

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
      </div>

      <div className="subtabs-bar" style={{ marginBottom: 24 }}>
        <button className={`subtab-btn ${activeTab === 'employees' ? 'active' : ''}`} onClick={() => setActiveTab('employees')}>
          <Users size={16} /> Employees & Roles
        </button>
        <button className={`subtab-btn ${activeTab === 'stores' ? 'active' : ''}`} onClick={() => setActiveTab('stores')}>
          <Building2 size={16} /> Dark Stores
        </button>
      </div>

      {activeTab === 'employees' && (
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
              : <span style={{ color: '#94a3b8' }}>Never</span> }
          ]}
          data={employees}
        />
      )}

      {activeTab === 'stores' && (
        <DataTable
          title="Facility Registry"
          subtitle="Manage Mother Hubs and localized Dark Stores."
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
            { header: 'Geo', key: 'geo_lat', render: r => r.geo_lat && r.geo_lng
              ? <span style={{ fontSize: 11 }}>{r.geo_lat}, {r.geo_lng}</span>
              : '—' }
          ]}
          data={stores}
        />
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
                <select className="form-input" value={employeeForm.full_name}
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
                <select className="form-input" value={storeForm.name}
                  onChange={e => setStoreForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: 11, fontWeight: 700 }}>Address</label>
                <select className="form-input" value={storeForm.address}
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
    </div>
  );
}
