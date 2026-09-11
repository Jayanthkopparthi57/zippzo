import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw, Plus, Trash2, X, Save } from 'lucide-react';

const choice = (value, label = value) => ({ value, label });
const field = (name, label, options = {}) => ({
  name,
  label,
  type: 'text',
  required: false,
  ...options,
});

const TAB_CONFIG = {
  sites: {
    label: 'Sites',
    endpoint: '/master/sites/',
    idField: 'site_id',
    editableFields: [
      field('code', 'Site Code', { required: true }),
      field('name', 'Facility Name', { required: true }),
      field('type', 'Type', { type: 'select', required: true, options: [choice('MH', 'Mother Hub'), choice('DS', 'Dark Store'), choice('SS', 'Super Store'), choice('XDOCK', 'Cross Dock')] }),
      field('parent_site', 'Parent Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      field('address', 'Address', { type: 'textarea' }),
      field('dh_precedence', 'DH Precedence', { defaultValue: 'DEFAULT' }),
      field('ss_precedence', 'SS Precedence', { defaultValue: 'SS_DEFAULT' }),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Site Code', key: 'code', isCode: true },
      { label: 'Facility Name', key: 'name' },
      { label: 'Type', key: 'type', badge: true },
      { label: 'Address', key: 'address', render: v => <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'DH Precedence', key: 'dh_precedence', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  skus: {
    label: 'SKUs',
    endpoint: '/master/skus/',
    idField: 'sku_id',
    editableFields: [
      field('sku_code', 'SKU Code', { required: true }),
      field('name', 'Product Name', { required: true }),
      field('ean', 'EAN Barcode', { required: true }),
      field('category', 'Category', { type: 'reference', ref: 'categories', valueKey: 'category_id', labelKey: 'name', allowBlank: true }),
      field('sub_category', 'Sub-Category'),
      field('mrp', 'MRP', { type: 'number', step: '0.01', defaultValue: 0 }),
      field('wac', 'WAC', { type: 'number', step: '0.01', defaultValue: 0 }),
      field('pack_size', 'Pack Size'),
      field('storage_zone', 'Storage Zone', { type: 'select', options: [choice('DRY'), choice('COLD'), choice('FROZEN')], defaultValue: 'DRY' }),
      field('shelf_life_days', 'Shelf Life Days', { type: 'number', defaultValue: 365 }),
      field('is_food', 'Food Item', { type: 'boolean', defaultValue: true }),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'SKU Code', key: 'sku_code', isCode: true },
      { label: 'Product Name', key: 'name', render: v => <strong>{v}</strong> },
      { label: 'EAN Barcode', key: 'ean', isCode: true },
      { label: 'Category', key: 'category_name', render: v => <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{v}</span> },
      { label: 'Sub-Category', key: 'sub_category', render: v => <span style={{ fontSize: 11 }}>{v || '-'}</span> },
      { label: 'MRP', key: 'mrp', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>Rs {parseFloat(v || 0).toFixed(2)}</span> },
      { label: 'WAC', key: 'wac', render: v => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>Rs {parseFloat(v || 0).toFixed(2)}</span> },
      { label: 'Zone', key: 'storage_zone', badge: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  bins: {
    label: 'Storage Bins',
    endpoint: '/master/bins/',
    idField: 'bin_id',
    editableFields: [
      field('code', 'Bin Code', { required: true }),
      field('site', 'Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', required: true }),
      field('zone', 'Zone', { type: 'reference', ref: 'zones', valueKey: 'zone_id', labelKey: 'code', allowBlank: true }),
      field('aisle', 'Aisle'),
      field('rack', 'Rack'),
      field('level', 'Level', { type: 'number', defaultValue: 1 }),
      field('level_class', 'Level Class'),
      field('rack_class', 'Rack Class'),
      field('roll_no', 'Roll No', { type: 'number', defaultValue: 0 }),
      field('bin_type', 'Bin Type'),
      field('lbh', 'LBH'),
      field('putaway_max', 'Putaway Max', { type: 'number', defaultValue: 100 }),
      field('condition', 'Condition', { type: 'select', options: [choice('GOOD'), choice('DAMAGE')], defaultValue: 'GOOD' }),
      field('is_pickzone', 'Pick Zone', { type: 'boolean', defaultValue: false }),
      field('zone_sub_type', 'Zone Sub-Type'),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Bin Code', key: 'code', render: v => <span style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--c-amber)', padding: '2px 6px' }}>{v}</span> },
      { label: 'Aisle', key: 'aisle', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span> },
      { label: 'Rack', key: 'rack', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span> },
      { label: 'Level', key: 'level', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span> },
      { label: 'Bin Type', key: 'bin_type', badge: true },
      { label: 'Pickzone', key: 'is_pickzone', render: v => <span style={{ color: v ? '#48a968' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{v ? 'YES' : 'NO'}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  zones: {
    label: 'Zones',
    endpoint: '/master/zones/',
    idField: 'zone_id',
    editableFields: [
      field('code', 'Zone Code', { required: true }),
      field('site', 'Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', required: true }),
      field('category', 'Category'),
      field('zone_type', 'Zone Type', { type: 'select', options: [choice('GENERAL'), choice('MRP'), choice('FLEXI_FORWARD')], defaultValue: 'GENERAL' }),
      field('value_type', 'Value Type', { defaultValue: 'General' }),
      field('fragility', 'Fragility', { defaultValue: 'General' }),
      field('food_type', 'Food Type', { defaultValue: 'General' }),
      field('product_type', 'Product Type', { defaultValue: 'Food' }),
      field('is_advance_zone', 'Advance Zone', { type: 'boolean', defaultValue: false }),
      field('commingled_allowed', 'Commingled Allowed', { type: 'boolean', defaultValue: true }),
      field('max_commingled', 'Max Commingle', { type: 'number', defaultValue: 5 }),
      field('is_hazardous_allowed', 'Hazardous Allowed', { type: 'boolean', defaultValue: false }),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE'), choice('BLOCKED')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Zone Code', key: 'code', isCode: true },
      { label: 'Category', key: 'category', render: v => <span style={{ fontSize: 11 }}>{v}</span> },
      { label: 'Zone Type', key: 'zone_type', badge: true },
      { label: 'Max Commingle', key: 'max_commingled', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  'dock-doors': {
    label: 'Dock Doors',
    endpoint: '/master/dock-doors/',
    idField: 'door_id',
    editableFields: [
      field('code', 'Door Code', { required: true }),
      field('site', 'Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', required: true }),
      field('capability', 'Capability', { type: 'select', options: [choice('LOAD'), choice('UNLOAD'), choice('BOTH')], defaultValue: 'BOTH' }),
      field('status', 'Status', { type: 'select', options: [choice('OPEN'), choice('BUSY'), choice('CLOSED')], defaultValue: 'OPEN' }),
    ],
    columns: [
      { label: 'Door Code', key: 'code', isCode: true },
      { label: 'Site', key: 'site_code', render: (v, row) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || row.site || '-'}</span> },
      { label: 'Capability', key: 'capability', badge: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  vendors: {
    label: 'Vendors',
    endpoint: '/master/vendors/',
    idField: 'vendor_id',
    editableFields: [
      field('code', 'Vendor Code', { required: true }),
      field('name', 'Vendor Name', { required: true }),
      field('org_entity', 'Legal Entity'),
      field('gstin', 'GSTIN'),
      field('is_customer', 'Customer', { type: 'boolean', defaultValue: false }),
      field('is_sku_vendor', 'SKU Vendor', { type: 'boolean', defaultValue: true }),
      field('status', 'Status', { type: 'select', options: [choice('Active'), choice('Inactive')], defaultValue: 'Active' }),
    ],
    columns: [
      { label: 'Vendor Code', key: 'code', isCode: true },
      { label: 'Vendor Name', key: 'name', render: v => <strong>{v}</strong> },
      { label: 'Legal Entity', key: 'org_entity', render: v => <span style={{ fontSize: 11 }}>{v || '-'}</span> },
      { label: 'GSTIN', key: 'gstin', isCode: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  'cluster-zones': {
    label: 'Cluster Zones',
    endpoint: '/master/cluster-zones/',
    idField: 'cz_id',
    editableFields: [
      field('code', 'Cluster Code', { required: true }),
      field('site', 'Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', required: true }),
      field('slot_count', 'Slot Count', { type: 'number', defaultValue: 0 }),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Cluster Code', key: 'code', isCode: true },
      { label: 'Site', key: 'site_code', render: (v, row) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || row.site || '-'}</span> },
      { label: 'Slots', key: 'slot_count', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  'vehicle-types': {
    label: 'Vehicle Types',
    endpoint: '/master/vehicle-types/',
    idField: 'vt_id',
    editableFields: [
      field('code', 'Vehicle Type Code', { required: true }),
      field('capacity_lpns', 'Capacity LPNs', { type: 'number', defaultValue: 0 }),
      field('temp_controlled', 'Temperature Controlled', { type: 'boolean', defaultValue: false }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Capacity LPNs', key: 'capacity_lpns', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v || '-'}</span> },
      { label: 'Temp Controlled', key: 'temp_controlled', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v ? 'YES' : 'NO'}</span> },
    ],
  },
  transporters: {
    label: 'Transporters',
    endpoint: '/master/transporters/',
    idField: 'transporter_id',
    editableFields: [
      field('code', 'Transporter Code', { required: true }),
      field('name', 'Transporter Name', { required: true }),
      field('billing_basis', 'Billing Basis'),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name', render: v => <strong>{v}</strong> },
      { label: 'Billing Basis', key: 'billing_basis', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v || '-'}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  users: {
    label: 'Users & Roles',
    endpoint: '/platform/users/',
    idField: 'user_id',
    editableFields: [
      field('emp_code', 'Employee Code', { required: true }),
      field('name', 'Name', { required: true }),
      field('phone', 'Phone'),
      field('role', 'Role', { type: 'select', required: true, options: [choice('PICKER'), choice('PACKER'), choice('SORTER'), choice('GRN_OP', 'GRN Operator'), choice('QC'), choice('SUPERVISOR'), choice('ADMIN')] }),
      field('site_id', 'Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE'), choice('BLOCKED')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Emp Code', key: 'emp_code', isCode: true },
      { label: 'Name', key: 'name', render: v => <strong>{v}</strong> },
      { label: 'Phone', key: 'phone', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'Role', key: 'role', badge: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  'reason-codes': {
    label: 'Reason Codes',
    endpoint: '/platform/reason-codes/',
    idField: 'rc_id',
    editableFields: [
      field('code', 'Reason Code', { required: true }),
      field('category', 'Category', { type: 'select', required: true, options: [choice('SHORT_PICK'), choice('DAMAGE'), choice('DISCREPANCY'), choice('CHECK_IN_BREACH'), choice('CANCEL')] }),
      field('description', 'Description', { type: 'textarea', required: true }),
      field('requires_photo', 'Requires Photo', { type: 'boolean', defaultValue: false }),
      field('requires_remark', 'Requires Remark', { type: 'boolean', defaultValue: false }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Description', key: 'description' },
      { label: 'Category', key: 'category', badge: true },
    ],
  },
};

const GROUP_TABS = {
  'mh-configs': ['sites', 'zones', 'bins', 'dock-doors', 'cluster-zones', 'vehicle-types'],
  catalog: ['skus', 'vendors', 'transporters'],
  'user-management': ['users', 'reason-codes'],
};

const REFERENCE_ENDPOINTS = {
  sites: '/master/sites/',
  zones: '/master/zones/',
  categories: '/master/sku-categories/',
};

function buildInitialForm(fields = [], record = null) {
  return fields.reduce((acc, f) => {
    if (record) {
      acc[f.name] = record[f.name] ?? '';
    } else if (f.defaultValue !== undefined) {
      acc[f.name] = f.defaultValue;
    } else if (f.type === 'boolean') {
      acc[f.name] = false;
    } else {
      acc[f.name] = '';
    }
    return acc;
  }, {});
}

function normalizePayload(fields = [], formData = {}) {
  return fields.reduce((payload, f) => {
    const value = formData[f.name];
    if ((f.type === 'reference' || f.allowBlank) && value === '') {
      payload[f.name] = null;
    } else if (f.type === 'number') {
      payload[f.name] = value === '' || value === null ? 0 : Number(value);
    } else if (f.type === 'boolean') {
      payload[f.name] = Boolean(value);
    } else {
      payload[f.name] = value;
    }
    return payload;
  }, {});
}

function formatApiError(error) {
  if (error?.details && typeof error.details === 'object') {
    return Object.entries(error.details)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join(' | ');
  }
  return error?.message || 'The record could not be saved.';
}

export default function MasterDataView({ initialTab = 'sites' }) {
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [referenceData, setReferenceData] = useState({});
  const [modalMode, setModalMode] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const visibleGroup = Object.entries(GROUP_TABS).find(([, tabs]) => tabs.includes(initialTab));
  const visibleTabIds = visibleGroup ? visibleGroup[1] : Object.keys(TAB_CONFIG);

  const loadData = async (currentTab = tab) => {
    setLoading(true);
    const config = TAB_CONFIG[currentTab];
    if (!config) {
      setLoading(false);
      return;
    }
    try {
      const res = await apiClient.get(config.endpoint);
      setData(res.results || []);
    } catch (err) {
      console.error('MasterDataView fetch error:', err);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const loadReferenceData = async () => {
    const neededRefs = new Set();
    Object.values(TAB_CONFIG).forEach(cfg => {
      (cfg.editableFields || []).forEach(f => {
        if (f.type === 'reference') neededRefs.add(f.ref);
      });
    });

    const entries = await Promise.all([...neededRefs].map(async ref => {
      try {
        const res = await apiClient.get(REFERENCE_ENDPOINTS[ref]);
        return [ref, res.results || res || []];
      } catch (err) {
        console.error(`Failed loading ${ref} reference data:`, err);
        return [ref, []];
      }
    }));
    setReferenceData(Object.fromEntries(entries));
  };

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    loadData(tab);
  }, [tab]);

  useEffect(() => {
    loadReferenceData();
  }, []);

  const config = TAB_CONFIG[tab];
  const editableFields = config?.editableFields || [];

  const openCreateModal = () => {
    setError('');
    setEditingRecord(null);
    setFormData(buildInitialForm(editableFields));
    setModalMode('create');
  };

  const openEditModal = (record) => {
    setError('');
    setEditingRecord(record);
    setFormData(buildInitialForm(editableFields, record));
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingRecord(null);
    setFormData({});
    setError('');
  };

  const updateField = (name, value) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    setError('');
    try {
      const payload = normalizePayload(editableFields, formData);
      if (modalMode === 'edit' && editingRecord) {
        await apiClient.patch(`${config.endpoint}${editingRecord[config.idField]}/`, payload);
      } else {
        await apiClient.post(config.endpoint, payload);
      }
      closeModal();
      await Promise.all([loadData(tab), loadReferenceData()]);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!config || !editingRecord) return;
    if (!window.confirm(`Delete this ${config.label.toLowerCase()} record?`)) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.delete(`${config.endpoint}${editingRecord[config.idField]}/`);
      closeModal();
      await Promise.all([loadData(tab), loadReferenceData()]);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="screen-header">
        <div>
          <div className="screen-title">
            <span>{config?.label?.toUpperCase() || 'MASTER DATA'}</span>
            <span className="screen-count-tag">{data.length} records</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Configuration registry for facilities, catalog, carriers, warehouse layout, and access control.
          </div>
        </div>

        <div className="screen-actions">
          <button className="btn-ui neutral" onClick={() => loadData(tab)}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
            <span>Sync</span>
          </button>
          {editableFields.length > 0 && (
            <button className="btn-ui primary" onClick={openCreateModal}>
              <Plus size={13} />
              <span>Add</span>
            </button>
          )}
        </div>
      </div>

      <div className="subtabs-rail">
        <div className="subtabs-list">
          {visibleTabIds.map(tid => {
            const cfg = TAB_CONFIG[tid];
            if (!cfg) return null;
            return (
              <button
                key={tid}
                className={`subtab-btn ${tab === tid ? 'active' : ''}`}
                onClick={() => setTab(tid)}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>

      {config ? (
        <DataTable
          columns={config.columns}
          data={data}
          idField={config.idField}
          onActionClick={editableFields.length > 0 ? openEditModal : undefined}
        />
      ) : (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          [ No configuration found for tab: {tab} ]
        </div>
      )}

      {modalMode && config && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-box" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="modal-header">
              <div className="modal-title">
                {modalMode === 'edit' ? `Edit ${config.label}` : `Add ${config.label}`}
              </div>
              <button type="button" className="btn-ui neutral" onClick={closeModal} disabled={saving}>
                <X size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {error && <div className="form-error-banner">{error}</div>}
                <div className="crud-form-grid">
                  {editableFields.map(f => (
                    <div key={f.name} className={f.type === 'textarea' ? 'crud-form-field wide' : 'crud-form-field'}>
                      <label>{f.label}</label>
                      {f.type === 'select' ? (
                        <select value={formData[f.name] ?? ''} onChange={(event) => updateField(f.name, event.target.value)} required={f.required}>
                          {f.allowBlank && <option value="">None</option>}
                          {(f.options || []).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      ) : f.type === 'reference' ? (
                        <select value={formData[f.name] ?? ''} onChange={(event) => updateField(f.name, event.target.value)} required={f.required}>
                          {(f.allowBlank || !f.required) && <option value="">None</option>}
                          {(referenceData[f.ref] || []).map(option => (
                            <option key={option[f.valueKey]} value={option[f.valueKey]}>
                              {option[f.labelKey]}{option.name && option[f.labelKey] !== option.name ? ` - ${option.name}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : f.type === 'textarea' ? (
                        <textarea value={formData[f.name] ?? ''} onChange={(event) => updateField(f.name, event.target.value)} required={f.required} rows={3} />
                      ) : f.type === 'boolean' ? (
                        <label className="crud-checkbox">
                          <input type="checkbox" checked={Boolean(formData[f.name])} onChange={(event) => updateField(f.name, event.target.checked)} />
                          <span>{Boolean(formData[f.name]) ? 'Enabled' : 'Disabled'}</span>
                        </label>
                      ) : (
                        <input
                          type={f.type}
                          step={f.step}
                          value={formData[f.name] ?? ''}
                          onChange={(event) => updateField(f.name, event.target.value)}
                          required={f.required}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="modal-footer">
                {modalMode === 'edit' && (
                  <button type="button" className="btn-ui danger" onClick={handleDelete} disabled={saving}>
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                )}
                <button type="button" className="btn-ui neutral" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn-ui primary" disabled={saving}>
                  {modalMode === 'edit' ? <Save size={13} /> : <Plus size={13} />}
                  <span>{saving ? 'Saving...' : modalMode === 'edit' ? 'Save Changes' : 'Create Record'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
