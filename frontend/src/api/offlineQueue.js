/**
 * Offline Scan Queue & Retry Manager
 *
 * Designed for warehouse and dark-store floor operations where handheld scanners
 * or mobile devices move through Wi-Fi dead-zones (metal aisles, cold rooms).
 *
 * Key guarantees:
 * 1. Durability: Queued actions are persisted to localStorage so they survive
 *    browser tab reload, app restart, and device power cycles.
 * 2. Idempotency: Every scan action carries a unique client scan_id / idempotency_key.
 *    Replaying a scan that already landed on the server resolves cleanly (409 / already_applied)
 *    rather than duplicating inventory or pick counts.
 * 3. Conflict Visibility: Real business rejections (e.g. 400 wrong bin, overpack,
 *    insufficient stock) are NOT silently discarded; they are flagged as REJECTED
 *    with the server's rejection reason so the operator can inspect and resolve them.
 * 4. Automatic Recovery: Listens for window 'online' and 'zippzo:live-event' (reconnected)
 *    to flush pending scans in FIFO order as soon as connectivity is restored.
 */

import { postApi, patchApi, describeError, ApiError } from './client.js';

export const STORAGE_KEY_OFFLINE_SCAN_QUEUE = 'zippzo_offline_scan_queue_v1';
export const EVENT_QUEUE_UPDATED = 'zippzo:scan-queue-updated';

function generateId(prefix = 'SCAN') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${ts}-${rand}`;
}

export function readStoredQueue() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OFFLINE_SCAN_QUEUE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStoredQueue(items) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY_OFFLINE_SCAN_QUEUE, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent(EVENT_QUEUE_UPDATED, { detail: { items } }));
  } catch (err) {
    console.error('[OfflineQueue] Failed to write queue to localStorage:', err);
  }
}

/**
 * Enqueue a scan action to be committed to the backend.
 *
 * @param {Object} options
 * @param {string} options.actionType - 'PICK_SCAN', 'PUTAWAY_SCAN', 'PACK_SCAN', 'LPN_RECEIPT', etc.
 * @param {string} options.endpoint - REST endpoint (e.g. '/ds-ops/pick-scan/')
 * @param {'POST'|'PATCH'} [options.method='POST'] - HTTP method
 * @param {Object} options.payload - Request payload
 * @param {string} [options.label] - Human readable description for the operator UI
 * @returns {Object} The queued item record
 */
export function enqueueScanAction({
  actionType,
  endpoint,
  method = 'POST',
  payload = {},
  label = '',
  autoFlush = true,
}) {
  const queue = readStoredQueue();
  const id = generateId('SQ');
  const now = new Date().toISOString();

  // Ensure an idempotency key / scan_id is attached if missing
  const safePayload = { ...payload };
  if (!safePayload.scan_id && !safePayload.idempotency_key) {
    safePayload.scan_id = generateId('SCN');
  }

  const item = {
    id,
    actionType,
    endpoint,
    method: method.toUpperCase(),
    payload: safePayload,
    label: label || `${actionType} ${safePayload.barcode || safePayload.sku || ''}`.trim(),
    scannedAt: now,
    status: 'QUEUED', // 'QUEUED' | 'SYNCING' | 'REJECTED'
    retryCount: 0,
    error: null,
    errorCode: null,
  };

  queue.push(item);
  writeStoredQueue(queue);

  // If online and autoFlush is true, kick off a background flush
  if (autoFlush && typeof navigator !== 'undefined' && navigator.onLine) {
    flushOfflineQueue().catch(() => {});
  }

  return item;
}

let activeFlushPromise = null;

/**
 * Process all QUEUED items sequentially in FIFO order.
 *
 * Handled outcomes:
 * - 2xx Success: item is removed from queue.
 * - 409 / already_applied: treated as successful idempotent replay and removed.
 * - 400 / 404 / 422: business validation failure / conflict. Item status becomes 'REJECTED'
 *   with readable error message, preserved for operator review.
 * - Network failure / 5xx: item remains 'QUEUED', flush aborts until next recovery trigger.
 *
 * @param {Object} [deps] - Optional dependency overrides for testing (postFn, patchFn)
 * @returns {Promise<{ processed: number, successes: number, rejections: number }>}
 */
export async function flushOfflineQueue(deps = {}) {
  if (activeFlushPromise) return activeFlushPromise;

  const run = async () => {
    const post = deps.postApi || postApi;
    const patch = deps.patchApi || patchApi;

    let processed = 0;
    let successes = 0;
    let rejections = 0;

    const queue = readStoredQueue();
    const remaining = [];

    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];

      // Keep already REJECTED items in place until operator resolves/dismisses them
      if (item.status === 'REJECTED') {
        remaining.push(item);
        continue;
      }

      processed += 1;
      item.status = 'SYNCING';
      item.retryCount = (item.retryCount || 0) + 1;
      writeStoredQueue([...remaining, item, ...queue.slice(i + 1)]);

      try {
        if (item.method === 'PATCH') {
          await patch(item.endpoint, item.payload);
        } else {
          await post(item.endpoint, item.payload);
        }
        // Success: do not add to remaining (it is resolved)
        successes += 1;
      } catch (err) {
        if (err instanceof ApiError) {
          // 409 Conflict: check if server reports already applied (idempotency replay)
          const isIdempotentConflict = err.status === 409 || (
            err.body && typeof err.body === 'object' && (
              err.body.already_applied === true ||
              err.body.idempotent_replay === true ||
              String(err.body.detail || '').toLowerCase().includes('already')
            )
          );

          if (isIdempotentConflict) {
            // Server already processed this scan during an earlier disconnected attempt.
            // Safe to mark resolved.
            successes += 1;
            continue;
          }

          if (err.status >= 400 && err.status < 500) {
            // Business rejection / validation conflict: keep item flagged for operator
            item.status = 'REJECTED';
            item.errorCode = err.status;
            item.error = describeError(err);
            remaining.push(item);
            rejections += 1;
            continue;
          }
        }

        // Network error or 5xx: keep item queued and stop flushing until online
        item.status = 'QUEUED';
        remaining.push(item);
        // Add all remaining unattempted items and abort
        remaining.push(...queue.slice(i + 1));
        break;
      }
    }

    writeStoredQueue(remaining);
    return { processed, successes, rejections };
  };

  activeFlushPromise = run().finally(() => {
    activeFlushPromise = null;
  });

  return activeFlushPromise;
}

/**
 * Remove a rejected item from the queue when dismissed by the operator.
 */
export function dismissRejectedScan(id) {
  const queue = readStoredQueue();
  const next = queue.filter(item => item.id !== id);
  writeStoredQueue(next);
}

/**
 * Retry a rejected scan (e.g. after operator fixes bin or stock condition).
 */
export function retryRejectedScan(id, { autoFlush = true } = {}) {
  const queue = readStoredQueue();
  const next = queue.map(item => {
    if (item.id === id) {
      return { ...item, status: 'QUEUED', error: null, errorCode: null };
    }
    return item;
  });
  writeStoredQueue(next);
  if (autoFlush && typeof navigator !== 'undefined' && navigator.onLine) {
    flushOfflineQueue().catch(() => {});
  }
}

/**
 * Clear all items from queue.
 */
export function clearScanQueue() {
  writeStoredQueue([]);
}

/**
 * Query current queue statistics.
 */
export function getQueueStats() {
  const queue = readStoredQueue();
  return {
    total: queue.length,
    pending: queue.filter(i => i.status === 'QUEUED' || i.status === 'SYNCING').length,
    rejected: queue.filter(i => i.status === 'REJECTED').length,
    items: queue,
  };
}

// Global auto-sync hooks
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => {
    flushOfflineQueue().catch(() => {});
  });

  window.addEventListener('zippzo:live-event', (e) => {
    if (e.detail?.type === 'reconnected') {
      flushOfflineQueue().catch(() => {});
    }
  });
}
