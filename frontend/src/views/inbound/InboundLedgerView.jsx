import React from 'react';
import StatusBadge from '../../components/ui/StatusBadge';
import LedgerScreen from '../ledgers/LedgerScreen';

/**
 * Inbound Ledger: every receipt-side document, with the person attached.
 *
 * Four feeds because inbound is four hand-offs — a consignment is raised,
 * received, inspected, and shelved — and each hand-off stamps a different
 * actor (created_by → received_by → tested_by → confirmed_by). Reading them
 * in one screen is how a supervisor answers "who received this, who signed
 * off QC, who put it away" without opening four queues.
 *
 * Every actor filter maps to that feed's own server-stamped column, so the
 * filter can never disagree with what the row shows.
 */

const INBOUND_FEEDS = [
  {
    id: 'asns',
    label: 'Consignments',
    hint: 'Who raised each consignment, and where it is bound',
    endpoint: '/supply/asns/',
    actorParam: 'created_by',
    columns: ({ maps, fmtWhen }) => [
      { header: 'ASN No', key: 'asn_no', isCode: true },
      {
        header: 'Type',
        key: 'type',
        render: (r) => String(r.type || '').replace(/_/g, ' '),
      },
      {
        header: 'Destination',
        render: (r) => (maps.sites[r.dest_site] || String(r.dest_site || '').slice(0, 8)),
      },
      {
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} dataTestId="ibl-status-badge" />,
      },
      { header: 'Created by', render: (r) => r.created_by_name || '—' },
      { header: 'Created at', render: (r) => fmtWhen(r.created_at) },
    ],
  },
  {
    id: 'grns',
    label: 'Receipts',
    hint: 'Who received the goods — stamped when the GRN closes',
    endpoint: '/supply/grns/',
    actorParam: 'received_by',
    columns: ({ maps, fmtWhen }) => [
      { header: 'GRN No', key: 'grn_no', isCode: true },
      {
        header: 'Consignment',
        render: (r) => (maps.asns[r.asn] || String(r.asn || '').slice(0, 8)),
      },
      {
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} dataTestId="ibl-status-badge" />,
      },
      { header: 'Raised by', render: (r) => r.created_by_name || '—' },
      { header: 'Received by', render: (r) => r.received_by_name || '—' },
      { header: 'Completed at', render: (r) => fmtWhen(r.completed_at) },
    ],
  },
  {
    id: 'qc',
    label: 'QC Inspections',
    hint: 'Who signed off each inspection, and when',
    endpoint: '/supply/qc-inspections/',
    actorParam: 'tested_by',
    dateParam: 'tested_at',
    columns: ({ fmtWhen, shortId }) => [
      { header: 'Inspection', render: (r) => shortId(r.qc_id) },
      {
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} dataTestId="ibl-status-badge" />,
      },
      { header: 'Sample', key: 'sample_size' },
      {
        header: 'Pass / Fail',
        render: (r) => `${r.pass_count} / ${r.fail_count}`,
      },
      { header: 'Tested by', render: (r) => r.tested_by_name || '—' },
      { header: 'Tested at', render: (r) => fmtWhen(r.tested_at) },
      {
        header: 'Remarks',
        render: (r) => r.remarks || '—',
        nowrap: false,
      },
    ],
  },
  {
    id: 'putaway',
    label: 'Putaway',
    hint: 'Who shelved the stock — stamped when putaway completes',
    endpoint: '/supply/putaway-tasks/',
    actorParam: 'confirmed_by',
    columns: ({ maps, fmtWhen, shortId }) => [
      { header: 'Task', render: (r) => shortId(r.task_id) },
      {
        header: 'SKU',
        render: (r) => (maps.skus[r.sku] || shortId(r.sku)),
      },
      {
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} dataTestId="ibl-status-badge" />,
      },
      { header: 'Qty', key: 'qty', align: 'right' },
      { header: 'Assigned to', render: (r) => r.assigned_to_name || '—' },
      { header: 'Shelved by', render: (r) => r.confirmed_by_name || '—' },
      { header: 'Completed at', render: (r) => fmtWhen(r.completed_at) },
    ],
  },
];

export default function InboundLedgerView() {
  return (
    <LedgerScreen
      prefix="ibl"
      title="Inbound Ledger"
      subtitle="Consignments, receipts, QC and putaway — who did what, and when"
      feeds={INBOUND_FEEDS}
      initialFeed="asns"
      indexes={['staff', 'sites', 'skus', 'asns']}
    />
  );
}
