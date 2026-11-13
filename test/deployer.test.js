import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { HA, source, makePlan, apply, rollback, select, hash } from '../deploy/core.js';

const repo = resolve('.');
const copy = x => structuredClone(x);
const initial = () => ({ title: 'Devices', views: [
  { path: 'solar', cards: [{ type: 'vertical-stack', cards: [{ type: 'markdown', content: 'solar old' }] }, { type: 'markdown', content: 'preserve' }] },
  { path: 'w', cards: [{ type: 'vertical-stack', cards: [{ type: 'markdown', content: 'weather old' }] }] }
], custom: { preserved: true } });
async function fixture(t, opts = {}) {
  const state = { config: initial(), writes: 0, reads: 0, mode: 'storage', admin: true };
  class FakeSocket extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('message', JSON.stringify({ type: 'auth_required' }))); }
    send(bytes) {
      const msg = JSON.parse(bytes);
      let response;
      if (msg.type === 'auth') response = { type: msg.access_token === 'secret-token' ? 'auth_ok' : 'auth_invalid' };
      else {
        let result;
        if (msg.type === 'auth/current_user') result = { is_admin: state.admin };
        else if (msg.type === 'lovelace/dashboards/list') result = [{ url_path: 'ha-devices', mode: state.mode }];
        else if (msg.type === 'lovelace/config') { state.reads++; result = copy(state.config); if (opts.mismatch && state.writes && state.reads === 3) result.title = 'unexpected'; }
        else if (msg.type === 'lovelace/config/save') { state.writes++; state.config = copy(msg.config); result = null; }
        else { response = { id: msg.id, type: 'result', success: false, error: { message: 'secret-token' } }; }
        response ||= { id: msg.id, type: 'result', success: true, result };
      }
      queueMicrotask(() => this.emit('message', JSON.stringify(response)));
    }
    terminate() { this.emit('close'); }
  }
  const ha = new HA('http://ha.invalid', 'secret-token', FakeSocket);
  await ha.connect();
  t.after(() => ha.close());
  return { ha, state, root: mkdtempSync(join(tmpdir(), 'deployer-test-')) };
}
const targets = select('solar');
async function plan(ha) { return makePlan(await ha.read(), targets, source(repo, targets), ha.identity); }

test('plan preserves unrelated fields and displays exact replacement', async t => {
  const { ha, state } = await fixture(t); const p = await plan(ha);
  assert.equal(p.next.views[0].cards[1].content, 'preserve');
  assert.deepEqual(p.next.views[1], state.config.views[1]);
  assert.deepEqual(p.next.views[0].cards[0], source(repo, targets).cards.solar);
  assert.equal(state.writes, 0);
});
test('wrong target, mode, admin and authentication fail closed', async t => {
  const { ha, state } = await fixture(t);
  state.config.views[0].path = 'wrong'; await assert.rejects(() => plan(ha), /Unexpected/);
  state.mode = 'yaml'; await assert.rejects(() => ha.read(), /Storage dashboard/);
  state.mode = 'storage'; state.admin = false;
  const other = new HA(ha.url.replace('ws:', 'http:').replace('/api/websocket', ''), 'bad-token', ha.WebSocketImpl);
  await assert.rejects(() => other.connect(), /Authentication failed/); other.close();
  const notAdmin = new HA(ha.url.replace('ws:', 'http:').replace('/api/websocket', ''), 'secret-token', ha.WebSocketImpl);
  await assert.rejects(() => notAdmin.connect(), /Administrator/); notAdmin.close();
  assert.equal(state.writes, 0);
});
test('stale plan and changed dashboard during approval prevent writes', async t => {
  const { ha, state, root } = await fixture(t); const p = await plan(ha);
  state.config.title = 'changed';
  await assert.rejects(() => apply(ha, root, repo, targets, p.hash, async () => {}), /stale/);
  state.config.title = 'Devices';
  await assert.rejects(() => apply(ha, root, repo, targets, p.hash, async () => { state.config.title = 'concurrent'; }), /changed before write/);
  assert.equal(state.writes, 0);
});
test('apply creates private backup, saves expected state and rollback restores', async t => {
  const { ha, state, root } = await fixture(t); const before = copy(state.config), p = await plan(ha);
  const id = await apply(ha, root, repo, targets, p.hash, async () => {});
  assert.equal(hash(state.config), p.desired);
  const dir = join(root, id), manifest = JSON.parse(readFileSync(join(dir, 'manifest.json')));
  assert.equal(manifest.previous, hash(before)); assert.equal(manifest.sourceSha, p.sourceSha);
  assert.equal(statSync(dir).mode & 0o777, 0o700); assert.equal(statSync(join(dir, 'config.json')).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'manifest.json')).mode & 0o777, 0o600);
  await rollback(ha, root, id, async () => {}); assert.deepEqual(state.config, before);
});
test('verification mismatch attempts guarded rollback and records incident', async t => {
  const { ha, state, root } = await fixture(t, { mismatch: true });
  // Plan consumes one read; apply consumes two reads before save.
  state.reads = -1; const p = await plan(ha); state.reads = 0;
  await assert.rejects(() => apply(ha, root, repo, targets, p.hash, async () => {}), /automatic rollback verified/);
  assert.deepEqual(state.config, initial()); const dir = join(root, readdirSync(root)[0]);
  assert.ok(readdirSync(dir).some(n => n.startsWith('incident-')));
});
test('rollback refuses concurrent edits and path traversal', async t => {
  const { ha, state, root } = await fixture(t); const p = await plan(ha);
  const id = await apply(ha, root, repo, targets, p.hash, async () => {}); state.config.title = 'newer change';
  await assert.rejects(() => rollback(ha, root, id, async () => {}), /differs/);
  await assert.rejects(() => rollback(ha, root, '../bad', async () => {}), /Invalid backup ID/);
  assert.equal(state.writes, 1);
});
test('server errors do not expose token', async t => {
  const { ha } = await fixture(t);
  await assert.rejects(() => ha.call('invalid'), e => !e.message.includes('secret-token'));
});

test('both targets use exact view paths and preserve remaining cards', async t => {
  const { ha, state } = await fixture(t); const names = select('weather,solar');
  const p = makePlan(await ha.read(), names, source(repo, names), ha.identity);
  assert.deepEqual(p.next.views[0].cards[0], source(repo, names).cards.solar);
  assert.deepEqual(p.next.views[1].cards[0], source(repo, names).cards.weather);
  assert.deepEqual(p.next.views[0].cards[1], state.config.views[0].cards[1]);
  state.config.views[1].path = 'weather';
  await assert.rejects(async () => makePlan(await ha.read(), names, source(repo, names), ha.identity), /Unexpected weather/);
});
test('declined apply and rollback approval cannot write', async t => {
  const { ha, state, root } = await fixture(t); const p = await plan(ha);
  await assert.rejects(() => apply(ha, root, repo, targets, p.hash, async () => { throw Error('declined'); }), /declined/);
  assert.equal(state.writes, 0);
  const id = await apply(ha, root, repo, targets, p.hash, async () => {});
  await assert.rejects(() => rollback(ha, root, id, async () => { throw Error('declined'); }), /declined/);
  assert.equal(state.writes, 1);
  await assert.rejects(() => rollback(ha, root, id, async () => { state.config.title = 'changed during approval'; }), /changed before write/);
  assert.equal(state.writes, 1);
});
