import { fetchApi, unwrapList } from '../api/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isLocationId = (v) => UUID_RE.test(String(v || '').trim());

/**
 * Turn whatever an operator scanned into a bin's Location.location_id.
 *
 * Nearly every stock endpoint keys stock by `container_ref`, which stores a
 * bin's Location.location_id — a human bin code ("A-01-01-01") or a printed
 * barcode is *not* that value, so it has to be resolved through
 * /network/locations (search covers barcode, aisle and rack) first.
 *
 * @returns {Promise<{location_id: string, site_id: string, label: string}
 *                  | {candidates: Array, label: string} | null>}
 */
export async function resolveBin(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;

  if (isLocationId(value)) {
    return { location_id: value, site_id: null, label: value };
  }

  const found = unwrapList(await fetchApi(
    `/network/locations/?search=${encodeURIComponent(value)}&location_type=BIN&limit=50`
  ));
  if (!Array.isArray(found) || found.length === 0) return null;

  // /network/locations?search= is a fuzzy lookup across barcode, aisle and rack,
  // so scanning a coordinate like "A-01-01-01" can return several partial hits.
  // Narrow those down locally before asking the operator to choose.
  const upper = value.toUpperCase();
  const coordinatesOf = (loc) =>
    [loc.aisle, loc.rack, loc.level, loc.position]
      .filter(Boolean)
      .join('-')
      .toUpperCase();

  const exactBarcode = found.filter(l => String(l.barcode || '').toUpperCase() === upper);
  const exactCoords = found.filter(l => coordinatesOf(l) === upper);
  const resolved = exactBarcode.length === 1
    ? exactBarcode
    : exactCoords.length === 1
      ? exactCoords
      : found;

  if (resolved.length === 1) {
    return {
      location_id: resolved[0].location_id,
      site_id: resolved[0].site || null,
      label: resolved[0].barcode || coordinatesOf(resolved[0]) || resolved[0].location_id,
      location: resolved[0],
    };
  }
  return { candidates: resolved, label: value };
}

/** Human label for a bin: prefers the coordinate string, then the barcode. */
export function binLabel(loc) {
  if (!loc) return '';
  const bits = [loc.aisle, loc.rack, loc.level, loc.position].filter(Boolean);
  return bits.length === 4 ? bits.join('-') : (loc.barcode || loc.location_id || '');
}
