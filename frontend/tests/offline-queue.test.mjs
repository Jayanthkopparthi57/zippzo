import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Mock browser globals (window, localStorage, CustomEvent, navigator)
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};

const eventListeners = new Map();
globalThis.window = {
  localStorage: globalThis.localStorage,
  dispatchEvent: (event) => {
    const list = eventListeners.get(event.type) || [];
    list.forEach(fn => fn(event));
    return true;
  },
  addEventListener: (type, fn) => {
    const list = eventListeners.get(type) || [];
    list.push(fn);
    eventListeners.set(type, list);
  },
  removeEventListener: (type, fn) => {
    const list = eventListeners.get(type) || [];
    eventListeners.set(type, list.filter(cb => cb !== fn));
  },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};
try {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
} catch {
  // navigator already defined
}

// Import the module under test
const {
  enqueueScanAction,
  flushOfflineQueue,
  readStoredQueue,
  clearScanQueue,
  dismissRejectedScan,
  retryRejectedScan,
  getQueueStats,
  STORAGE_KEY_OFFLINE_SCAN_QUEUE,
  EVENT_QUEUE_UPDATED,
} = await import('../src/api/offlineQueue.js');

const { ApiError } = await import('../src/api/client.js');

describe('Offline Scan Queue & Recovery Test Suite', () => {
  beforeEach(() => {
    clearScanQueue();
  });

  test('1. Durability: Queued scans persist to storage and survive reload/restart', () => {
    const item = enqueueScanAction({
      actionType: 'PICK_SCAN',
      endpoint: '/ds-ops/pick-line/',
      payload: { order_id: 'ORD-101', barcode: '8888888888881', qty: 1 },
      label: 'SKU-001 at BIN-A1',
      autoFlush: false,
    });

    assert.ok(item.id.startsWith('SQ-'));
    assert.ok(item.payload.scan_id.startsWith('SCN-'));
    assert.equal(item.status, 'QUEUED');

    // Simulate page reload / process restart: read from storage
    const raw = globalThis.localStorage.getItem(STORAGE_KEY_OFFLINE_SCAN_QUEUE);
    assert.ok(raw);
    const restored = JSON.parse(raw);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, item.id);
    assert.equal(restored[0].payload.scan_id, item.payload.scan_id);
    assert.equal(restored[0].label, 'SKU-001 at BIN-A1');
  });

  test('2. Replay & Success: Flush commits queued items via API in FIFO order', async () => {
    enqueueScanAction({
      actionType: 'PICK_SCAN',
      endpoint: '/ds-ops/pick-line/',
      payload: { barcode: 'BC-1', scan_id: 'SCAN-UUID-1' },
      autoFlush: false,
    });
    enqueueScanAction({
      actionType: 'PACK_SCAN',
      endpoint: '/inventory/lpn-contents/',
      payload: { barcode: 'BC-2', scan_id: 'SCAN-UUID-2' },
      autoFlush: false,
    });

    const calls = [];
    const mockPost = async (url, payload) => {
      calls.push({ url, payload });
      return { success: true };
    };

    const result = await flushOfflineQueue({ postApi: mockPost });
    assert.equal(result.processed, 2);
    assert.equal(result.successes, 2);
    assert.equal(result.rejections, 0);

    // Verify FIFO execution order
    assert.equal(calls.length, 2);
    assert.equal(calls[0].payload.scan_id, 'SCAN-UUID-1');
    assert.equal(calls[1].payload.scan_id, 'SCAN-UUID-2');

    // Queue is cleared after successful replay
    assert.equal(readStoredQueue().length, 0);
  });

  test('3. Idempotency: 409 already_applied resolves cleanly without duplicate stock moves', async () => {
    enqueueScanAction({
      actionType: 'PICK_SCAN',
      endpoint: '/ds-ops/pick-line/',
      payload: { barcode: 'BC-1', scan_id: 'SCAN-RETRY-01' },
      autoFlush: false,
    });

    // Mock API returning 409 already_applied (server already processed scan in prior dropped attempt)
    const mockPost = async () => {
      throw new ApiError('Conflict', {
        status: 409,
        body: { already_applied: true, detail: 'Scan already processed' },
      });
    };

    const result = await flushOfflineQueue({ postApi: mockPost });
    assert.equal(result.successes, 1);
    assert.equal(result.rejections, 0);

    // Resolved cleanly — queue is empty
    assert.equal(readStoredQueue().length, 0);
  });

  test('4. Conflict & Rejection: 400 validation error flags item as REJECTED for operator review', async () => {
    enqueueScanAction({
      actionType: 'PICK_SCAN',
      endpoint: '/ds-ops/pick-line/',
      payload: { barcode: 'WRONG-BARCODE', scan_id: 'SCAN-BAD-01' },
      label: 'WRONG-BARCODE',
      autoFlush: false,
    });

    const mockPost = async () => {
      throw new ApiError('Bad Request', {
        status: 400,
        body: { error: 'Product WRONG-BARCODE is not on this order.' },
      });
    };

    const result = await flushOfflineQueue({ postApi: mockPost });
    assert.equal(result.processed, 1);
    assert.equal(result.successes, 0);
    assert.equal(result.rejections, 1);

    // Item must remain in storage with REJECTED status and clear error
    const stored = readStoredQueue();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].status, 'REJECTED');
    assert.equal(stored[0].errorCode, 400);
    assert.equal(stored[0].error, 'Product WRONG-BARCODE is not on this order.');

    // Operator can dismiss
    dismissRejectedScan(stored[0].id);
    assert.equal(readStoredQueue().length, 0);
  });

  test('5. Rejection Retry: Operator can retry rejected scan after addressing conflict', async () => {
    enqueueScanAction({
      actionType: 'PUTAWAY_SCAN',
      endpoint: '/supply/putaway-tasks/1/place/',
      payload: { bin: 'BIN-OVERFULL' },
      autoFlush: false,
    });

    // 1. Initial attempt fails with 400 Bin Capacity Exceeded
    await flushOfflineQueue({
      postApi: async () => {
        throw new ApiError('Capacity error', {
          status: 400,
          body: { error: 'Bin capacity exceeded' },
        });
      },
    });

    let queue = readStoredQueue();
    assert.equal(queue[0].status, 'REJECTED');
    const rejectedId = queue[0].id;

    // 2. Operator retries scan
    retryRejectedScan(rejectedId, { autoFlush: false });
    queue = readStoredQueue();
    assert.equal(queue[0].status, 'QUEUED');
    assert.equal(queue[0].error, null);

    // 3. Second flush succeeds
    const result = await flushOfflineQueue({
      postApi: async () => ({ success: true }),
    });
    assert.equal(result.successes, 1);
    assert.equal(readStoredQueue().length, 0);
  });

  test('6. Network Disconnect: Transient network failure halts queue without losing items', async () => {
    enqueueScanAction({
      actionType: 'PICK_SCAN',
      endpoint: '/ds-ops/pick-line/',
      payload: { barcode: 'BC-1' },
      autoFlush: false,
    });
    enqueueScanAction({
      actionType: 'PICK_SCAN',
      endpoint: '/ds-ops/pick-line/',
      payload: { barcode: 'BC-2' },
      autoFlush: false,
    });

    // Network drops (TypeError / Network error)
    const mockPost = async () => {
      throw new ApiError('Network error: Failed to fetch', { status: undefined });
    };

    const result = await flushOfflineQueue({ postApi: mockPost });
    assert.equal(result.successes, 0);
    assert.equal(result.rejections, 0);

    // Both items remain safely in the queue as QUEUED for when network recovers
    const queue = readStoredQueue();
    assert.equal(queue.length, 2);
    assert.equal(queue[0].status, 'QUEUED');
    assert.equal(queue[1].status, 'QUEUED');
  });

  test('7. Statistics & Events: getQueueStats and update event accurately reflect state', () => {
    let eventReceived = null;
    const unsub = (e) => { eventReceived = e.detail; };
    globalThis.window.addEventListener(EVENT_QUEUE_UPDATED, unsub);

    enqueueScanAction({ actionType: 'PICK', endpoint: '/a', payload: {}, autoFlush: false });
    assert.ok(eventReceived);
    assert.equal(eventReceived.items.length, 1);

    const stats = getQueueStats();
    assert.equal(stats.total, 1);
    assert.equal(stats.pending, 1);
    assert.equal(stats.rejected, 0);
  });
});
