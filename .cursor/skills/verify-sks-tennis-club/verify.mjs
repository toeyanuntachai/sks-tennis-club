#!/usr/bin/env node
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const skillDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(skillDir, '../../..');
const runFile = join(skillDir, 'run.json');
const artifacts = join(skillDir, 'artifacts');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readRun() {
  if (!existsSync(runFile)) fail('No verification server is recorded. Run launch first.');
  return JSON.parse(readFileSync(runFile, 'utf8'));
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function listeners(port) {
  const result = spawnSync('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function buildIfNeeded() {
  if (existsSync(join(repoRoot, 'dist/index.html'))) return;
  console.log('dist/index.html is missing. Running npm run build.');
  const build = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
  if (build.status !== 0 || !existsSync(join(repoRoot, 'dist/index.html'))) {
    fail('npm run build did not produce dist/index.html.');
  }
}

async function launch() {
  if (existsSync(runFile)) {
    const previous = JSON.parse(readFileSync(runFile, 'utf8'));
    if (alive(previous.pid) && listeners(previous.port).includes(String(previous.pid))) {
      fail('A verification server is already running at ' + previous.origin + '. Run cleanup before launch.');
    }
  }
  await buildIfNeeded();
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const dataDir = mkdtempSync(join(tmpdir(), 'sks-verify-'));
  const databasePath = join(dataDir, 'sks.sqlite');
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      SKS_PORT: String(port),
      SKS_BIND_ADDRESS: '127.0.0.1',
      SKS_ORIGIN: origin,
      SKS_DATABASE_PATH: databasePath,
      LINE_LOGIN_CHANNEL_ID: '',
      LINE_LIFF_ID: '',
      SKS_INVITE_CODE: '',
    },
  });
  const run = { pid: child.pid, origin, port, databasePath, dataDir, startedAt: new Date().toISOString() };
  let exited = false;
  child.once('exit', () => { exited = true; });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (exited) break;
    try {
      const response = await fetch(origin + '/api/config');
      const body = await response.json();
      if (response.status === 200 && body.ready === false && body.liffId === '') { ready = true; break; }
    } catch { /* server still binding */ }
    await delay(100);
  }
  child.unref();
  if (!ready) {
    if (alive(child.pid)) process.kill(child.pid, 'SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
    fail('Server did not answer GET /api/config with ready false.');
  }
  writeFileSync(runFile, JSON.stringify(run, null, 2) + '\n');
  console.log(JSON.stringify({ origin, pid: run.pid, databasePath }));
}

async function doctor() {
  const run = readRun();
  const checks = [];
  function check(name, ok, detail) { checks.push({ name, ok, detail }); }
  check('pid alive', alive(run.pid), String(run.pid));
  const listening = listeners(run.port);
  check('pid owns port', listening.includes(String(run.pid)), listening.join(',') || 'none');
  check('database is disposable', run.databasePath.startsWith(tmpdir()) && run.databasePath.includes('sks-verify-') && existsSync(run.databasePath), run.databasePath);
  try {
    const page = await fetch(run.origin + '/');
    const html = await page.text();
    const type = page.headers.get('content-type') || '';
    check('home is html', page.status === 200 && type.includes('text/html') && html.includes('SKS Tennis Club') && html.includes('id="root"'), page.status + ' ' + type);
  } catch (error) { check('home is html', false, error.message); }
  try {
    const config = await fetch(run.origin + '/api/config');
    const body = await config.json();
    check('line is unset', config.status === 200 && body.ready === false && body.liffId === '', JSON.stringify(body));
  } catch (error) { check('line is unset', false, error.message); }
  try {
    const events = await fetch(run.origin + '/api/events');
    const body = await events.json();
    check('events require login', events.status === 401 && body.message === 'กรุณาเข้าใช้งานผ่าน LINE', events.status + ' ' + JSON.stringify(body));
  } catch (error) { check('events require login', false, error.message); }
  try {
    const logo = await fetch(run.origin + '/sks-logo.png');
    const type = logo.headers.get('content-type') || '';
    check('logo is png', logo.status === 200 && type.includes('image/png'), logo.status + ' ' + type);
  } catch (error) { check('logo is png', false, error.message); }
  const report = [
    'origin ' + run.origin,
    'pid ' + run.pid,
    'database ' + run.databasePath,
    ...checks.map(item => (item.ok ? 'ok' : 'FAIL') + '  ' + item.name + '  ' + item.detail),
  ].join('\n') + '\n';
  mkdirSync(join(artifacts, 'doctor'), { recursive: true });
  writeFileSync(join(artifacts, 'doctor/report.txt'), report);
  process.stdout.write(report);
  if (checks.some(item => !item.ok)) process.exit(1);
}

function cleanup() {
  if (!existsSync(runFile)) {
    console.log('No run.json. Nothing to stop.');
    return;
  }
  const run = JSON.parse(readFileSync(runFile, 'utf8'));
  if (listeners(run.port).includes(String(run.pid))) {
    process.kill(run.pid, 'SIGTERM');
    const started = Date.now();
    while (alive(run.pid) && Date.now() - started < 2000) spawnSync('sleep', ['0.1']);
    if (alive(run.pid)) process.kill(run.pid, 'SIGKILL');
  }
  if (typeof run.dataDir === 'string' && run.dataDir.startsWith(tmpdir()) && run.dataDir.includes('sks-verify-')) {
    rmSync(run.dataDir, { recursive: true, force: true });
  }
  rmSync(runFile, { force: true });
  console.log('Stopped verification server. Left artifacts in ' + artifacts);
}

const command = process.argv[2];
if (command === 'launch') await launch();
else if (command === 'doctor') await doctor();
else if (command === 'cleanup') cleanup();
else fail('Usage: node .cursor/skills/verify-sks-tennis-club/verify.mjs launch|doctor|cleanup');
