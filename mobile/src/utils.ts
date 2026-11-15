import { LocationBin, PutawayTaskDetail, Sku } from './types';

export function norm(s?: string | number | null): string {
  return String(s ?? '').trim().toLowerCase();
}

// Does a scanned string identify this SKU? Check sku_code, ean and any barcode form.
export function skuMatches(code: string, sku?: Partial<Sku> | null, extra?: string[]): boolean {
  const c = norm(code);
  if (!c || !sku) return false;
  const candidates = [sku.sku_code, sku.ean, ...(extra || [])].map(norm).filter(Boolean);
  return candidates.includes(c);
}

// Does a scanned string identify this bin?
export function binMatches(code: string, bin?: Partial<LocationBin> | null): boolean {
  const c = norm(code);
  if (!c || !bin) return false;
  const candidates = [bin.barcode, bin.location_id, bin.label].map(norm).filter(Boolean);
  return candidates.includes(c);
}

export function isToday(iso?: string): boolean {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  } catch {
    return false;
  }
}

/**
 * Rank bins for a product: prefer bins whose zone/category aligns with the
 * SKU category / storage zone, then bins with free space, then emptiest.
 * Returns a sorted copy (best first). Pure client-side — no extra request.
 */
export function rankBins(bins: LocationBin[], opts: { categoryName?: string | null; storageZone?: string | null; needQty?: number }): LocationBin[] {
  const cat = norm(opts.categoryName || '');
  const zone = norm(opts.storageZone || '');
  const need = opts.needQty ?? 1;
  const score = (b: LocationBin): number => {
    let s = 0;
    const bZone = norm(b.zone || '');
    const bCat = norm((b as any).category || '');
    const bProductType = norm((b as any).product_type || '');
    const bFoodType = norm((b as any).food_type || '');
    // Category / zone alignment dominates.
    if (cat && (bZone === cat || bCat === cat || bProductType === cat || bFoodType === cat)) s += 100;
    if (zone && (bZone === zone || bCat === zone)) s += 80;
    // Free space matters.
    const free = b.free_qty;
    const occupies = b.occupied_qty ?? 0;
    if (free === null || free === undefined) s += 20;
    else if (free >= need) s += 30;
    else s -= 50;
    // Prefer bins that already hold this category (commingling) and emptier bins.
    s -= Math.min(occupies, 50) / 10;
    // Prefer sellable bins for saleable stock.
    if (b.is_sellable_bin) s += 5;
    return s;
  };
  return [...bins].sort((a, b) => score(b) - score(a));
}

export function suggestedBinFor(task: PutawayTaskDetail, bins: LocationBin[]): LocationBin | null {
  if (!bins.length) return null;
  // Honour a server-suggested bin when it exists and has space.
  if (task.suggested_bin) {
    const hit = bins.find((b) => norm(b.location_id) === norm(task.suggested_bin) || norm(b.barcode) === norm(task.suggested_bin));
    if (hit) return hit;
  }
  const ranked = rankBins(bins, {
    categoryName: task.category_name ?? null,
    storageZone: task.storage_zone ?? null,
    needQty: task.remaining_qty || task.qty || 1,
  });
  return ranked[0] || null;
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
