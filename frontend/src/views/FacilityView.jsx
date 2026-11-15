import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Plus, Edit2, Trash2, X, Save, Loader2, MapPin, Layers, Box as BoxIcon, Truck } from 'lucide-react';

// lucide's Box is an <svg>; used as a layout wrapper its children land in the
// SVG namespace and never render. Layout boxes here are plain divs.
const Box = ({ children, ...rest }) => <div {...rest}>{children}</div>;

import DataTable from '../components/ui/DataTable';
import { fetchApi, postApi, patchApi, deleteApi, describeError } from '../api/client';

const asList = (res) => Array.isArray(res) ? res : res?.results ?? [];

export default function FacilityView({ initialTab = 'sites-registry' }) {
  const [activeSubtab, setActiveSubtab] = useState(initialTab);
  const [sites, setSites] = useState([]);
  const [zones, setZones] = useState([]);
  const [bins, setBins] = useState([]);
  const [dockDoors, setDockDoors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // CRUD Modal States
  const [modal, setModal] = useState({ open: false, mode: null, entity: null, data: null });
  const [formData, setFormData] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  useEffect(() => { setActiveSubtab(initialTab); }, [initialTab]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, z, l, d] = await Promise.all([
        fetchApi('/network/sites/'),
        fetchApi('/network/zones/'),
        fetchApi('/network/locations/'),
        fetchApi('/network/dock-doors/'),
      ]);
      setSites(asList(s));
      setZones(asList(z));
      setBins(asList(l));
      setDockDoors(asList(d));
    } catch (err) {
      setError(describeError(err));
      setSites([]); setZones([]); setBins([]); setDockDoors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ”————————————————————————————————————————————————————————————————€
  // CRUD HANDLERS
  // ”————————————————————————————————————————————————————————————————€

  const openModal = (mode, entity, data = null) => {
    if (mode === 'create') {
      setFormData(getDefaultForm(entity));
      setFormErrors({});
    } else {
      setFormData({ ...data });
    }
    setModal({ open: true, mode, entity, data });
  };

  const closeModal = () => {
    setModal({ open: false, mode: null, entity: null, data: null });
    setFormData({});
    setFormErrors({});
  };

  const getDefaultForm = (entity) => {
    switch (entity) {
      case 'site':
        return { code: '', name: '', site_type: 'DS', status: 'ACTIVE', address: '', pincode: '',
                 geo_lat: '', geo_lng: '', operating_hours: { weekdays: '08:00-22:00', weekends: '09:00-21:00' },
                 is_accepting_orders: true, dh_precedence: 0, parent_site: '' };
      case 'zone':
        return { code: '', zone_type: 'GENERAL', category: '', value_type: '', fragility: 'NORMAL',
                 site: '', is_advance_zone: false, commingled_allowed: false, max_commingled: 0,
                 is_hazardous_allowed: false, status: 'ACTIVE' };
      case 'bin':
        return { location_id: '', location_type: 'BIN', barcode: '', zone: '', site: '',
                 container: '', aisle: '', rack: '', level: '', position: '', capacity_qty: 0,
                 is_sellable_bin: true, is_active: true };
      case 'dock':
        return { code: '', capability: 'LOADING', site: '', status: 'ACTIVE' };
      default:
        return {};
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (formErrors[field]) {
      setFormErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (entity, data) => {
    const errors = {};
    if (entity === 'site') {
      if (!data.code?.trim()) errors.code = 'Site code is required';
      if (!data.name?.trim()) errors.name = 'Site name is required';
      if (!data.site_type) errors.site_type = 'Site type is required';
      if (!data.site?.trim() && entity !== 'site') errors.site = 'Parent site is required';
    }
    if (entity === 'zone') {
      if (!data.code?.trim()) errors.code = 'Zone code is required';
      if (!data.site) errors.site = 'Site is required';
    }
    if (entity === 'bin') {
      if (!data.location_id?.trim()) errors.location_id = 'Bin code is required';
      if (!data.site) errors.site = 'Site is required';
    }
    if (entity === 'dock') {
      if (!data.code?.trim()) errors.code = 'Door code is required';
      if (!data.site) errors.site = 'Site is required';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const submitForm = async (e) => {
    e.preventDefault();
    const { entity, mode, data } = modal;
    if (!validateForm(entity, formData)) return;

    setSubmitting(true);
    setError('');
    try {
      let url = `/network/${entity === 'site' ? 'sites' : entity === 'zone' ? 'zones' :
                     entity === 'bin' ? 'locations' : 'dock-doors'}/`;
      let payload = { ...formData };

      // Convert numeric fields
      if (entity === 'site') {
        payload.dh_precedence = parseInt(payload.dh_precedence) || 0;
        if (payload.geo_lat) payload.geo_lat = parseFloat(payload.geo_lat);
        if (payload.geo_lng) payload.geo_lng = parseFloat(payload.geo_lng);
      }
      if (entity === 'zone') {
        payload.max_commingled = parseInt(payload.max_commingled) || 0;
        if (!payload.is_advance_zone) payload.max_commingled = 0;
      }
      if (entity === 'bin') {
        payload.capacity_qty = parseInt(payload.capacity_qty) || 0;
      }
      // Remove empty parent_site for site creation
      if (entity === 'site' && !payload.parent_site) delete payload.parent_site;

      if (mode === 'create') {
        const res = await postApi(url, payload);
        await loadData();
        closeModal();
        return res;
      } else {
        const res = await patchApi(`${url}${data.site_id || data.zone_id || data.location_id || data.dock_door_id}/`, payload);
        await loadData();
        closeModal();
        return res;
      }
    } catch (err) {
      setError(describeError(err));
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entity, id) => {
    if (!window.confirm(`Delete this ${entity}? This action cannot be undone.`)) return;
    try {
      setError('');
      const url = `/network/${entity === 'site' ? 'sites' : entity === 'zone' ? 'zones' :
                     entity === 'bin' ? 'locations' : 'dock-doors'}/${id}/`;
      await deleteApi(url);
      await loadData();
    } catch (err) {
      setError(describeError(err));
    }
  };

  const siteOptions = sites.map(s => ({ value: s.site_id, label: `${s.code} — ${s.name}` }));
  const zoneOptions = zones.map(z => ({ value: z.zone_id, label: `${z.code} (${z.site?.code || '—'})` }));

  // Action renderers for DataTables
  const siteActions = (row) => (
    <Box style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      <button className="icon-btn" onClick={() => openModal('edit', 'site', row)} title="Edit" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--accent-cyan)' }}>
        <Edit2 size={16} />
      </button>
      <button className="icon-btn" onClick={() => handleDelete('site', row.site_id)} title="Delete" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444' }}>
        <Trash2 size={16} />
      </button>
    </Box>
  );

  const zoneActions = (row) => (
    <Box style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      <button className="icon-btn" onClick={() => openModal('edit', 'zone', row)} title="Edit" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--accent-cyan)' }}>
        <Edit2 size={16} />
      </button>
      <button className="icon-btn" onClick={() => handleDelete('zone', row.zone_id)} title="Delete" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444' }}>
        <Trash2 size={16} />
      </button>
    </Box>
  );

  const binActions = (row) => (
    <Box style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      <button className="icon-btn" onClick={() => openModal('edit', 'bin', row)} title="Edit" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--accent-cyan)' }}>
        <Edit2 size={16} />
      </button>
      <button className="icon-btn" onClick={() => handleDelete('bin', row.location_id)} title="Delete" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444' }}>
        <Trash2 size={16} />
      </button>
    </Box>
  );

  const dockActions = (row) => (
    <Box style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
      <button className="icon-btn" onClick={() => openModal('edit', 'dock', row)} title="Edit" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--accent-cyan)' }}>
        <Edit2 size={16} />
      </button>
      <button className="icon-btn" onClick={() => handleDelete('dock', row.dock_door_id)} title="Delete" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: '#ef4444' }}>
        <Trash2 size={16} />
      </button>
    </Box>
  );

  const dash = (v) => (v === null || v === undefined || v === '' ? <span style={{ color: '#94a3b8' }}>—</span> : v);

  // Sites are referenced as UUID FKs by every other network row, so resolve
  // them once for display instead of rendering a raw UUID.
  const siteById = Object.fromEntries(sites.map(s => [s.site_id, s]));

  const statusBadge = (v) => (
    <span className={`badge ${v === 'ACTIVE' || v === 'OPEN' ? 'badge-success' : v === 'SUSPENDED' || v === 'BUSY' ? 'badge-warning' : 'badge-default'}`}>
      {v || '—'}
    </span>
  );

  return (
    <div>
      {error && (
        <div className="card" style={{
          borderLeft: '3px solid #b91c1c', background: '#fef2f2', padding: '12px 16px',
          marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12
        }}>
          <AlertTriangle size={16} style={{ color: '#b91c1c', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <Box style={{ fontWeight: 700, color: '#7f1d1d', marginBottom: 2 }}>Could not load network data</Box>
            <div style={{ color: '#991b1b' }}>{error}</div>
          </div>
          <button className="btn-secondary" onClick={loadData} disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={12} /> {loading ? 'Retrying' : 'Retry'}
          </button>
        </div>
      )}

      <div className="subtabs-bar">
        <button className={`subtab-btn ${activeSubtab === 'sites-registry' ? 'active' : ''}`} onClick={() => setActiveSubtab('sites-registry')}>
          Sites Registry ({sites.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'zones' ? 'active' : ''}`} onClick={() => setActiveSubtab('zones')}>
          Storage Zones ({zones.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'storage-bins' ? 'active' : ''}`} onClick={() => setActiveSubtab('storage-bins')}>
          Storage Bins ({bins.length})
        </button>
        <button className={`subtab-btn ${activeSubtab === 'dock-doors' ? 'active' : ''}`} onClick={() => setActiveSubtab('dock-doors')}>
          Dock Doors ({dockDoors.length})
        </button>
        <Box style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {activeSubtab === 'sites-registry' && (
            <button className="btn-primary" onClick={() => openModal('create', 'site')}>
              <Plus size={14} /> Add Site
            </button>
          )}
          {activeSubtab === 'zones' && (
            <button className="btn-primary" onClick={() => openModal('create', 'zone')}>
              <Plus size={14} /> Add Zone
            </button>
          )}
          {activeSubtab === 'storage-bins' && (
            <button className="btn-primary" onClick={() => openModal('create', 'bin')}>
              <Plus size={14} /> Add Bin
            </button>
          )}
          {activeSubtab === 'dock-doors' && (
            <button className="btn-primary" onClick={() => openModal('create', 'dock')}>
              <Plus size={14} /> Add Dock Door
            </button>
          )}
        </Box>
      </div>

      {activeSubtab === 'sites-registry' && (
        <DataTable
          title="Warehouse Sites & Dark Store Network"
          subtitle="Mother Hubs, Dark Stores, Super Stores and cross-docks from network.Site"
          searchPlaceholder="Search site code, name, address..."
          columns={[
            { header: 'Site Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
            { header: 'Facility Name', key: 'name', render: r => <strong>{r.name || r.code}</strong> },
            { header: 'Facility Type', key: 'site_type', render: r => (
              <span className={`badge ${r.site_type === 'MH' ? 'badge-info' : r.site_type === 'DS' ? 'badge-purple' : 'badge-default'}`}>
                {r.site_type}
              </span>
            )},
            { header: 'Parent Site', key: 'parent_site', render: r => siteById[r.parent_site]?.code || '—' },
            { header: 'DH Precedence', key: 'dh_precedence' },
            { header: 'Accepting Orders', key: 'is_accepting_orders', align: 'center', render: r => (
              <span className={`badge ${r.is_accepting_orders ? 'badge-success' : 'badge-default'}`}>
                {r.is_accepting_orders ? 'Yes' : 'No'}
              </span>
            )},
            { header: 'Address', key: 'address', render: r => r.address || '—' },
            { header: 'Status', key: 'status', render: r => statusBadge(r.status) },
            { header: 'Actions', key: 'actions', align: 'center', render: siteActions },
          ]}
          data={sites}
        />
      )}

      {activeSubtab === 'zones' && (
        <DataTable
          title="Warehouse Storage Zones"
          subtitle="General, MRP and flexi-forward zones with commingling and hazard rules"
          searchPlaceholder="Search zone code, category..."
          columns={[
            { header: 'Zone Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
            { header: 'Zone Type', key: 'zone_type', render: r => <strong>{r.zone_type}</strong> },
            { header: 'Category', key: 'category', render: r => dash(r.category) },
            { header: 'Value Type', key: 'value_type', render: r => dash(r.value_type) },
            { header: 'Fragility', key: 'fragility', render: r => dash(r.fragility) },
            { header: 'Facility Site', key: 'site', render: r => siteById[r.site]?.code || '—' },
            { header: 'Advance', key: 'is_advance_zone', align: 'center', render: r => (
              <span className={`badge ${r.is_advance_zone ? 'badge-info' : 'badge-default'}`}>{r.is_advance_zone ? 'Yes' : 'No'}</span>
            )},
            { header: 'Commingled', key: 'commingled_allowed', align: 'center', render: r => (
              <span className={`badge ${r.commingled_allowed ? 'badge-success' : 'badge-default'}`}>
                {r.commingled_allowed ? `Yes (max ${r.max_commingled})` : 'No'}
              </span>
            )},
            { header: 'Hazardous', key: 'is_hazardous_allowed', align: 'center', render: r => (
              <span className={`badge ${r.is_hazardous_allowed ? 'badge-danger' : 'badge-default'}`}>
                {r.is_hazardous_allowed ? 'Allowed' : 'No'}
              </span>
            )},
            { header: 'Status', key: 'status', render: r => statusBadge(r.status) },
            { header: 'Actions', key: 'actions', align: 'center', render: zoneActions },
          ]}
          data={zones}
        />
      )}

      {activeSubtab === 'storage-bins' && (
        <DataTable
          title="Storage Bins & Location Coordinates"
          subtitle="Aisle-rack-level-position mapping for every physical location"
          searchPlaceholder="Search location id, barcode, aisle..."
          columns={[
            { header: 'Bin Code', key: 'location_id', render: r => (
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace', fontSize: 14 }}>{r.location_id}</span>
            )},
            { header: 'Type', key: 'location_type', render: r => (
              <span className={`badge ${r.location_type === 'BIN' ? 'badge-success' : r.location_type === 'DOCK' ? 'badge-info' : 'badge-warning'}`}>
                {r.location_type}
              </span>
            )},
            { header: 'Barcode', key: 'barcode', render: r => <span className="code-cell">{r.barcode}</span> },
            { header: 'Zone', key: 'zone', render: r => dash(r.zone) },
            { header: 'Site', key: 'site', render: r => siteById[r.site]?.code || '—' },
            { header: 'Container', key: 'container', render: r => dash(r.container) },
            { header: 'Aisle', key: 'aisle', render: r => dash(r.aisle) },
            { header: 'Rack', key: 'rack', render: r => dash(r.rack) },
            { header: 'Level', key: 'level', render: r => dash(r.level) },
            { header: 'Position', key: 'position', render: r => dash(r.position) },
            { header: 'Capacity', key: 'capacity_qty', align: 'right', render: r => dash(r.capacity_qty) },
            { header: 'Sellable', key: 'is_sellable_bin', align: 'center', render: r => (
              <span className={`badge ${r.is_sellable_bin ? 'badge-success' : 'badge-default'}`}>{r.is_sellable_bin ? 'Yes' : 'No'}</span>
            )},
            { header: 'Active', key: 'is_active', render: r => (
              <span className={`badge ${r.is_active ? 'badge-success' : 'badge-danger'}`}>{r.is_active ? 'Active' : 'Inactive'}</span>
            )},
            { header: 'Actions', key: 'actions', align: 'center', render: binActions },
          ]}
          data={bins}
        />
      )}

      {activeSubtab === 'dock-doors' && (
        <DataTable
          title="Inbound & Outbound Dock Doors"
          subtitle="Dock door capability and availability per site"
          searchPlaceholder="Search door code, capability..."
          columns={[
            { header: 'Door Code', key: 'code', render: r => <span className="code-cell">{r.code}</span> },
            { header: 'Capability', key: 'capability', render: r => <span className="badge badge-info">{r.capability}</span> },
            { header: 'Site', key: 'site', render: r => siteById[r.site]?.code || '—' },
            { header: 'Status', key: 'status', render: r => statusBadge(r.status) },
            { header: 'Actions', key: 'actions', align: 'center', render: dockActions },
          ]}
          data={dockDoors}
        />
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          CRUD MODAL
          â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {modal.open && (
        <div className="modal-overlay" onClick={closeModal} style={{ zIndex: 1000 }}>
          <div className="modal-card" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <Box style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Box style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--accent-purple-light)', color: 'var(--accent-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {modal.entity === 'site' && <MapPin size={18} />}
                  {modal.entity === 'zone' && <MapPin size={18} />}
                  {modal.entity === 'bin' && <BoxIcon size={18} />}
                  {modal.entity === 'dock' && <Truck size={18} />}
                </Box>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    {modal.mode === 'create' ? 'Add' : 'Edit'} {modal.entity === 'site' ? 'Site' : modal.entity === 'zone' ? 'Zone' : modal.entity === 'bin' ? 'Bin' : 'Dock Door'}
                  </h3>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {modal.mode === 'create' ? 'Register a new facility entity' : 'Update existing record'}
                  </div>
                </div>
              </Box>
              <button className="modal-close" onClick={closeModal}><X size={18} /></button>
            </div>

            <form onSubmit={submitForm}>
              {modal.entity === 'site' && (
                <Box style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Site Code *</span>
                      <input className="form-input" value={formData.code} onChange={e => handleInputChange('code', e.target.value)} placeholder="WH-BH-001" maxLength={20} required />
                      {formErrors.code && <span className="form-error">{formErrors.code}</span>}
                    </label>
                    <label className="form-group"><span className="form-label">Facility Name *</span>
                      <input className="form-input" value={formData.name} onChange={e => handleInputChange('name', e.target.value)} placeholder="Bhimavaram Mother Hub" required />
                      {formErrors.name && <span className="form-error">{formErrors.name}</span>}
                    </label>
                  </Box>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Facility Type *</span>
                      <select className="form-input" value={formData.site_type} onChange={e => handleInputChange('site_type', e.target.value)} required>
                        <option value="MH">Mother Hub (MH)</option>
                        <option value="DS">Dark Store (DS)</option>
                        <option value="SS">Super Store (SS)</option>
                        <option value="CD">Cross Dock (CD)</option>
                      </select>
                    </label>
                    <label className="form-group"><span className="form-label">Status</span>
                      <select className="form-input" value={formData.status} onChange={e => handleInputChange('status', e.target.value)}>
                        <option value="ACTIVE">Active</option>
                        <option value="SUSPENDED">Suspended</option>
                        <option value="INACTIVE">Inactive</option>
                      </select>
                    </label>
                  </Box>
                  <label className="form-group"><span className="form-label">Address</span>
                    <textarea className="form-input" rows={2} value={formData.address} onChange={e => handleInputChange('address', e.target.value)} placeholder="Full address with landmarks" />
                  </label>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Pincode</span>
                      <input className="form-input" value={formData.pincode} onChange={e => handleInputChange('pincode', e.target.value)} placeholder="533001" maxLength={6} />
                    </label>
                    <label className="form-group"><span className="form-label">DH Precedence</span>
                      <input className="form-input" type="number" value={formData.dh_precedence} onChange={e => handleInputChange('dh_precedence', e.target.value)} min={0} />
                    </label>
                  </Box>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Geo Latitude</span>
                      <input className="form-input" type="number" step="any" value={formData.geo_lat} onChange={e => handleInputChange('geo_lat', e.target.value)} placeholder="15.8793" />
                    </label>
                    <label className="form-group"><span className="form-label">Geo Longitude</span>
                      <input className="form-input" type="number" step="any" value={formData.geo_lng} onChange={e => handleInputChange('geo_lng', e.target.value)} placeholder="81.1875" />
                    </label>
</Box>
                <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label className="form-group"><span className="form-label">Operating Hours (Weekdays)</span>
                    <input className="form-input" value={formData.operating_hours?.weekdays} onChange={e => handleInputChange('operating_hours.weekdays', e.target.value)} placeholder="08:00-22:00" />
                  </label>
                  <label className="form-group"><span className="form-label">Operating Hours (Weekends)</span>
                    <input className="form-input" value={formData.operating_hours?.weekends} onChange={e => handleInputChange('operating_hours.weekends', e.target.value)} placeholder="09:00-21:00" />
                  </label>
                </Box>
                <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Parent Site (for DS/SS)</span>
                      <select className="form-input" value={formData.parent_site} onChange={e => handleInputChange('parent_site', e.target.value)}>
                        <option value="">None (standalone)</option>
                        {sites.filter(s => s.site_type === 'MH').map(s => (
                          <option key={s.site_id} value={s.site_id}>{s.code} — {s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                      <span className="form-label" style={{ marginBottom: 0 }}>Accepting Orders</span>
                      <input type="checkbox" checked={formData.is_accepting_orders} onChange={e => handleInputChange('is_accepting_orders', e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent-purple)' }} />
                    </label>
                  </Box>
                </Box>
              )}

              {modal.entity === 'zone' && (
                <Box style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Zone Code *</span>
                      <input className="form-input" value={formData.code} onChange={e => handleInputChange('code', e.target.value)} placeholder="ZONE-A-01" maxLength={20} required />
                      {formErrors.code && <span className="form-error">{formErrors.code}</span>}
                    </label>
                    <label className="form-group"><span className="form-label">Zone Type *</span>
                      <select className="form-input" value={formData.zone_type} onChange={e => handleInputChange('zone_type', e.target.value)} required>
                        <option value="GENERAL">General Storage</option>
                        <option value="MRP">MRP Zone</option>
                        <option value="FLEXI_FORWARD">Flexi Forward</option>
                        <option value="HAZARDOUS">Hazardous</option>
                        <option value="COLD">Cold Storage</option>
                        <option value="QUARANTINE">Quarantine</option>
                      </select>
                    </label>
                  </Box>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Site *</span>
                      <select className="form-input" value={formData.site} onChange={e => handleInputChange('site', e.target.value)} required>
                        <option value="">Select Site</option>
                        {siteOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      {formErrors.site && <span className="form-error">{formErrors.site}</span>}
                    </label>
                    <label className="form-group"><span className="form-label">Category</span>
                      <select className="form-input" value={formData.category} onChange={e => handleInputChange('category', e.target.value)}>
                        <option value="">—</option>
                        <option value="STANDARD">Standard</option>
                        <option value="HIGH_VALUE">High Value</option>
                        <option value="TEMPERATURE">Temperature Controlled</option>
                        <option value="OVERSIZED">Oversized</option>
                      </select>
                    </label>
                  </Box>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Value Type</span>
                      <select className="form-input" value={formData.value_type} onChange={e => handleInputChange('value_type', e.target.value)}>
                        <option value="">—</option>
                        <option value="STANDARD">Standard</option>
                        <option value="HIGH">High</option>
                        <option value="LOW">Low</option>
                      </select>
                    </label>
                    <label className="form-group"><span className="form-label">Fragility</span>
                      <select className="form-input" value={formData.fragility} onChange={e => handleInputChange('fragility', e.target.value)}>
                        <option value="NORMAL">Normal</option>
                        <option value="FRAGILE">Fragile</option>
                        <option value="HIGHLY_FRAGILE">Highly Fragile</option>
                      </select>
                    </label>
                  </Box>
                  <label className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <span className="form-label">Advance Zone</span>
                    <input type="checkbox" checked={formData.is_advance_zone} onChange={e => handleInputChange('is_advance_zone', e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent-purple)' }} />
                  </label>
                  <label className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <span className="form-label">Commingling Allowed</span>
                    <input type="checkbox" checked={formData.commingled_allowed} onChange={e => handleInputChange('commingled_allowed', e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent-purple)' }} />
                  </label>
                  <label className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <span className="form-label">Hazardous Allowed</span>
                    <input type="checkbox" checked={formData.is_hazardous_allowed} onChange={e => handleInputChange('is_hazardous_allowed', e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent-purple)' }} />
                  </label>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Max Commingled</span>
                      <input className="form-input" type="number" value={formData.max_commingled} onChange={e => handleInputChange('max_commingled', e.target.value)} min={0} disabled={!formData.commingled_allowed} />
                    </label>
                    <label className="form-group"><span className="form-label">Status</span>
                      <select className="form-input" value={formData.status} onChange={e => handleInputChange('status', e.target.value)}>
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                        <option value="MAINTENANCE">Maintenance</option>
                      </select>
                    </label>
                  </Box>
                </Box>
              )}

              {modal.entity === 'bin' && (
                <Box style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Bin Code *</span>
                      <input className="form-input" value={formData.location_id} onChange={e => handleInputChange('location_id', e.target.value)} placeholder="A-01-02-04" maxLength={50} required />
                      {formErrors.location_id && <span className="form-error">{formErrors.location_id}</span>}
                    </label>
                    <label className="form-group"><span className="form-label">Location Type *</span>
                      <select className="form-input" value={formData.location_type} onChange={e => handleInputChange('location_type', e.target.value)} required>
                        <option value="BIN">Bin</option>
                        <option value="DOCK">Dock</option>
                        <option value="STAGING">Staging</option>
                        <option value="QUARANTINE">Quarantine</option>
                      </select>
                    </label>
                  </Box>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Site *</span>
                      <select className="form-input" value={formData.site} onChange={e => handleInputChange('site', e.target.value)} required>
                        <option value="">Select Site</option>
                        {siteOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      {formErrors.site && <span className="form-error">{formErrors.site}</span>}
                    </label>
                    <label className="form-group"><span className="form-label">Zone</span>
                      <select className="form-input" value={formData.zone} onChange={e => handleInputChange('zone', e.target.value)}>
                        <option value="">None</option>
                        {zoneOptions.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
                      </select>
                    </label>
                  </Box>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Barcode</span>
                      <input className="form-input" value={formData.barcode} onChange={e => handleInputChange('barcode', e.target.value)} placeholder="Auto-generated if empty" />
                    </label>
                    <label className="form-group"><span className="form-label">Container</span>
                      <input className="form-input" value={formData.container} onChange={e => handleInputChange('container', e.target.value)} placeholder="BIN" />
                    </label>
                  </Box>
                  <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Aisle</span>
                      <input className="form-input" value={formData.aisle} onChange={e => handleInputChange('aisle', e.target.value)} placeholder="A" />
                    </label>
                    <label className="form-group"><span className="form-label">Rack</span>
                      <input className="form-input" value={formData.rack} onChange={e => handleInputChange('rack', e.target.value)} placeholder="01" />
                    </label>
                    <label className="form-group"><span className="form-label">Level</span>
                      <input className="form-input" value={formData.level} onChange={e => handleInputChange('level', e.target.value)} placeholder="02" />
                    </label>
                    <label className="form-group"><span className="form-label">Position</span>
                      <input className="form-input" value={formData.position} onChange={e => handleInputChange('position', e.target.value)} placeholder="04" />
                    </label>
                  </Box>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Capacity (qty)</span>
                      <input className="form-input" type="number" value={formData.capacity_qty} onChange={e => handleInputChange('capacity_qty', e.target.value)} min={0} />
                    </label>
                    <label className="form-group"><span className="form-label">Sellable</span>
                      <input type="checkbox" checked={formData.is_sellable_bin} onChange={e => handleInputChange('is_sellable_bin', e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent-purple)' }} />
                    </label>
                  </Box>
                  <label className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                    <span className="form-label">Active</span>
                    <input type="checkbox" checked={formData.is_active} onChange={e => handleInputChange('is_active', e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent-purple)' }} />
                  </label>
                </Box>
              )}

              {modal.entity === 'dock' && (
                <Box style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <Box style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label className="form-group"><span className="form-label">Door Code *</span>
                      <input className="form-input" value={formData.code} onChange={e => handleInputChange('code', e.target.value)} placeholder="DOCK-IN-01" maxLength={20} required />
                      {formErrors.code && <span className="form-error">{formErrors.code}</span>}
                    </label>
                    <label className="form-group"><span className="form-label">Capability *</span>
                      <select className="form-input" value={formData.capability} onChange={e => handleInputChange('capability', e.target.value)} required>
                        <option value="LOADING">Loading</option>
                        <option value="UNLOADING">Unloading</option>
                        <option value="BOTH">Both</option>
                      </select>
                    </label>
                  </Box>
                  <label className="form-group"><span className="form-label">Site *</span>
                    <select className="form-input" value={formData.site} onChange={e => handleInputChange('site', e.target.value)} required>
                      <option value="">Select Site</option>
                      {siteOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    {formErrors.site && <span className="form-error">{formErrors.site}</span>}
                  </label>
                  <label className="form-group"><span className="form-label">Status</span>
                    <select className="form-input" value={formData.status} onChange={e => handleInputChange('status', e.target.value)}>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="MAINTENANCE">Maintenance</option>
                    </select>
                  </label>
                </Box>
              )}

              <Box style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '16px 20px', borderTop: '1px solid var(--border-light)' }}>
                <button type="button" className="btn-secondary" onClick={closeModal} disabled={submitting}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
                  {modal.mode === 'create' ? 'Create' : 'Save Changes'}
                </button>
              </Box>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
