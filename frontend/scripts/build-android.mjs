#!/usr/bin/env node
/**
 * Build one Android APK per Zippzo application from the single web tree.
 *
 * Vite emits all three HTML entries into dist/ in one pass, but Capacitor
 * always copies webDir into android/app/src/main/assets/public — a path every
 * Gradle flavor shares. So for each app this script:
 *
 *   1. syncs that app's Capacitor config (which also writes its own
 *      capacitor.config.json into the assets, so plugins see the right appId)
 *   2. moves the freshly synced bundle out of main/assets into
 *      src/<flavor>/assets, which only that flavor packages
 *   3. asks Gradle to assemble that flavor
 *
 * Usage:
 *   node scripts/build-android.mjs                 # all three
 *   node scripts/build-android.mjs rider           # one
 *   node scripts/build-android.mjs --release       # release instead of debug
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, existsSync, renameSync, copyFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidApp = join(frontend, 'android', 'app');
const sharedAssets = join(androidApp, 'src', 'main', 'assets', 'public');
// Capacitor's CLI has no --config flag: it always reads capacitor.config.json
// from the project directory, so each app's config is staged there in turn.
const liveConfig = join(frontend, 'capacitor.config.json');

const APPS = [
  { key: 'store', flavor: 'store', config: 'capacitor.store.json' },
  { key: 'shopper', flavor: 'shopper', config: 'capacitor.shopper.json' },
  { key: 'rider', flavor: 'rider', config: 'capacitor.rider.json' },
];

const args = process.argv.slice(2);
const release = args.includes('--release');
const wanted = args.filter((a) => !a.startsWith('--'));
const targets = wanted.length
  ? APPS.filter((a) => wanted.includes(a.key))
  : APPS;

if (targets.length === 0) {
  console.error(`Unknown app. Choose from: ${APPS.map((a) => a.key).join(', ')}`);
  process.exit(1);
}

function run(cmd, cmdArgs, label, opts = {}) {
  console.log(`\n[build-android] ${label}`);
  const res = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? frontend,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) {
    console.error(`[build-android] ${label} failed (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

/**
 * The checked-in `gradlew` has to download its distribution from
 * services.gradle.org, which is unreachable from some networks (it hangs in
 * followRedirects and the build dies before Gradle ever starts). Prefer an
 * already-installed Gradle when one is available, and only fall back to the
 * wrapper so a normal machine keeps using the pinned version.
 */
function resolveGradle() {
  if (process.env.GRADLE_CMD) return { cmd: process.env.GRADLE_CMD, label: 'gradle ($GRADLE_CMD)' };
  const onPath = process.platform === 'win32' ? 'gradle.bat' : 'gradle';
  const probe = spawnSync(onPath, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (probe.status === 0) return { cmd: onPath, label: `gradle (${onPath} on PATH)` };
  const wrapper = join(frontend, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  return { cmd: wrapper, label: `gradle wrapper (${wrapper})` };
}

// One Vite build produces every entry, into its own outDir so it never
// clobbers the web dist that the browser build uses.
run('npm', ['run', 'build:native'], 'vite build (all three web apps, native API base)');

for (const app of targets) {
  copyFileSync(join(frontend, app.config), liveConfig);
  run('npx', ['cap', 'sync', 'android'], `cap sync (${app.key}, config ${app.config})`);

  const flavorAssets = join(androidApp, 'src', app.flavor, 'assets', 'public');
  rmSync(flavorAssets, { recursive: true, force: true });
  mkdirSync(dirname(flavorAssets), { recursive: true });
  if (!existsSync(sharedAssets)) {
    console.error(`[build-android] ${sharedAssets} missing after cap sync`);
    process.exit(1);
  }
  renameSync(sharedAssets, flavorAssets);

  // Capacitor boots `index.html` and has no per-app entry option, so the
  // bundle has to contain exactly one entry. Vite emits all three HTML files
  // (they share content-hashed chunks, so nothing else is duplicated): keep
  // this app's, drop the sibling applications' bundles, then rename ours to
  // index.html. Shipping all three would also mean installing the customer
  // app hands the user the store console's code.
  const entryHtml = app.key === 'store' ? 'index.html' : `${app.key}.html`;
  for (const name of readdirSync(flavorAssets)) {
    if (name.endsWith('.html') && name !== entryHtml) {
      rmSync(join(flavorAssets, name));
    }
  }
  if (entryHtml !== 'index.html') {
    renameSync(join(flavorAssets, entryHtml), join(flavorAssets, 'index.html'));
  }
  // The sibling applications' entry chunks are never imported by this bundle
  // (only this HTML references them), so drop them for the same reason as the
  // HTML: a customer install should not ship the store console's code. Shared
  // chunks such as src-*.js and the lazily-loaded view chunks stay — a dynamic
  // import is invisible to the HTML, so only the three known entry names are
  // safe to remove.
  const chunkAssets = join(flavorAssets, 'assets');
  if (existsSync(chunkAssets)) {
    for (const name of readdirSync(chunkAssets)) {
      const entry = name.match(/^(store|shopper|rider)-[\w-]+\.js$/);
      if (entry && entry[1] !== app.key) rmSync(join(chunkAssets, name));
    }
  }

  const task = `assemble${app.flavor[0].toUpperCase()}${app.flavor.slice(1)}${release ? 'Release' : 'Debug'}`;
  const gradle = resolveGradle();
  console.log(`[build-android] ${gradle.label}`);
  run(gradle.cmd, [task, '--no-daemon'], `gradle ${task}`, { cwd: join(frontend, 'android') });

  const apk = join(androidApp, 'build', 'outputs', 'apk', app.flavor, release ? 'release' : 'debug');
  console.log(`[build-android] ${app.key} APK(s) in ${apk}`);
}

console.log('\n[build-android] done');
