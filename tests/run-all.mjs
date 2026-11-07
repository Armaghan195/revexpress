/**
 * Runs every suite, each against a clean database.
 *
 * The suites create leads, and leads cannot be deleted through the portal by
 * design, so a second run would inherit the first run's rate-limit buckets and
 * report failures that are really leftovers. The embedded database is
 * single-writer, so the cleanup has to happen with the server stopped — hence
 * the stop/clean/start cycle around each suite rather than one long-lived server.
 *
 *   node tests/run-all.mjs            # everything
 *   node tests/run-all.mjs site       # just one
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const NEXT_BIN = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');

const PORT = Number(process.env.RX_PORT || 3100);
const BASE = `http://127.0.0.1:${PORT}`;

const SUITES = [
  // Cheap and server-free, so it runs first: it catches a misconfigured policy
  // before four browser suites spend minutes proving the symptom.
  { name: 'config', file: 'tests/config.mjs' },
  { name: 'site', file: 'tests/site.mjs' },
  { name: 'portal', file: 'tests/portal.mjs' },
  { name: 'responsive', file: 'tests/responsive.mjs' },
  { name: 'security', file: 'tests/security.mjs' },
];

const only = process.argv.slice(2);
const selected = only.length ? SUITES.filter(s => only.includes(s.name)) : SUITES;
if (!selected.length) {
  console.error('No such suite. Available: ' + SUITES.map(s => s.name).join(', '));
  process.exit(1);
}

function run(command, args, opts = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: opts.quiet ? 'ignore' : 'inherit', shell: true });
    child.on('exit', code => resolve(code ?? 1));
  });
}

async function startServer() {
  // Spawn Next's own entry point with this Node, rather than going through npx
  // and a shell. A shell wrapper becomes the child, so killing it leaves the
  // real server running — and a stray server keeps the single-writer database
  // locked, which makes every following suite fail with a 500.
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT)], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    await delay(500);
    try {
      const res = await fetch(BASE + '/login');
      if (res.ok) return child;
    } catch {}
  }
  child.kill();
  throw new Error('the server did not come up on ' + BASE);
}

async function stopServer(child) {
  child.kill();
  await delay(500);
  if (!child.killed || child.exitCode === null) child.kill('SIGKILL');
  // Give PGlite time to release .pgdata before the next process opens it;
  // overlapping handles are what corrupts the directory.
  for (let i = 0; i < 40; i++) {
    await delay(250);
    try {
      await fetch(BASE + '/login');
    } catch {
      await delay(750);
      return;
    }
  }
}

const summary = [];

for (const suite of selected) {
  console.log(`\n\n########## ${suite.name.toUpperCase()} ##########\n`);

  const cleaned = await run('npx', ['tsx', 'scripts/cleanup-test-data.ts'], { quiet: true });
  if (cleaned !== 0) {
    console.error('  cleanup failed — the database is probably still locked; aborting');
    process.exit(1);
  }
  const server = await startServer();
  const code = await run('node', [suite.file]);
  await stopServer(server);

  summary.push({ name: suite.name, code });
}

// Leave the database as we found it rather than with a run's fixtures in it.
await run('npx', ['tsx', 'scripts/cleanup-test-data.ts'], { quiet: true });

console.log('\n\n================ ALL SUITES ================');
for (const s of summary) console.log(`  ${s.code === 0 ? 'PASS' : 'FAIL'}  ${s.name}`);
const failed = summary.filter(s => s.code !== 0);
console.log(`\n${summary.length - failed.length}/${summary.length} suites passed`);
process.exit(failed.length ? 1 : 0);
