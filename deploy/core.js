import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import WebSocket from 'ws';

export const TARGETS = { solar: { index: 0, path: 'solar' }, weather: { index: 1, path: 'w' } };
export const canonical = v => JSON.stringify(v, function (_k, value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value;
});
export const hash = v => createHash('sha256').update(typeof v === 'string' ? v : canonical(v)).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
const fail = msg => { throw new Error(msg); };

export function source(repo, selected) {
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const sha = git(['rev-parse', '--verify', 'HEAD']).trim();
  const cards = {};
  for (const name of selected) {
    const file = `${name}.yml`;
    const data = readFileSync(join(repo, file), 'utf8');
    if (data !== git(['show', `${sha}:${file}`])) fail(`Uncommitted changes in ${file}`);
    const doc = parseDocument(data, { uniqueKeys: true });
    if (doc.errors.length) fail(`Invalid YAML in ${file}`);
    cards[name] = doc.toJS({ maxAliasCount: 100 });
    if (!cards[name] || cards[name].type !== 'vertical-stack' || !Array.isArray(cards[name].cards)) fail(`Invalid card in ${file}`);
  }
  return { sha, cards };
}
export function select(names) {
  const parts = names?.split(',');
  if (!parts?.length || parts.some(n => !TARGETS[n]) || new Set(parts).size !== parts.length) fail('Select solar, weather, or solar,weather');
  return parts.sort();
}
export function validate(config, selected) {
  if (!config || !Array.isArray(config.views)) fail('Invalid dashboard structure');
  for (const name of selected) {
    const { index, path } = TARGETS[name];
    const view = config.views[index];
    if (!view || view.path !== path || !Array.isArray(view.cards) || view.cards[0]?.type !== 'vertical-stack' || !Array.isArray(view.cards[0].cards)) fail(`Unexpected ${name} view or card`);
  }
}
export function makePlan(config, selected, src, server) {
  validate(config, selected);
  const next = clone(config);
  for (const name of selected) next.views[TARGETS[name].index].cards[0] = clone(src.cards[name]);
  const body = { version: 1, dashboard: 'ha-devices', selected, sourceSha: src.sha, server, previous: hash(config), desired: hash(next) };
  return { ...body, hash: hash(body), next };
}

export class HA {
  constructor(url, token, WebSocketImpl = WebSocket) {
    if (!url || !token) fail('HA_URL and HA_TOKEN are required');
    let u;
    try { u = new URL(url); } catch { fail('Invalid HA_URL'); }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) fail('Invalid HA_URL');
    this.identity = hash(u.origin + u.pathname.replace(/\/$/, ''));
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = u.pathname.replace(/\/$/, '') + '/api/websocket';
    this.url = u.toString(); this.token = token; this.id = 0; this.WebSocketImpl = WebSocketImpl;
  }
  async connect() {
    this.ws = new this.WebSocketImpl(this.url, { handshakeTimeout: 10000, maxPayload: 20 * 1024 * 1024 });
    this.messages = []; this.waiter = null; this.closed = false;
    this.ws.on('message', data => { let msg; try { msg = JSON.parse(data.toString()); } catch { this.abort(); return; } if (this.waiter) { const w = this.waiter; this.waiter = null; w.resolve(msg); } else this.messages.push(msg); });
    this.ws.on('error', () => this.abort()); this.ws.on('close', () => this.abort());
    if ((await this.receive()).type !== 'auth_required') fail('Unexpected authentication response');
    this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
    if ((await this.receive()).type !== 'auth_ok') fail('Authentication failed');
    const user = await this.call('auth/current_user');
    if (!user?.is_admin) fail('Administrator authentication required');
  }
  abort() { this.closed = true; if (this.waiter) { this.waiter.reject(new Error('WebSocket connection failed')); this.waiter = null; } }
  async receive() {
    if (this.messages.length) return this.messages.shift();
    if (this.closed) fail('WebSocket connection failed');
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.waiter = null; reject(new Error('WebSocket timed out')); }, 10000); this.waiter = { resolve: x => { clearTimeout(timer); resolve(x); }, reject: e => { clearTimeout(timer); reject(e); } }; });
  }
  async call(type, fields = {}) {
    const id = ++this.id; this.ws.send(JSON.stringify({ id, type, ...fields }));
    let msg; do { msg = await this.receive(); } while (msg.id !== id);
    if (msg.type !== 'result' || msg.success !== true) fail(`Home Assistant rejected ${type}`);
    return msg.result;
  }
  async read() {
    const dashboards = await this.call('lovelace/dashboards/list');
    const matches = Array.isArray(dashboards) ? dashboards.filter(d => d.url_path === 'ha-devices') : [];
    if (matches.length !== 1 || matches[0].mode !== 'storage') fail('Storage dashboard ha-devices not established');
    return this.call('lovelace/config', { url_path: 'ha-devices', force: true });
  }
  async save(config) { return this.call('lovelace/config/save', { url_path: 'ha-devices', config }); }
  close() { this.ws?.terminate(); }
}

function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const s = lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) fail('Backup directory must be private and owned by current user');
}
export function backup(root, repo, config, plan) {
  privateDir(root);
  const realRoot = realpathSync(root), realRepo = realpathSync(repo);
  if (realRoot === realRepo || realRoot.startsWith(realRepo + '/')) fail('Backup directory cannot be inside checkout');
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(6).toString('hex')}`;
  const dir = join(root, id); mkdirSync(dir, { mode: 0o700 });
  const manifest = { version: 1, id, created: new Date().toISOString(), dashboard: 'ha-devices', server: plan.server, sourceSha: plan.sourceSha, planHash: plan.hash, previous: plan.previous, desired: plan.desired, selected: plan.selected };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
  return { id, dir, manifest };
}
export function loadBackup(root, id, server) {
  if (!/^[0-9TZ-]+-[a-f0-9]{12}$/.test(id || '')) fail('Invalid backup ID');
  privateDir(root); const dir = join(root, id); const s = lstatSync(dir);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) fail('Insecure backup directory');
  for (const name of ['manifest.json', 'config.json']) { const f = lstatSync(join(dir, name)); if (!f.isFile() || f.isSymbolicLink() || (f.mode & 0o077) || (process.getuid && f.uid !== process.getuid())) fail('Insecure backup file'); }
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.id !== id || manifest.server !== server || manifest.dashboard !== 'ha-devices' || hash(config) !== manifest.previous || !/^[a-f0-9]{64}$/.test(manifest.desired)) fail('Invalid backup or server mismatch');
  validate(config, select(manifest.selected.join(',')));
  return { dir, manifest, config };
}
function incident(dir, data) { writeFileSync(join(dir, `incident-${Date.now()}-${randomBytes(4).toString('hex')}.json`), JSON.stringify({ time: new Date().toISOString(), ...data }, null, 2), { mode: 0o600, flag: 'wx' }); }
export async function apply(ha, root, repo, selected, expected, approve) {
  const src = source(repo, selected), first = await ha.read(), plan = makePlan(first, selected, src, ha.identity);
  if (plan.hash !== expected) fail('Plan is stale or hash does not match');
  await approve(plan, first);
  const pre = await ha.read();
  if (hash(pre) !== plan.previous || source(repo, selected).sha !== plan.sourceSha) fail('Dashboard or source changed before write');
  // Recheck source bytes as well as commit after interactive approval.
  if (hash(source(repo, selected).cards) !== hash(src.cards)) fail('Source changed before write');
  const saved = backup(root, repo, pre, plan);
  try {
    await ha.save(plan.next);
    const result = await ha.read();
    if (hash(result) !== plan.desired) fail('Persistence verification mismatch');
    return saved.id;
  } catch (err) {
    let outcome = 'not attempted: current dashboard could not be checked';
    try {
      const current = await ha.read();
      if (hash(current) === plan.desired) {
        await ha.save(pre);
        outcome = hash(await ha.read()) === plan.previous ? 'verified' : 'verification mismatch';
      } else outcome = 'refused: dashboard differs from intended state';
    } catch { outcome = 'failed or state unknown'; }
    incident(saved.dir, { stage: 'apply', error: err.message, rollback: outcome, previous: plan.previous, desired: plan.desired });
    fail(`Apply failed; backup ${saved.id}; automatic rollback ${outcome}`);
  }
}
export async function rollback(ha, root, id, approve) {
  const b = loadBackup(root, id, ha.identity);
  const current = await ha.read(); validate(current, b.manifest.selected);
  if (hash(current) !== b.manifest.desired) fail('Rollback refused: dashboard differs from deployed state');
  await approve(b.manifest);
  if (hash(await ha.read()) !== b.manifest.desired) fail('Rollback refused: dashboard changed before write');
  try {
    await ha.save(b.config);
    if (hash(await ha.read()) !== b.manifest.previous) fail('Rollback verification mismatch');
  } catch (err) { incident(b.dir, { stage: 'rollback', error: err.message }); fail(`Rollback failed; inspect backup ${id} and dashboard`); }
}
