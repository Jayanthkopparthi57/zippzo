import React, { useEffect, useMemo, useRef } from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
// The published prop types merge every platform's interface (iOS ∪ Android ∪
// Windows), which collapses to `never` in strict mode. The runtime component
// is a plain FunctionComponent — accept the pragmatic cast.
const NativeWebView = WebView as unknown as React.ComponentType<any>;
import { C } from '../components/Ui';

/**
 * Embedded OpenStreetMap (Leaflet) map for the active delivery job.
 *
 * Why Leaflet via WebView rather than a native map SDK: the fleet is a
 * different LAN every day and a Google Maps API key is not always available
 * in dev builds. OSM tiles need no key. If the CDN or tiles ever fail, the
 * card still shows the address and the Navigate button opens Google Maps —
 * the map must never be the only way to the door.
 */

const MAP_HTML = (
  dest: { lat: number; lng: number } | null,
  address: string,
) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>Delivery map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #ececef; }
  .pin { display: flex; align-items: center; justify-content: center; }
  .rider { width: 16px; height: 16px; border-radius: 50%; background: #6d4aff; border: 3px solid #ffffff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
  .dest { transform: translateY(-2px); }
  .dest-dot { width: 26px; height: 26px; border-radius: 50% 50% 50% 2px; background: #6d4aff; border: 2px solid #ffffff; transform: rotate(-45deg); box-shadow: 0 2px 4px rgba(0,0,0,.4); }
  .dest-inner { width: 8px; height: 8px; border-radius: 50%; background: #ffffff; margin: 6px; }
  .fallback { position: absolute; bottom: 8px; left: 8px; right: 8px; background: rgba(255,255,255,.92); border-radius: 8px; padding: 6px 10px; font: 600 11px/1.35 system-ui, sans-serif; color: #3f3f46; }
</style>
</head>
<body>
<div id="map"></div>
<div class="fallback" id="fb" style="display:none">Could not load map tiles — the address is shown below.</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const DEST = ${dest ? `{ lat: ${dest.lat}, lng: ${dest.lng} }` : 'null'};
  const ADDRESS = ${JSON.stringify(address || '').replace(/</g, '\\u003c')};
  let map, riderMarker, destMarker, path, fitted = false;
  const fallback = document.getElementById('fb');

  function init() {
    if (!window.L) { fallback.style.display = 'block'; return; }
    const start = DEST || { lat: 19.076, lng: 72.8777 };
    map = L.map('map', { zoomControl: true, attributionControl: false }).setView([start.lat, start.lng], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
    }).on('tileerror', () => { fallback.style.display = 'block'; }).addTo(map);

    if (DEST) {
      destMarker = L.marker([DEST.lat, DEST.lng], {
        icon: L.divIcon({ className: 'pin', html: '<div class="dest"><div class="dest-dot"><div class="dest-inner"></div></div></div>', iconSize: [26, 26], iconAnchor: [13, 22] }),
      }).addTo(map);
      destMarker.bindPopup('Drop point' + (ADDRESS ? ' — ' + ADDRESS : ''));
      if (!window.innerWidth) { /* noop */ }
    }
    map.on('click', () => { /* nothing */ });
  }

  window.setRider = function (lat, lng) {
    if (!map || !window.L) return;
    const ll = [lat, lng];
    if (!riderMarker) {
      riderMarker = L.marker(ll, {
        icon: L.divIcon({ className: 'pin', html: '<div class="rider"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      }).addTo(map);
    } else {
      riderMarker.setLatLng(ll);
    }
    if (DEST) {
      if (!path) {
        path = L.polyline([ll, [DEST.lat, DEST.lng]], { color: '#6d4aff', weight: 3, dashArray: '6 8', opacity: 0.85 }).addTo(map);
      } else {
        path.setLatLngs([ll, [DEST.lat, DEST.lng]]);
      }
      if (!fitted) {
        map.fitBounds(L.latLngBounds([ll, [DEST.lat, DEST.lng]]).pad(0.3));
        fitted = true;
      }
    } else {
      map.setView(ll, 15);
    }
  };

  init();
</script>
</body>
</html>`;

export default function RiderMap({
  riderLat,
  riderLng,
  destLat,
  destLng,
  address,
}: {
  riderLat?: number | null;
  riderLng?: number | null;
  destLat?: number | null;
  destLng?: number | null;
  address?: string;
}) {
  const webRef = useRef<WebView>(null);
  const dest = Number.isFinite(destLat) && Number.isFinite(destLng)
    ? { lat: Number(destLat), lng: Number(destLng) }
    : null;

  const html = useMemo(() => MAP_HTML(dest, address || ''), [dest?.lat, dest?.lng, address]);

  useEffect(() => {
    if (webRef.current && Number.isFinite(riderLat) && Number.isFinite(riderLng)) {
      webRef.current.injectJavaScript(
        `window.setRider && window.setRider(${riderLat}, ${riderLng}); true;`,
      );
    }
  }, [riderLat, riderLng]);

  const nav = () => {
    const url = dest
      ? `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || '')}`;
    Linking.openURL(url).catch(() => undefined);
  };

  if (!dest) return null;

  return (
    <View style={s.wrap}>
      <NativeWebView
        ref={webRef}
        style={s.map}
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
      />
      <TouchableOpacity style={s.navBtn} onPress={nav} activeOpacity={0.85} accessibilityLabel="Open in Google Maps">
        <Ionicons name="navigate" size={13} color="#ffffff" />
        <Text style={s.navText}>Navigate</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { borderRadius: 13, overflow: 'hidden', borderWidth: 1, borderColor: C.border, marginTop: 10, backgroundColor: '#ececef' },
  map: { width: '100%', height: 180 },
  navBtn: {
    position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', gap: 5,
    alignItems: 'center', backgroundColor: '#6d4aff', borderRadius: 999,
    paddingHorizontal: 11, paddingVertical: 7,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  navText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
});
