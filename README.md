# MagicMirror-HASSIO-Dashboard

## Home Assistant dashboard deployer

Node.js 20+ required. Run `npm ci`, then `node deploy/cli.js --help`.
The deployer uses the Home Assistant WebSocket API and needs an administrator
long-lived token. Supply `HA_URL` (for example, `https://homeassistant.example`)
and `HA_TOKEN` at runtime through a secure environment. Use HTTPS on untrusted
networks. Never commit credentials. Do not put tokens in shell history.

1. Run `node deploy/cli.js plan --targets solar,weather` (or select only `solar`
   or `weather`). Inspect each entire before/after card and type the exact
   confirmation shown. The known targets are `ha-devices/solar`, view 0 card 0,
   and `ha-devices/w`, view 1 card 0. The existing card contents have not been
   verified against this repository; operator confirmation establishes identity.
2. After independent approval, run `node deploy/cli.js apply --targets
   solar,weather --plan-hash <plan-hash>` with the same selection. Type the
   displayed `APPLY` phrase. Hash binds the server, full current and proposed
   dashboard, selection, and source commit. Selected YAML files must match HEAD.
3. To restore, run `node deploy/cli.js rollback --backup <backup-id>` and type
   the displayed `ROLLBACK` phrase. Restore proceeds only if the entire current
   dashboard still matches the deployed state.

All commands require an interactive terminal. Plan is read-only. Apply and
rollback save the **entire** dashboard. A private full-config snapshot and
manifest are created under `~/.local/state/magicmirror-ha-deployer/`, outside
this repository, before apply; treat snapshots as sensitive. A failed apply
records an incident there and attempts rollback only if a fresh read matches
its intended full dashboard. Ambiguous writes or other changes require manual
inspection. Keep backup IDs and protect backup directory. The API has no atomic
compare-and-swap: another writer can still change the dashboard between the final
read and save. Schedule a maintenance window and prevent concurrent edits.

Success means API persistence only, not frontend reload, custom-card availability,
or visual rendering. Verify those separately after authorized deployment. No
MagicMirror `config.js` deployment is included.

Offline tests: `npm ci --offline` (with cached packages), then `npm test`.
