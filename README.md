# MagicMirror-HASSIO-Dashboard

## Offline template regression tests

Install Node.js 18 or newer, then run from the repository root:

```sh
node --test tests/templates.test.js
```

The tests use only Node.js built-ins and execute the JavaScript templates in
`solar.yml` and `weather.yml`. They do not require Home Assistant, credentials,
or network access. They do not test rendering in Home Assistant or button-card.
