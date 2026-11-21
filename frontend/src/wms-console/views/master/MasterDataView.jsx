import React, { useState, useEffect } from 'react';
import { apiClient } from '../../api/client';
import DataTable from '../../components/ui/DataTable';
import { RefreshCw, Plus, Trash2, X, Save, Printer } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

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
    endpoint: '/network/sites/',
    idField: 'site_id',
    editableFields: [
      field('code', 'Site Code', { required: true }),
      field('name', 'Facility Name', { required: true }),
      field('site_type', 'Type', { type: 'select', required: true, options: [choice('MH', 'Mother Hub'), choice('DS', 'Dark Store'), choice('SS', 'Super Store'), choice('XDOCK', 'Cross Dock')] }),
      field('parent_site', 'Parent Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      field('address', 'Address', { type: 'textarea' }),
      field('dh_precedence', 'DH Precedence', { defaultValue: 'DEFAULT' }),
      field('ss_precedence', 'SS Precedence', { defaultValue: 'SS_DEFAULT' }),
      field('is_accepting_orders', 'Accepting Orders', { type: 'boolean', defaultValue: false }),
      field('status', 'Status', { type: 'select', options: [choice('ONBOARDING'), choice('ACTIVE'), choice('SUSPENDED'), choice('RETIRED')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Site Code', key: 'code', isCode: true },
      { label: 'Facility Name', key: 'name' },
      { label: 'Type', key: 'site_type', badge: true },
      { label: 'Address', key: 'address', render: v => <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'DH Precedence', key: 'dh_precedence', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  skus: {
    label: 'SKUs',
    endpoint: '/catalog/skus/',
    idField: 'sku_id',
    editableFields: [
      field('sku_code', 'SKU Code', { required: true }),
      field('name', 'Product Name', { required: true }),
      field('ean', 'EAN Barcode'),
      field('category', 'Category', { type: 'reference', ref: 'categories', valueKey: 'category_id', labelKey: 'name', allowBlank: true }),
      field('sub_category', 'Sub-Category'),
      field('brand', 'Brand'),
      field('pack_size', 'Pack Size'),
      field('base_uom', 'Base UOM', { defaultValue: 'EACH' }),
      field('mrp', 'MRP', { type: 'number', step: '0.01', defaultValue: 0 }),
      field('storage_zone', 'Storage Zone', { type: 'select', options: [choice('DRY'), choice('COLD'), choice('FROZEN')], defaultValue: 'DRY' }),
      field('is_food', 'Food Item', { type: 'boolean', defaultValue: false }),
      field('status', 'Status', { type: 'select', options: [choice('DRAFT'), choice('SAMPLE_QC'), choice('APPROVED'), choice('ACTIVE'), choice('DELISTED'), choice('DISCONTINUED')], defaultValue: 'DRAFT' }),
    ],
    columns: [
      { label: 'SKU Code', key: 'sku_code', isCode: true },
      { label: 'Product Name', key: 'name', render: v => <strong>{v}</strong> },
      { label: 'EAN Barcode', key: 'ean', isCode: true },
      { label: 'Category', key: 'category_name', render: v => <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{v || '-'}</span> },
      { label: 'Sub-Category', key: 'sub_category', render: v => <span style={{ fontSize: 11 }}>{v || '-'}</span> },
      { label: 'MRP', key: 'mrp', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>₹{parseFloat(v || 0).toFixed(2)}</span> },
      { label: 'Zone', key: 'storage_zone', badge: true },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  categories: {
    label: 'Categories',
    endpoint: '/catalog/categories/',
    idField: 'category_id',
    editableFields: [
      field('name', 'Category Name', { required: true }),
      field('parent', 'Parent Category', { type: 'reference', ref: 'categories', valueKey: 'category_id', labelKey: 'name', allowBlank: true }),
    ],
    columns: [
      { label: 'Category', key: 'name', render: v => <strong>{v}</strong> },
      { label: 'Parent', key: 'parent_name', render: v => <span>{v || '-'}</span> },
    ],
  },
  bins: {
    label: 'Storage Bins',
    endpoint: '/network/locations/',
    idField: 'location_id',
    editableFields: [
      field('location_id', 'Location ID', { required: true }),
      field('site', 'Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', required: true }),
      field('location_type', 'Location Type', { type: 'select', options: [choice('BIN'), choice('ZONE'), choice('DOCK'), choice('STAGING')], defaultValue: 'BIN' }),
      field('zone', 'Zone', { type: 'reference', ref: 'zones', valueKey: 'zone_id', labelKey: 'code', allowBlank: true }),
      field('container', 'Container', { defaultValue: 'PICK_FACE' }),
      field('aisle', 'Aisle'),
      field('rack', 'Rack'),
      field('level', 'Level'),
      field('position', 'Position'),
      field('barcode', 'Barcode (leave blank to auto-generate BIN-<SITE>-0001…)', { allowBlank: true }),
      field('capacity_qty', 'Capacity', { type: 'number' }),
      field('is_sellable_bin', 'Sellable Bin', { type: 'boolean', defaultValue: false }),
      field('is_active', 'Active', { type: 'boolean', defaultValue: true }),
    ],
    columns: [
      { label: 'Bin Code', key: 'barcode', render: (v, row) => <span style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--c-amber)', padding: '2px 6px' }}>{v || row.location_id}</span> },
      { label: 'Site', key: 'site_code', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'Location Type', key: 'location_type', badge: true },
      { label: 'Container', key: 'container', badge: true },
      { label: 'Aisle', key: 'aisle', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v || '-'}</span> },
      { label: 'Rack', key: 'rack', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v || '-'}</span> },
      { label: 'Level', key: 'level', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v || '-'}</span> },
      { label: 'Capacity', key: 'capacity_qty', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v ?? '-'}</span> },
      { label: 'Sellable', key: 'is_sellable_bin', render: v => <span style={{ color: v ? '#48a968' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{v ? 'YES' : 'NO'}</span> },
      { label: 'Active', key: 'is_active', render: v => <span style={{ color: v ? '#48a968' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{v ? 'YES' : 'NO'}</span> },
    ],
  },
  zones: {
    label: 'Zones',
    endpoint: '/network/zones/',
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
      { label: 'Site', key: 'site_code', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'Category', key: 'category', render: v => <span style={{ fontSize: 11 }}>{v || '-'}</span> },
      { label: 'Zone Type', key: 'zone_type', badge: true },
      { label: 'Max Commingle', key: 'max_commingled', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  'dock-doors': {
    label: 'Dock Doors',
    endpoint: '/network/dock-doors/',
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
    endpoint: '/supply/vendors/',
    idField: 'vendor_id',
    editableFields: [
      field('code', 'Vendor Code', { required: true }),
      field('name', 'Vendor Name', { required: true }),
      field('org_entity', 'Legal Entity'),
      field('gstin', 'GSTIN'),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('BLOCKED'), choice('BLACKLISTED')], defaultValue: 'ACTIVE' }),
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
      field('name', 'Cluster Name'),
      field('site', 'Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', required: true }),
      field('zone', 'Zone', { type: 'reference', ref: 'zones', valueKey: 'zone_id', labelKey: 'code', allowBlank: true }),
      field('slot_count', 'Slot Count', { type: 'number', defaultValue: 0 }),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Cluster Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name', render: v => <span>{v || '-'}</span> },
      { label: 'Site', key: 'site_code', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'Zone', key: 'zone_code', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'Slots', key: 'slot_count', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v ?? 0}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  'vehicle-types': {
    label: 'Vehicle Types',
    endpoint: '/network/vehicle-types/',
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
    endpoint: '/master/carriers/',
    idField: 'carrier_id',
    editableFields: [
      field('code', 'Transporter Code', { required: true }),
      field('name', 'Transporter Name', { required: true }),
      field('organization', 'Organization', { type: 'reference', ref: 'organizations', valueKey: 'org_id', labelKey: 'name', allowBlank: true }),
      field('mode', 'Mode', { type: 'select', options: [choice('ROAD'), choice('AIR'), choice('RAIL'), choice('COURIER'), choice('MULTIMODAL')], defaultValue: 'ROAD' }),
      field('contact_name', 'Contact Name'),
      field('contact_phone', 'Contact Phone'),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE'), choice('BLOCKED')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Name', key: 'name', render: v => <strong>{v}</strong> },
      { label: 'Mode', key: 'mode', badge: true },
      { label: 'Organization', key: 'organization_name', render: v => <span>{v || '-'}</span> },
      { label: 'Contact', key: 'contact_name', render: (v, row) => <span>{v || row.contact_phone || '-'}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  users: {
    label: 'Users & Roles',
    endpoint: '/iam/users/',
    idField: 'user_id',
    editableFields: [
      field('email', 'Email', { required: true }),
      field('full_name', 'Name', { required: true }),
      field('phone', 'Phone'),
      field('password', 'Password', { type: 'password', required: true, omitIfBlank: true }),
      field('role', 'Role', { type: 'select', required: true, options: [choice('SUPER_ADMIN'), choice('OPS_MANAGER'), choice('WAREHOUSE_STAFF'), choice('RIDER'), choice('CUSTOMER'), choice('SENDER')] }),
      field('site_id', 'Site', { type: 'reference', ref: 'sites', valueKey: 'site_id', labelKey: 'code', allowBlank: true }),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE'), choice('BLOCKED'), choice('PENDING')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Email', key: 'email', isCode: true },
      { label: 'Name', key: 'full_name', render: v => <strong>{v}</strong> },
      { label: 'Phone', key: 'phone', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'Role', key: 'role', badge: true },
      { label: 'Assigned Site', key: 'assigned_site_code', render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{v || '-'}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
  'reason-codes': {
    label: 'Reason Codes',
    endpoint: '/master/reason-codes/',
    idField: 'rc_id',
    editableFields: [
      field('code', 'Reason Code', { required: true }),
      field('category', 'Category', { type: 'select', required: true, options: [choice('SHORT_PICK'), choice('DAMAGE'), choice('DISCREPANCY'), choice('CHECK_IN_BREACH'), choice('CANCEL'), choice('OTHER')] }),
      field('description', 'Description', { type: 'textarea', required: true }),
      field('requires_photo', 'Requires Photo', { type: 'boolean', defaultValue: false }),
      field('requires_remark', 'Requires Remark', { type: 'boolean', defaultValue: false }),
      field('status', 'Status', { type: 'select', options: [choice('ACTIVE'), choice('INACTIVE')], defaultValue: 'ACTIVE' }),
    ],
    columns: [
      { label: 'Code', key: 'code', isCode: true },
      { label: 'Category', key: 'category', badge: true },
      { label: 'Description', key: 'description' },
      { label: 'Requires Photo', key: 'requires_photo', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v ? 'YES' : 'NO'}</span> },
      { label: 'Requires Remark', key: 'requires_remark', render: v => <span style={{ fontFamily: 'var(--font-mono)' }}>{v ? 'YES' : 'NO'}</span> },
      { label: 'Status', key: 'status', badge: true },
    ],
  },
};

const GROUP_TABS = {
  'mh-configs': ['sites', 'zones', 'bins', 'dock-doors', 'cluster-zones', 'vehicle-types'],
  catalog: ['skus', 'categories', 'vendors', 'transporters'],
  'user-management': ['users', 'reason-codes'],
};

const REFERENCE_ENDPOINTS = {
  sites: '/network/sites/',
  zones: '/network/zones/',
  categories: '/catalog/categories/',
  organizations: '/master/organizations/',
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
    if (f.omitIfBlank && value === '') {
      return payload;
    }
    if ((f.type === 'reference' || f.allowBlank) && value === '') {
      payload[f.name] = null;
    } else if (f.type === 'number') {
      payload[f.name] = value === '' || value === null ? null : Number(value);
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

export default function MasterDataView({ initialTab = 'sites', allowedTabs = null, siteId = '', description = '', darkStoreMode = false }) {
  const allowed = Array.isArray(allowedTabs) && allowedTabs.length ? allowedTabs : null;
  const safeInitialTab = allowed && !allowed.includes(initialTab) ? allowed[0] : initialTab;
  const [tab, setTab] = useState(safeInitialTab);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [referenceData, setReferenceData] = useState({});
  const [modalMode, setModalMode] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [formData, setFormData] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [printBin, setPrintBin] = useState(null);

  const visibleGroup = allowed
    ? null
    : Object.entries(GROUP_TABS).find(([, tabs]) => tabs.includes(initialTab));
  const visibleTabIds = (allowed || (visibleGroup ? visibleGroup[1] : Object.keys(TAB_CONFIG)))
    .filter(tid => !TAB_CONFIG[tid]?.unsupported);

  const resultsFrom = (data) => Array.isArray(data) ? data : data.results || [];

  const loadData = async (currentTab = tab) => {
    setLoading(true);
    const config = TAB_CONFIG[currentTab];
    if (!config || config.unsupported || !config.endpoint) {
      setData([]);
      setLoading(false);
      return;
    }
    try {
      const res = await apiClient.get(config.endpoint, {
        page_size: 500,
        ...((siteId && currentTab === 'bins') ? { site: siteId } : {}),
      });
      let rows = resultsFrom(res);
      if (siteId && currentTab === 'bins') {
        rows = rows.filter(row => String(row.site || '') === String(siteId));
      }

      if (['bins', 'zones', 'dock-doors'].includes(currentTab)) {
        const sitesRes = await apiClient.get('/network/sites/', { page_size: 500 });
        const siteCodeById = new Map(resultsFrom(sitesRes).map(site => [site.site_id, site.code]));
        rows = rows.map(row => ({
          ...row,
          site_code: siteCodeById.get(row.site) || row.site || '—',
        }));
      }

      if (currentTab === 'bins') {
        const zonesRes = await apiClient.get('/network/zones/', { page_size: 500 });
        const zoneCodeById = new Map(resultsFrom(zonesRes).map(zone => [zone.zone_id, zone.code]));
        rows = rows.map(row => ({
          ...row,
          zone_code: zoneCodeById.get(row.zone) || row.zone || '—',
        }));
      }

      if (currentTab === 'categories') {
        const categoryNameById = new Map(rows.map(category => [category.category_id, category.name]));
        rows = rows.map(row => ({
          ...row,
          parent_name: categoryNameById.get(row.parent) || row.parent || '—',
        }));
      }

      if (currentTab === 'users') {
        rows = rows.map(row => ({
          ...row,
          assigned_site_code: row.assigned_site?.code || '—',
        }));
      }

      setData(rows);
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
        const res = await apiClient.get(REFERENCE_ENDPOINTS[ref], { page_size: 500 });
        return [ref, resultsFrom(res)];
      } catch (err) {
        console.error(`Failed loading ${ref} reference data:`, err);
        return [ref, []];
      }
    }));
    setReferenceData(Object.fromEntries(entries));
  };

  useEffect(() => {
    setTab(safeInitialTab);
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
        const created = await apiClient.post(config.endpoint, payload);
        // After a new bin is created, hand the operator the printable QR right
        // away — that is the artefact they stick on the shelf.
        if (darkStoreMode && tab === 'bins') {
          setPrintBin(created || payload);
        }
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
            {description || 'Configuration registry for facilities, catalog, carriers, warehouse layout, and access control.'}
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

      {config?.unsupported ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {config.unsupported}
        </div>
      ) : config ? (
        <DataTable
          columns={darkStoreMode && tab === 'bins'
            ? [...config.columns, {
                label: 'Print QR',
                key: 'print',
                render: (_, row) => (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Print bin QR slip"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPrintBin(row);
                    }}
                    style={{ padding: 4 }}
                  >
                    <Printer size={14} />
                  </button>
                ),
              }]
            : config.columns}
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
                          required={modalMode === 'create' && f.required}
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

      {darkStoreMode && printBin && (
        <div className="modal-backdrop" onClick={() => setPrintBin(null)}>
          <div className="modal-box print-slip-modal" style={{ maxWidth: 380, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div className="print-slip" style={{ padding: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: 1, color: 'var(--text-muted)' }}>ZIPPZO DARK STORE</div>
              <div className="mono-num" style={{ fontSize: 15, fontWeight: 900, margin: '4px 0 10px', wordBreak: 'break-word' }}>{printBin.barcode || 'BIN—'}</div>
              <QRCodeSVG value={printBin.barcode || printBin.location_id || ''} size={170} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                {printBin.location_type || 'BIN'} · {printBin.container || ''}{printBin.aisle ? ` · Aisle ${printBin.aisle}` : ''}{printBin.rack ? ` · Rack ${printBin.rack}` : ''}{printBin.level ? ` · Level ${printBin.level}` : ''}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>Scan to see this bin’s contents in the app.</div>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'center', gap: 10 }}>
              <button type="button" className="btn-ui neutral" onClick={() => setPrintBin(null)}>Close</button>
              <button type="button" className="btn-ui primary" onClick={() => window.print()}>
                <Printer size={13} />
                <span>Print slip</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@media print {
        body * { visibility: hidden !important; }
        .print-slip-modal, .print-slip-modal * { visibility: visible !important; }
        .print-slip-modal .modal-footer, .print-slip-modal .icon-btn { display: none !important; }
        .print-slip-modal { position: fixed; inset: 0; background: #fff; }
        .print-slip-modal .modal-box { box-shadow: none; border: none; width: auto; }
        @page { size: 100mm 150mm; margin: 8mm; }
      }`}</style>
    </div>
  );
}
