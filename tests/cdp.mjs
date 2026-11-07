/**
 * A tiny Chrome DevTools Protocol driver, with no dependencies.
 *
 * Node 22 ships a global WebSocket, so driving a real Chrome needs nothing
 * installed: launch it with a debugging port, connect, and send CDP commands.
 * That keeps the test suite honest — everything runs in a real browser — while
 * adding zero packages to the project.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

/** Minimal static server, used when a suite tests files rather than the app. */
export function serve(rootIn, port) {
  const root = path.resolve(rootIn);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.resolve(path.join(root, url === '/' ? 'index.html' : url));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Where Chrome lives, checked in the usual Windows and POSIX locations. */
export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch {}
  }
  throw new Error('Chrome not found. Set CHROME_PATH to its location.');
}

export async function launch(chromePath, port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rx-test-'));
  const proc = spawn(chromePath || findChrome(), [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1440,900', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await sleep(150);
  }
  if (!target) { proc.kill(); throw new Error('Chrome did not expose a debug target'); }
  return { proc, profile, wsUrl: target.webSocketDebuggerUrl };
}

export class Client {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('Could not connect to Chrome'));
    });
    const client = new Client(ws);
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id && client.pending.has(msg.id)) {
        const { resolve, reject } = client.pending.get(msg.id);
        client.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (client.handlers.get(msg.method) || []).forEach(h => h(msg.params));
      }
    };
    return client;
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate in the page. The body is wrapped in an async IIFE, so `await` works. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'evaluation threw');
    }
    return r.result.value;
  }
}

/** Shared result collector, so every suite reports the same way. */
export function reporter(title) {
  const results = [];
  return {
    group: g => results.push({ group: g }),
    check: (name, cond, detail = '', severity = 'med') =>
      results.push({ pass: !!cond, name, detail, severity }),
    report() {
      console.log(`\n================ ${title} ================`);
      let pass = 0;
      const failures = [];
      for (const r of results) {
        if (r.group) { console.log('\n-- ' + r.group + ' --'); continue; }
        const tag = r.pass ? '  PASS  ' : `  FAIL[${r.severity}]  `;
        console.log(tag + r.name + (r.detail ? '  -- ' + r.detail : ''));
        r.pass ? pass++ : failures.push(r);
      }
      console.log(`\n${pass}/${pass + failures.length} passed`);
      if (failures.length) {
        console.log('\nFindings:');
        for (const f of failures) console.log(`  [${f.severity.toUpperCase()}] ${f.name} — ${f.detail}`);
      }
      return failures.length;
    },
  };
}
