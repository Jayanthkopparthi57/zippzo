import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeIndianRupee, Building2, CheckCircle2, Clock3, Download, Pencil, Plus,
  Search, Trash2, Users2, Wallet,
} from 'lucide-react';
import { fetchApi, postApi, patchApi, deleteApi } from '../api/client';
import '../styles/vendors.css';

const emptyVendor = () => ({
  name: '', org_entity: '', gstin: '', pan: '', contact_name: '', contact_phone: '',
  email: '', address: '', bank_name: '', bank_account_number: '', ifsc: '',
  account_holder_name: '', payment_status: 'PENDING', status: 'ACTIVE',
});

const emptyPayment = () => ({
  vendor: '', amount: '', status: 'COMPLETE',
  payment_date: new Date().toISOString().slice(0, 10),
  bank_name: '', bank_account_number: '', ifsc: '', account_holder_name: '',
  reference: '', notes: '',
});

const emptySalary = () => ({
  user: '', amount: '', period_start: '', period_end: '', reference: '', notes: '',
});

const emptyBank = () => ({
  user: '', bank_name: '', bank_account_number: '', ifsc: '',
  account_holder_name: '', upi_id: '',
});

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Pill({ children, tone = 'neutral' }) {
  return <span className={`vend-pill vend-pill--${tone}`}>{children}</span>;
}

/**
 * One Vendors screen shared by the MH and DS consoles. Vendors and payments
 * are global master records, so both facilities work on the same data.
 */
export default function VendorsView({ mode = 'MH', siteLabel = '' }) {
  const [tab, setTab] = useState('vendors');
  const [vendors, setVendors] = useState([]);
  const [payments, setPayments] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [bankDetails, setBankDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [salaryForm, setSalaryForm] = useState(emptySalary());
  const [bankForm, setBankForm] = useState(emptyBank());
  const [editingSalary, setEditingSalary] = useState(null);
  const [vendorForm, setVendorForm] = useState(emptyVendor());
  const [editingVendor, setEditingVendor] = useState(null);
  const [paymentForm, setPaymentForm] = useState(emptyPayment());
  const [editingPayment, setEditingPayment] = useState(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [salarySearch, setSalarySearch] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [vendorRows, paymentRows, salaryRows, employeeRows, bankRows] = await Promise.all([
        fetchApi('/supply/vendors/?page_size=500'),
        fetchApi('/supply/vendor-payments/?page_size=500'),
        fetchApi('/money/salary-payments/?page_size=500'),
        fetchApi('/iam/users/?page_size=500'),
        fetchApi('/money/employee-bank-details/?page_size=500'),
      ]);
      setVendors(Array.isArray(vendorRows) ? vendorRows : []);
      setPayments(Array.isArray(paymentRows) ? paymentRows : []);
      setSalaries(Array.isArray(salaryRows) ? salaryRows : []);
      setEmployees(Array.isArray(employeeRows)
        ? employeeRows.filter((u) => u.role !== 'CUSTOMER' && u.status !== 'BLOCKED')
        : []);
      setBankDetails(Array.isArray(bankRows) ? bankRows : []);
    } catch (err) {
      setError(err?.message || 'Could not load vendor records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const updateVendor = (key, value) => setVendorForm((prev) => ({ ...prev, [key]: value }));
  const updatePayment = (key, value) => setPaymentForm((prev) => ({ ...prev, [key]: value }));
  const updateSalary = (key, value) => setSalaryForm((prev) => ({ ...prev, [key]: value }));
  const updateBank = (key, value) => setBankForm((prev) => ({ ...prev, [key]: value }));

  const bankByUser = useMemo(() => {
    const map = new Map();
    bankDetails.forEach((row) => { if (row.user) map.set(String(row.user), row); });
    return map;
  }, [bankDetails]);

  const employeeName = (userId) => {
    const employee = employees.find((u) => String(u.user_id) === String(userId));
    return employee ? (employee.full_name || employee.email) : '—';
  };

  const runPayoutAction = async (kind, row, action) => {
    const base = kind === 'vendor' ? '/supply/vendor-payments' : '/money/salary-payments';
    setBusyId(`${kind}-${action}-${row.payment_id}`);
    setError('');
    try {
      const result = await postApi(`${base}/${row.payment_id}/${action}/`, {});
      await reload();
      showNotice(action === 'pay'
        ? `Cashfree payout started · ${result?.payout_status || result?.status || 'sent'}.`
        : `Payout status refreshed · ${result?.payout_status || result?.status || 'unknown'}.`);
    } catch (err) {
      setError(err?.message || `Could not ${action} this payout.`);
    } finally {
      setBusyId('');
    }
  };

  const startEditSalary = (row) => {
    setEditingSalary(row.payment_id);
    setSalaryForm({
      user: row.user, amount: row.amount,
      period_start: String(row.period_start || '').slice(0, 10),
      period_end: String(row.period_end || '').slice(0, 10),
      reference: row.reference || '', notes: row.notes || '',
    });
    const detail = bankByUser.get(String(row.user));
    if (detail) {
      setBankForm({
        user: detail.user, bank_name: detail.bank_name || '',
        bank_account_number: detail.bank_account_number || '', ifsc: detail.ifsc || '',
        account_holder_name: detail.account_holder_name || '', upi_id: detail.upi_id || '',
      });
    }
  };

  const saveSalary = async (event) => {
    event.preventDefault();
    if (!salaryForm.user || !salaryForm.amount) { setError('Employee and amount are required.'); return; }
    setBusy(true); setError('');
    try {
      const payload = { ...salaryForm, amount: Number(salaryForm.amount).toFixed(2) };
      if (editingSalary) await patchApi(`/money/salary-payments/${editingSalary}/`, payload);
      else await postApi('/money/salary-payments/', payload);
      setSalaryForm(emptySalary()); setEditingSalary(null);
      await reload();
      showNotice(editingSalary ? 'Salary updated.' : 'Salary recorded.');
    } catch (err) {
      setError(err?.message || 'Could not save salary.');
    } finally { setBusy(false); }
  };

  const removeSalary = async (row) => {
    if (!window.confirm(`Delete salary record of ${money(row.amount)}?`)) return;
    setBusy(true);
    try {
      await deleteApi(`/money/salary-payments/${row.payment_id}/`);
      await reload(); showNotice('Salary record deleted.');
    } catch (err) {
      setError(err?.message || 'Could not delete salary record.');
    } finally { setBusy(false); }
  };

  const saveBankDetail = async (event) => {
    event.preventDefault();
    if (!bankForm.user) { setError('Choose an employee first.'); return; }
    setBusy(true); setError('');
    try {
      const existing = bankByUser.get(String(bankForm.user));
      if (existing) await patchApi(`/money/employee-bank-details/${existing.detail_id}/`, bankForm);
      else await postApi('/money/employee-bank-details/', bankForm);
      await reload(); showNotice('Employee bank details saved.');
    } catch (err) {
      setError(err?.message || 'Could not save bank details.');
    } finally { setBusy(false); }
  };

  const startEditVendor = (row) => {
    setEditingVendor(row.vendor_id);
    setVendorForm({
      name: row.name || '', org_entity: row.org_entity || '', gstin: row.gstin || '',
      pan: row.pan || '', contact_name: row.contact_name || '', contact_phone: row.contact_phone || '',
      email: row.email || '', address: row.address || '', bank_name: row.bank_name || '',
      bank_account_number: row.bank_account_number || '', ifsc: row.ifsc || '',
      account_holder_name: row.account_holder_name || '',
      payment_status: row.payment_status || 'PENDING', status: row.status || 'ACTIVE',
    });
  };

  const saveVendor = async (event) => {
    event.preventDefault();
    if (!vendorForm.name.trim()) { setError('Vendor company name is required.'); return; }
    setBusy(true);
    setError('');
    try {
      if (editingVendor) await patchApi(`/supply/vendors/${editingVendor}/`, vendorForm);
      else await postApi('/supply/vendors/', vendorForm);
      setVendorForm(emptyVendor());
      setEditingVendor(null);
      await reload();
      showNotice(editingVendor ? 'Vendor updated.' : 'Vendor registered.');
    } catch (err) {
      setError(err?.message || 'Could not save vendor.');
    } finally {
      setBusy(false);
    }
  };

  const removeVendor = async (row) => {
    if (!window.confirm(`Delete vendor ${row.name}?`)) return;
    setBusy(true);
    try {
      await deleteApi(`/supply/vendors/${row.vendor_id}/`);
      await reload();
      showNotice('Vendor deleted.');
    } catch (err) {
      setError(err?.message || 'Could not delete vendor.');
    } finally {
      setBusy(false);
    }
  };

  const startEditPayment = (row) => {
    setEditingPayment(row.payment_id);
    setPaymentForm({
      vendor: row.vendor, amount: row.amount, status: row.status,
      payment_date: String(row.payment_date || '').slice(0, 10),
      bank_name: row.bank_name || '', bank_account_number: row.bank_account_number || '',
      ifsc: row.ifsc || '', account_holder_name: row.account_holder_name || '',
      reference: row.reference || '', notes: row.notes || '',
    });
  };

  const savePayment = async (event) => {
    event.preventDefault();
    if (!paymentForm.vendor || !paymentForm.amount) { setError('Vendor and amount are required.'); return; }
    setBusy(true);
    setError('');
    try {
      const payload = { ...paymentForm, amount: Number(paymentForm.amount).toFixed(2) };
      if (editingPayment) await patchApi(`/supply/vendor-payments/${editingPayment}/`, payload);
      else await postApi('/supply/vendor-payments/', payload);
      setPaymentForm(emptyPayment());
      setEditingPayment(null);
      await reload();
      showNotice(editingPayment ? 'Payment updated.' : 'Payment saved.');
    } catch (err) {
      setError(err?.message || 'Could not save payment.');
    } finally {
      setBusy(false);
    }
  };

  const removePayment = async (row) => {
    if (!window.confirm(`Delete payment of ${money(row.amount)}?`)) return;
    setBusy(true);
    try {
      await deleteApi(`/supply/vendor-payments/${row.payment_id}/`);
      await reload();
      showNotice('Payment deleted.');
    } catch (err) {
      setError(err?.message || 'Could not delete payment.');
    } finally {
      setBusy(false);
    }
  };

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((row) => [row.name, row.org_entity, row.gstin, row.bank_name]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [vendors, vendorSearch]);

  const filteredPayments = useMemo(() => {
    const q = paymentSearch.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((row) => [row.vendor_name, row.vendor_code, row.reference, row.status]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [payments, paymentSearch]);

  const filteredSalaries = useMemo(() => {
    const q = salarySearch.trim().toLowerCase();
    if (!q) return salaries;
    return salaries.filter((row) => [row.employee_name, row.employee_email, row.status, row.reference]
      .some((value) => String(value || '').toLowerCase().includes(q)));
  }, [salaries, salarySearch]);

  const totals = useMemo(() => {
    const paid = payments.filter((p) => p.status === 'COMPLETE').reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const pending = payments.filter((p) => p.status === 'PENDING').reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const month = new Date().toISOString().slice(0, 7);
    const thisMonth = payments.filter((p) => String(p.payment_date || '').startsWith(month))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return { paid, pending, thisMonth };
  }, [payments]);

  const exportCsv = (rows, headers, file) => {
    const csv = [headers.join(','), ...rows.map((row) => headers.map((_, i) => JSON.stringify(row[i] ?? '')).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url; link.download = file; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="vend-page">
      <div className="vend-page__head">
        <div>
          <h1>Vendor Management</h1>
          <p>Register suppliers, bank details and payments — shared across MH and DS.</p>
        </div>
        <div className="vend-page__context">
          <Pill tone="accent">{mode === 'MH' ? 'Mother Hub' : 'Dark Store'}</Pill>
          {siteLabel && <span>{siteLabel}</span>}
        </div>
      </div>

      <div className="vend-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'vendors'} className={tab === 'vendors' ? 'active' : ''} onClick={() => setTab('vendors')}>
          <Building2 size={15} /> Vendors
        </button>
        <button type="button" role="tab" aria-selected={tab === 'payments'} className={tab === 'payments' ? 'active' : ''} onClick={() => setTab('payments')}>
          <Wallet size={15} /> Vendor Payments
        </button>
        <button type="button" role="tab" aria-selected={tab === 'salaries'} className={tab === 'salaries' ? 'active' : ''} onClick={() => setTab('salaries')}>
          <Users2 size={15} /> Salaries
        </button>
      </div>

      {error && <div className="vend-feedback vend-feedback--error">{error}</div>}
      {notice && <div className="vend-feedback vend-feedback--ok">{notice}</div>}
      {loading && <div className="vend-feedback">Loading vendor records…</div>}

      {tab === 'vendors' ? (
        <>
          <section className="vend-card">
            <div className="vend-card__head vend-card__head--blue">
              <Building2 size={18} />
              <div><h2>Vendor Registration</h2><p>Register and manage your product suppliers.</p></div>
              <span className="vend-card__badge">Trusted Partner Network</span>
            </div>
            <form className="vend-form" onSubmit={saveVendor}>
              <fieldset disabled={busy}>
                <legend>Vendor Company Details</legend>
                <div className="vend-grid vend-grid--two">
                  <label>Vendor Company Name *<input value={vendorForm.name} onChange={(e) => updateVendor('name', e.target.value)} placeholder="Sree Ram Company" /></label>
                  <label>Company / Brand Name<input value={vendorForm.org_entity} onChange={(e) => updateVendor('org_entity', e.target.value)} placeholder="ITC" /></label>
                  <label>GST Number<input value={vendorForm.gstin} onChange={(e) => updateVendor('gstin', e.target.value)} placeholder="GSTIN123456" /></label>
                  <label>PAN<input value={vendorForm.pan} onChange={(e) => updateVendor('pan', e.target.value)} /></label>
                  <label>Contact Person<input value={vendorForm.contact_name} onChange={(e) => updateVendor('contact_name', e.target.value)} /></label>
                  <label>Contact Phone<input value={vendorForm.contact_phone} onChange={(e) => updateVendor('contact_phone', e.target.value)} /></label>
                  <label>Email<input type="email" value={vendorForm.email} onChange={(e) => updateVendor('email', e.target.value)} /></label>
                  <label className="vend-span">Address<input value={vendorForm.address} onChange={(e) => updateVendor('address', e.target.value)} /></label>
                </div>

                <legend>Bank Account Details</legend>
                <div className="vend-grid vend-grid--two">
                  <label>Bank Name<input value={vendorForm.bank_name} onChange={(e) => updateVendor('bank_name', e.target.value)} placeholder="HDFC Bank" /></label>
                  <label>Bank Account Number<input value={vendorForm.bank_account_number} onChange={(e) => updateVendor('bank_account_number', e.target.value)} /></label>
                  <label>IFSC Code<input value={vendorForm.ifsc} onChange={(e) => updateVendor('ifsc', e.target.value)} /></label>
                  <label>Account Holder Name<input value={vendorForm.account_holder_name} onChange={(e) => updateVendor('account_holder_name', e.target.value)} /></label>
                  <label>Payment Status
                    <select value={vendorForm.payment_status} onChange={(e) => updateVendor('payment_status', e.target.value)}>
                      <option value="PENDING">Pending</option><option value="PAID">Paid</option>
                    </select>
                  </label>
                  <label>Status
                    <select value={vendorForm.status} onChange={(e) => updateVendor('status', e.target.value)}>
                      <option value="ACTIVE">Active</option><option value="BLOCKED">Blocked</option><option value="BLACKLISTED">Blacklisted</option>
                    </select>
                  </label>
                </div>
                <div className="vend-form__actions">
                  <button type="submit" className="vend-btn vend-btn--primary">{editingVendor ? 'Update Vendor' : 'Save Vendor'}</button>
                  {editingVendor && <button type="button" className="vend-btn" onClick={() => { setEditingVendor(null); setVendorForm(emptyVendor()); }}>Cancel</button>}
                </div>
              </fieldset>
            </form>
          </section>

          <section className="vend-card">
            <div className="vend-card__head">
              <Users2 size={18} />
              <div><h2>Registered Vendors</h2><p>{vendors.length} vendor(s) in the shared master</p></div>
              <div className="vend-card__tools">
                <div className="vend-search"><Search size={14} /><input value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} placeholder="Search by vendor or company…" /></div>
                <button type="button" className="vend-btn" onClick={() => exportCsv(filteredVendors.map((v) => [v.name, v.org_entity, v.gstin, v.bank_name, v.bank_account_number, v.ifsc, v.account_holder_name, v.payment_status, v.status]), ['Vendor', 'Company', 'GSTIN', 'Bank', 'Account', 'IFSC', 'Holder', 'Payment', 'Status'], 'vendors.csv')}><Download size={14} /> Export</button>
                <button type="button" className="vend-btn vend-btn--green" onClick={() => { setEditingVendor(null); setVendorForm(emptyVendor()); }}><Plus size={14} /> Add Vendor</button>
              </div>
            </div>
            <div className="vend-table-wrap">
              <table className="vend-table">
                <thead><tr><th>#</th><th>Vendor</th><th>Company</th><th>GST Number</th><th>Bank Name</th><th>Bank Account</th><th>IFSC</th><th>Account Holder</th><th>Payment Status</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredVendors.map((row, index) => (
                    <tr key={row.vendor_id}>
                      <td>{index + 1}</td>
                      <td><b>{row.name}</b></td>
                      <td>{row.org_entity || '—'}</td>
                      <td>{row.gstin || '—'}</td>
                      <td>{row.bank_name || '—'}</td>
                      <td className="vend-mono">{row.bank_account_number || '—'}</td>
                      <td className="vend-mono">{row.ifsc || '—'}</td>
                      <td>{row.account_holder_name || '—'}</td>
                      <td><Pill tone={row.payment_status === 'PAID' ? 'success' : 'warning'}>{row.payment_status === 'PAID' ? 'Complete' : 'Pending'}</Pill></td>
                      <td><Pill tone={row.status === 'ACTIVE' ? 'success' : 'danger'}>{row.status}</Pill></td>
                      <td className="vend-actions">
                        <button type="button" title="Edit" onClick={() => startEditVendor(row)}><Pencil size={13} /></button>
                        <button type="button" title="Delete" onClick={() => removeVendor(row)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                  {!filteredVendors.length && <tr><td colSpan={11} className="vend-empty">No vendors found.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="vend-card__foot">Showing {filteredVendors.length} of {vendors.length} vendors</div>
          </section>
        </>
      ) : tab === 'payments' ? (
        <>
          <div className="vend-kpis">
            <div className="vend-kpi"><Users2 size={20} /><span>Total Vendors</span><strong>{vendors.length}</strong></div>
            <div className="vend-kpi vend-kpi--green"><CheckCircle2 size={20} /><span>Total Paid</span><strong>{money(totals.paid)}</strong></div>
            <div className="vend-kpi vend-kpi--amber"><Clock3 size={20} /><span>Pending</span><strong>{money(totals.pending)}</strong></div>
            <div className="vend-kpi"><BadgeIndianRupee size={20} /><span>This Month</span><strong>{money(totals.thisMonth)}</strong></div>
          </div>

          <section className="vend-card">
            <div className="vend-card__head vend-card__head--blue">
              <Wallet size={18} />
              <div><h2>Vendor Payment Management</h2><p>Track and manage vendor payments.</p></div>
            </div>
            <form className="vend-form" onSubmit={savePayment}>
              <fieldset disabled={busy}>
                <legend>Payment Details</legend>
                <div className="vend-grid vend-grid--two">
                  <label>Payment Amount (₹) *<input type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(e) => updatePayment('amount', e.target.value)} placeholder="70000" /></label>
                  <label>Payment Status
                    <select value={paymentForm.status} onChange={(e) => updatePayment('status', e.target.value)}>
                      <option value="COMPLETE">Complete</option><option value="PENDING">Pending</option>
                    </select>
                  </label>
                  <label>Vendor *
                    <select value={paymentForm.vendor} onChange={(e) => updatePayment('vendor', e.target.value)}>
                      <option value="">Select vendor</option>
                      {vendors.map((v) => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
                    </select>
                  </label>
                  <label>Payment Date<input type="date" value={paymentForm.payment_date} onChange={(e) => updatePayment('payment_date', e.target.value)} /></label>
                  <label>Bank Name<input value={paymentForm.bank_name} onChange={(e) => updatePayment('bank_name', e.target.value)} /></label>
                  <label>Bank Account Number<input value={paymentForm.bank_account_number} onChange={(e) => updatePayment('bank_account_number', e.target.value)} /></label>
                  <label>IFSC Code<input value={paymentForm.ifsc} onChange={(e) => updatePayment('ifsc', e.target.value)} /></label>
                  <label>Account Holder Name<input value={paymentForm.account_holder_name} onChange={(e) => updatePayment('account_holder_name', e.target.value)} /></label>
                  <label>Reference<input value={paymentForm.reference} onChange={(e) => updatePayment('reference', e.target.value)} /></label>
                  <label className="vend-span">Notes<input value={paymentForm.notes} onChange={(e) => updatePayment('notes', e.target.value)} /></label>
                </div>
                <div className="vend-form__actions">
                  <button type="submit" className="vend-btn vend-btn--primary">{editingPayment ? 'Update Payment' : 'Save Payment'}</button>
                  {editingPayment && <button type="button" className="vend-btn" onClick={() => { setEditingPayment(null); setPaymentForm(emptyPayment()); }}>Cancel</button>}
                </div>
              </fieldset>
            </form>
          </section>

          <section className="vend-card">
            <div className="vend-card__head">
              <Wallet size={18} />
              <div><h2>Payment Records</h2><p>{payments.length} payment(s)</p></div>
              <div className="vend-card__tools">
                <div className="vend-search"><Search size={14} /><input value={paymentSearch} onChange={(e) => setPaymentSearch(e.target.value)} placeholder="Search payments…" /></div>
                <button type="button" className="vend-btn" onClick={() => exportCsv(filteredPayments.map((p) => [p.vendor_name, p.amount, p.payment_date, p.status, p.reference]), ['Vendor', 'Amount', 'Date', 'Status', 'Reference'], 'vendor-payments.csv')}><Download size={14} /> Export</button>
              </div>
            </div>
            <div className="vend-table-wrap">
              <table className="vend-table">
                <thead><tr><th>#</th><th>Vendor Name</th><th>Amount (₹)</th><th>Payment Date</th><th>Status</th><th>Reference</th><th>Payout</th><th>Action</th></tr></thead>
                <tbody>
                  {filteredPayments.map((row, index) => (
                    <tr key={row.payment_id}>
                      <td>{index + 1}</td>
                      <td><b>{row.vendor_name || '—'}</b></td>
                      <td className="vend-mono">{money(row.amount)}</td>
                      <td>{row.payment_date || '—'}</td>
                      <td><Pill tone={row.status === 'COMPLETE' ? 'success' : 'warning'}>{row.status === 'COMPLETE' ? 'Complete' : 'Pending'}</Pill></td>
                      <td>{row.reference || '—'}</td>
                      <td>
                        <Pill tone={row.payout_status === 'SUCCESS' ? 'success' : row.payout_status === 'FAILED' ? 'danger' : 'warning'}>
                          {row.payout_channel === 'CASHFREE' ? (row.payout_status || 'PENDING') : 'Manual'}
                        </Pill>
                        {row.transfer_id && <div className="vend-mono" style={{ marginTop: 3, fontSize: 10 }}>{row.transfer_id}</div>}
                      </td>
                      <td className="vend-actions">
                        <button type="button" title="Pay via Cashfree" disabled={Boolean(busyId)} onClick={() => runPayoutAction('vendor', row, 'pay')}><Wallet size={13} /></button>
                        {row.payout_channel === 'CASHFREE' && (
                          <button type="button" title="Refresh payout status" disabled={Boolean(busyId)} onClick={() => runPayoutAction('vendor', row, 'sync-payout')}><CheckCircle2 size={13} /></button>
                        )}
                        <button type="button" title="Edit" onClick={() => startEditPayment(row)}><Pencil size={13} /></button>
                        <button type="button" title="Delete" onClick={() => removePayment(row)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                  {!filteredPayments.length && <tr><td colSpan={8} className="vend-empty">No payments recorded.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="vend-card__foot">Showing {filteredPayments.length} of {payments.length} payments</div>
          </section>
        </>
      ) : (
        <>
          <div className="vend-kpis">
            <div className="vend-kpi"><Users2 size={20} /><span>Employees</span><strong>{employees.length}</strong></div>
            <div className="vend-kpi vend-kpi--green"><CheckCircle2 size={20} /><span>Salaries Paid</span><strong>{money(salaries.filter((s) => s.status === 'PAID').reduce((sum, s) => sum + Number(s.amount || 0), 0))}</strong></div>
            <div className="vend-kpi vend-kpi--amber"><Clock3 size={20} /><span>Salary Pending</span><strong>{money(salaries.filter((s) => s.status === 'PENDING').reduce((sum, s) => sum + Number(s.amount || 0), 0))}</strong></div>
            <div className="vend-kpi"><Wallet size={20} /><span>Bank Profiles</span><strong>{bankDetails.length}</strong></div>
          </div>

          <section className="vend-card">
            <div className="vend-card__head vend-card__head--blue">
              <Users2 size={18} />
              <div><h2>Employee Bank Details</h2><p>Beneficiary account for Cashfree salary payouts.</p></div>
            </div>
            <form className="vend-form" onSubmit={saveBankDetail}>
              <fieldset disabled={busy}>
                <div className="vend-grid vend-grid--two">
                  <label>Employee *
                    <select value={bankForm.user} onChange={(e) => {
                      const value = e.target.value;
                      updateBank('user', value);
                      const found = bankByUser.get(String(value));
                      setBankForm(found ? {
                        user: value, bank_name: found.bank_name || '',
                        bank_account_number: found.bank_account_number || '',
                        ifsc: found.ifsc || '', account_holder_name: found.account_holder_name || '',
                        upi_id: found.upi_id || '',
                      } : emptyBank());
                    }}>
                      <option value="">Select employee</option>
                      {employees.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email}</option>)}
                    </select>
                  </label>
                  <label>Account Holder Name<input value={bankForm.account_holder_name} onChange={(e) => updateBank('account_holder_name', e.target.value)} /></label>
                  <label>Bank Name<input value={bankForm.bank_name} onChange={(e) => updateBank('bank_name', e.target.value)} /></label>
                  <label>Bank Account Number<input value={bankForm.bank_account_number} onChange={(e) => updateBank('bank_account_number', e.target.value)} /></label>
                  <label>IFSC Code<input value={bankForm.ifsc} onChange={(e) => updateBank('ifsc', e.target.value)} /></label>
                  <label>UPI ID (optional)<input value={bankForm.upi_id} onChange={(e) => updateBank('upi_id', e.target.value)} /></label>
                </div>
                <div className="vend-form__actions">
                  <button type="submit" className="vend-btn vend-btn--primary">Save Bank Details</button>
                </div>
              </fieldset>
            </form>
          </section>

          <section className="vend-card">
            <div className="vend-card__head">
              <Wallet size={18} />
              <div><h2>Salary Payments</h2><p>Record and disburse salaries through Cashfree.</p></div>
              <div className="vend-card__tools">
                <div className="vend-search"><Search size={14} /><input value={salarySearch} onChange={(e) => setSalarySearch(e.target.value)} placeholder="Search salaries…" /></div>
                <button type="button" className="vend-btn" onClick={() => exportCsv(filteredSalaries.map((s) => [s.employee_name, s.amount, s.period_start, s.period_end, s.status]), ['Employee', 'Amount', 'From', 'To', 'Status'], 'salaries.csv')}><Download size={14} /> Export</button>
              </div>
            </div>
            <form className="vend-form" onSubmit={saveSalary}>
              <fieldset disabled={busy}>
                <div className="vend-grid vend-grid--two">
                  <label>Employee *
                    <select value={salaryForm.user} onChange={(e) => updateSalary('user', e.target.value)}>
                      <option value="">Select employee</option>
                      {employees.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email}</option>)}
                    </select>
                  </label>
                  <label>Amount (₹) *<input type="number" min="0" step="0.01" value={salaryForm.amount} onChange={(e) => updateSalary('amount', e.target.value)} /></label>
                  <label>Period From<input type="date" value={salaryForm.period_start} onChange={(e) => updateSalary('period_start', e.target.value)} /></label>
                  <label>Period To<input type="date" value={salaryForm.period_end} onChange={(e) => updateSalary('period_end', e.target.value)} /></label>
                  <label>Reference<input value={salaryForm.reference} onChange={(e) => updateSalary('reference', e.target.value)} /></label>
                  <label className="vend-span">Notes<input value={salaryForm.notes} onChange={(e) => updateSalary('notes', e.target.value)} /></label>
                </div>
                <div className="vend-form__actions">
                  <button type="submit" className="vend-btn vend-btn--primary">{editingSalary ? 'Update Salary' : 'Record Salary'}</button>
                  {editingSalary && <button type="button" className="vend-btn" onClick={() => { setEditingSalary(null); setSalaryForm(emptySalary()); }}>Cancel</button>}
                </div>
              </fieldset>
            </form>
            <div className="vend-table-wrap">
              <table className="vend-table">
                <thead><tr><th>#</th><th>Employee</th><th>Amount (₹)</th><th>Period</th><th>Status</th><th>Payout</th><th>Action</th></tr></thead>
                <tbody>
                  {filteredSalaries.map((row, index) => (
                    <tr key={row.payment_id}>
                      <td>{index + 1}</td>
                      <td><b>{row.employee_name || employeeName(row.user)}</b></td>
                      <td className="vend-mono">{money(row.amount)}</td>
                      <td>{row.period_start || '—'} → {row.period_end || '—'}</td>
                      <td><Pill tone={row.status === 'PAID' ? 'success' : row.status === 'FAILED' ? 'danger' : 'warning'}>{row.status}</Pill></td>
                      <td>
                        <Pill tone={row.payout_status === 'SUCCESS' ? 'success' : row.payout_status === 'FAILED' ? 'danger' : 'warning'}>
                          {row.payout_channel === 'CASHFREE' ? (row.payout_status || 'PENDING') : 'Manual'}
                        </Pill>
                        {row.transfer_id && <div className="vend-mono" style={{ marginTop: 3, fontSize: 10 }}>{row.transfer_id}</div>}
                      </td>
                      <td className="vend-actions">
                        <button type="button" title="Pay via Cashfree" disabled={Boolean(busyId)} onClick={() => runPayoutAction('salary', row, 'pay')}><Wallet size={13} /></button>
                        {row.payout_channel === 'CASHFREE' && (
                          <button type="button" title="Refresh payout status" disabled={Boolean(busyId)} onClick={() => runPayoutAction('salary', row, 'sync-payout')}><CheckCircle2 size={13} /></button>
                        )}
                        <button type="button" title="Edit" onClick={() => startEditSalary(row)}><Pencil size={13} /></button>
                        <button type="button" title="Delete" onClick={() => removeSalary(row)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  ))}
                  {!filteredSalaries.length && <tr><td colSpan={7} className="vend-empty">No salary records yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="vend-card__foot">Showing {filteredSalaries.length} of {salaries.length} salary records</div>
          </section>
        </>
      )}
    </div>
  );
}
