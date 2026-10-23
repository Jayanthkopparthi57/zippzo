import React from 'react';
import StatusBadge from '../../components/ui/StatusBadge';
import LedgerScreen from '../ledgers/LedgerScreen';

/**
 * Outbound Ledger: picks, packs and the two kinds of transfer, with actors.
 *
 * The outbound answer to "who moved them" has three different verbs —
 * picking stamps started_by/completed_by, packing stamps completed_by,
 * transfers stamp created_by/dispatched_by — so the screen separates them
 * into feeds rather than pretending one actor column explains all of it.
 *
 * The transfer feeds also resolve the source/destination site codes: a lane
 * between two UUIDs is not something a supervisor can audit.
 */

const OUTBOUND_FEEDS = [
  {
    id: 'picks',
    label: 'Picks',
    hint: 'Who picked each line — started_by / completed_by from the token',
    endpoint: '/ds-ops/pick-tasks/',
    actorParam: 'completed_by',
    columns: ({ maps, fmtWhen, shortId }) => [
      { header: 'Pick', render: (r) => shortId(r.id) },
      { header: 'Order', render: (r) => (maps.orders[r.order] || shortId(r.order)) },
      { header: 'SKU', render: (r) => (maps.skus[r.sku] || shortId(r.sku)) },
      {
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} dataTestId="obl-status-badge" />,
      },
      {
        header: 'Picked',
        align: 'right',
        render: (r) => `${r.picked_qty}/${r.qty}`,
      },
      { header: 'Worker', render: (r) => r.assigned_to_name || '—' },
      { header: 'Completed by', render: (r) => r.completed_by_name || '—' },
      { header: 'Completed at', render: (r) => fmtWhen(r.completed_at) },
    ],
  },
  {
    id: 'packs',
    label: 'Packs',
    hint: 'Who packed each tote — completed_by stamped by the pack action',
    endpoint: '/ds-ops/pack-tasks/',
    actorParam: 'completed_by',
    columns: ({ maps, fmtWhen, shortId }) => [
      { header: 'Pack', render: (r) => shortId(r.id) },
      { header: 'Order', render: (r) => (maps.orders[r.order] || shortId(r.order)) },
      { header: 'SKU', render: (r) => (maps.skus[r.sku] || shortId(r.sku)) },
      {
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} dataTestId="obl-status-badge" />,
      },
      {
        header: 'Packed',
        align: 'right',
        render: (r) => `${r.packed_qty}/${r.qty}`,
      },
      { header: 'Worker', render: (r) => r.assigned_to_name || '—' },
      { header: 'Completed by', render: (r) => r.completed_by_name || '—' },
      { header: 'Completed at', render: (r) => fmtWhen(r.completed_at) },
    ],
  },
  {
    id: 'transfers',
    label: 'Transfer Orders',
    hint: 'Who raised each transfer, and who put it on the road',
    endpoint: '/ds-ops/transfer-orders/',
    actorParam: 'dispatched_by',
    columns: ({ maps, fmtWhen, shortId }) => [
      { header: 'Transfer', render: (r) => shortId(r.transfer_id) },
      {
        header: 'Lane',
        render: (r) => `${maps.sites[r.source_site] || shortId(r.source_site)} → ${
          maps.sites[r.dest_site] || shortId(r.dest_site)}`,
      },
      {
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} dataTestId="obl-status-badge" />,
      },
      { header: 'Units', key: 'total_qty', align: 'right' },
      { header: 'Raised by', render: (r) => r.created_by_name || '—' },
      { header: 'Dispatched by', render: (r) => r.dispatched_by_name || '—' },
      { header: 'Created at', render: (r) => fmtWhen(r.created_at) },
    ],
  },
  {
    id: 'bins',
    label: 'Bin Transfers',
    hint: 'Who requested each bin move, and who executed it',
    endpoint: '/ds-ops/bin-transfers/',
    actorParam: 'completed_by',
    columns: ({ fmtWhen }) => [
      { header: 'Source bin', key: 'source_bin', isCode: true },
      { header: 'Target bin', key: 'dest_bin', isCode: true },
      {
        header: 'Status',
        render: (r) => <StatusBadge status={r.status} dataTestId="obl-status-badge" />,
      },
      { header: 'Requested by', render: (r) => r.created_by_name || '—' },
      { header: 'Completed by', render: (r) => r.completed_by_name || '—' },
      { header: 'Created at', render: (r) => fmtWhen(r.created_at) },
    ],
  },
];

export default function OutboundLedgerView() {
  return (
    <LedgerScreen
      prefix="obl"
      title="Outbound Ledger"
      subtitle="Picks, packs and transfers — who did what, and when"
      feeds={OUTBOUND_FEEDS}
      initialFeed="picks"
      indexes={['staff', 'sites', 'skus', 'orders']}
    />
  );
}
