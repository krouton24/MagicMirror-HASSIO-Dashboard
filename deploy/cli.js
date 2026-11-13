#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HA, TARGETS, source, select, makePlan, apply, rollback } from './core.js';

const help = `Usage:
  node deploy/cli.js plan --targets solar,weather
  node deploy/cli.js apply --targets solar,weather --plan-hash SHA256
  node deploy/cli.js rollback --backup ID

Set HA_URL and HA_TOKEN in the environment. Commands require an interactive terminal.
Backups: ~/.local/state/magicmirror-ha-deployer/ (private full dashboard configs).
Plan displays complete before/after cards. Verify identity before confirming each target.
Apply and rollback rewrite the entire storage dashboard; API persistence is not UI validation.`;
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const root = join(homedir(), '.local', 'state', 'magicmirror-ha-deployer');
let ha;
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(help); process.exit(0); }
  const cmd = args.shift();
  if (!['plan', 'apply', 'rollback'].includes(cmd) || args.length % 2) throw new Error('Invalid arguments; use --help');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--targets', '--plan-hash', '--backup'].includes(args[i]) || options[args[i]] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid arguments; use --help');
    options[args[i]] = args[i + 1];
  }
  const allowed = cmd === 'plan' ? ['--targets'] : cmd === 'apply' ? ['--targets', '--plan-hash'] : ['--backup'];
  if (Object.keys(options).length !== allowed.length || allowed.some(k => !options[k])) throw new Error('Invalid arguments; use --help');
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Interactive terminal required');
  const targets = cmd === 'rollback' ? null : select(options['--targets']);
  if (cmd === 'apply' && !/^[a-f0-9]{64}$/.test(options['--plan-hash'])) throw new Error('Invalid plan hash');
  ha = new HA(process.env.HA_URL, process.env.HA_TOKEN);
  await ha.connect();
  const rl = createInterface({ input: stdin, output: stdout });
  const ask = async phrase => { if ((await rl.question(`Type ${phrase} to confirm: `)) !== phrase) throw new Error('Confirmation declined'); };
  try {
    if (cmd === 'plan') {
      const current = await ha.read(), src = source(repo, targets), plan = makePlan(current, targets, src, ha.identity);
      for (const name of targets) {
        const target = TARGETS[name], label = `ha-devices/${target.path} views[${target.index}].cards[0]`;
        const display = JSON.stringify({ target: label, before: current.views[target.index].cards[0], after: plan.next.views[target.index].cards[0] }, null, 2);
        if (display.includes(process.env.HA_TOKEN)) throw new Error('Refusing to display a credential');
        console.log(display);
        await ask(`CONFIRM ${name} ${label}`);
      }
      console.log(`Source commit: ${plan.sourceSha}\nPrevious dashboard SHA256: ${plan.previous}\nDesired dashboard SHA256: ${plan.desired}\nPlan hash: ${plan.hash}`);
    } else if (cmd === 'apply') {
      const id = await apply(ha, root, repo, targets, options['--plan-hash'], async (plan, current) => {
        for (const name of targets) {
          const target = TARGETS[name], label = `ha-devices/${target.path} views[${target.index}].cards[0]`;
          const display = JSON.stringify({ target: label, before: current.views[target.index].cards[0], after: plan.next.views[target.index].cards[0] }, null, 2);
          if (display.includes(process.env.HA_TOKEN)) throw new Error('Refusing to display a credential');
          console.log(display);
          await ask(`CONFIRM ${name} ${label}`);
        }
        console.log(`Plan ${plan.hash}; targets ${targets.join(', ')}; commit ${plan.sourceSha}. Full dashboard will be written.`);
        await ask(`APPLY ${plan.hash}`);
      });
      console.log(`API persistence verified. Backup ID: ${id}. UI reload and visual rendering have not been verified.`);
    } else {
      await rollback(ha, root, options['--backup'], async manifest => {
        console.log(`Restore backup ${manifest.id}; full dashboard will be written.`);
        await ask(`ROLLBACK ${manifest.id}`);
      });
      console.log('API persistence verified. UI reload and visual rendering have not been verified.');
    }
  } finally { rl.close(); }
} catch (err) {
  let msg = String(err.message || 'Operation failed');
  for (const secret of [process.env.HA_TOKEN, process.env.HA_URL]) if (secret) msg = msg.split(secret).join('[redacted]');
  console.error(`Error: ${msg}`); process.exitCode = 1;
} finally { ha?.close(); }
