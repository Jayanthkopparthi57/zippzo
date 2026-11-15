import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'zippzo_pending_actions';

export interface PendingAction {
  id: string;
  idempotencyKey: string;
  endpoint: string;
  method: string;
  body: unknown;
  createdAt: number;
  status: 'pending' | 'failed';
  error?: string;
}

export async function readQueue(): Promise<PendingAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function writeQueue(items: PendingAction[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export async function enqueue(action: Omit<PendingAction, 'id' | 'createdAt' | 'status'>): Promise<PendingAction> {
  const item: PendingAction = {
    ...action,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
    status: 'pending',
  };
  const items = await readQueue();
  items.push(item);
  await writeQueue(items);
  return item;
}

export async function removeAction(id: string) {
  const items = await readQueue();
  await writeQueue(items.filter((i) => i.id !== id));
}

export async function markFailed(id: string, error: string) {
  const items = await readQueue();
  const next = items.map((i) => (i.id === id ? { ...i, status: 'failed' as const, error } : i));
  await writeQueue(next);
}

export async function flushQueue(token: string | null, requestFn: (item: PendingAction, token: string | null) => Promise<void>) {
  const items = await readQueue();
  for (const item of items) {
    if (item.status === 'failed') continue;
    try {
      await requestFn(item, token);
      await removeAction(item.id);
    } catch (err: any) {
      // A 4xx means the server rejected it for a business reason; keep it as
      // failed so the operator can review rather than silently retry forever.
      if (err?.status && err.status >= 400 && err.status < 500) {
        await markFailed(item.id, err?.body?.error || err?.message || 'Rejected');
      }
      // Network/5xx: leave pending for the next reconnect.
    }
  }
}
