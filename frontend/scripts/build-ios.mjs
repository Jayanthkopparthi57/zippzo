#!/usr/bin/env node
/** Build and synchronize one warehouse or dark-store Capacitor iOS app. */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeWeb = join(frontend, 'dist-ios');
const iosProject = join(frontend, 'ios');
const product = process.argv[3] || 'wms';
const productConfig = product === 'darkstore' ? 'capacitor.ios.darkstore.json' : 'capacitor.ios.store.json';
const iosConfig = join(frontend, productConfig);
const liveConfig = join(frontend, 'capacitor.config.json');
const plist = join(iosProject, 'App', 'App', 'Info.plist');
const mode = process.argv[2] || 'sync';

if (!['sync', 'build'].includes(mode) || !['wms', 'darkstore'].includes(product)) {
  console.error('Usage: node scripts/build-ios.mjs [sync|build] [wms|darkstore]');
  process.exit(2);
}

const apiBase = String(process.env.IOS_API_BASE_URL || '').trim();
if (!apiBase) {
  console.error('Set IOS_API_BASE_URL to the HTTPS API base, for example https://api.example.com/api');
  process.exit(2);
}
let parsedApi;
try {
  parsedApi = new URL(apiBase);
} catch {
  console.error('IOS_API_BASE_URL must be an absolute URL.');
  process.exit(2);
}
if (parsedApi.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedApi.hostname)) {
  console.error('iOS requires HTTPS for remote API hosts. HTTP is allowed only for localhost development.');
  process.exit(2);
}

function run(command, args, label, env = process.env) {
  console.log(`\n[ios] ${label}`);
  const result = spawnSync(command, args, {
    cwd: frontend,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`[ios] ${label} failed (exit ${result.status ?? 'unknown'})`);
    process.exit(result.status ?? 1);
  }
}

const viteEnv = { ...process.env, VITE_API_BASE: apiBase };
run('npx', ['vite', 'build', '--mode', 'ios', '--outDir', 'dist-ios'], 'Build iOS web bundle', viteEnv);

// Capacitor loads index.html. Keep only the selected facility product entry.
const selectedHtml = product === 'darkstore' ? 'darkstore.html' : 'operations-app.html';
const htmlFiles = readdirSync(nativeWeb).filter((name) => name.endsWith('.html'));
const references = (html) =>
  [...html.matchAll(/(?:src|href)="\/assets\/([^\"]+)"/g)].map((match) => match[1]);
const selectedAssets = new Set(references(readFileSync(join(nativeWeb, selectedHtml), 'utf8')));
const siblingAssets = new Set();
for (const name of htmlFiles) {
  if (name === selectedHtml) continue;
  for (const asset of references(readFileSync(join(nativeWeb, name), 'utf8'))) {
    if (!selectedAssets.has(asset)) siblingAssets.add(asset);
  }
}
for (const asset of siblingAssets) {
  const filename = asset.split('/').at(-1);
  if (/^(?:entry|rider|darkStore)-/.test(filename) && /\.(?:js|css)$/.test(filename)) {
    rmSync(join(nativeWeb, 'assets', filename), { force: true });
  }
}
for (const name of htmlFiles) {
  if (name !== selectedHtml) rmSync(join(nativeWeb, name), { force: true });
}
if (selectedHtml !== 'index.html') {
  rmSync(join(nativeWeb, 'index.html'), { force: true });
  writeFileSync(join(nativeWeb, 'index.html'), readFileSync(join(nativeWeb, selectedHtml)));
  rmSync(join(nativeWeb, selectedHtml), { force: true });
}

copyFileSync(iosConfig, liveConfig);
if (!existsSync(iosProject)) {
  run('npx', ['cap', 'add', 'ios'], 'Create Capacitor iOS project');
}
run('npx', ['cap', 'sync', 'ios'], `Sync ${product} app into iOS project`);

// WKWebView asks iOS for camera authorization when the barcode camera opens.
if (!existsSync(plist)) {
  console.error(`Expected iOS Info.plist at ${plist}`);
  process.exit(1);
}
let plistText = readFileSync(plist, 'utf8');
if (!plistText.includes('<key>NSCameraUsageDescription</key>')) {
  plistText = plistText.replace(
    '<dict>',
    '<dict>\n\t<key>NSCameraUsageDescription</key>\n\t<string>Use the camera to scan product, tote, and location barcodes for warehouse tasks.</string>',
  );
  writeFileSync(plist, plistText);
}

if (mode === 'sync') {
  console.log('\n[ios] Project synchronized. Open frontend/ios/App/App.xcodeproj in Xcode to run on a simulator or device.');
  if (process.platform !== 'darwin') {
    console.log('[ios] Xcode is only available on macOS; the native build step was not run.');
  }
  process.exit(0);
}

if (process.platform !== 'darwin') {
  console.error('[ios] xcodebuild requires macOS with Xcode installed. The project is synced, but an IPA cannot be built on this host.');
  process.exit(2);
}
const derivedData = join(frontend, 'build', 'ios-derived');
mkdirSync(resolve(derivedData), { recursive: true });
run('xcodebuild', [
  '-project', join(iosProject, 'App', 'App.xcodeproj'),
  '-scheme', 'App',
  '-configuration', 'Debug',
  '-sdk', 'iphonesimulator',
  '-derivedDataPath', derivedData,
  'build',
], 'Build iOS simulator app');
console.log(`[ios] Simulator build output: ${join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator')}`);
