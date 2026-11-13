'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

// These files use YAML block scalars containing button-card's [[[ JS ]]] syntax.
// This deliberately narrow extractor does not claim to be a general YAML parser.
function extract(file, fields) {
  const source = readFileSync(path.join(root, file), 'utf8');
  const templates = [...source.matchAll(/\[\[\[([\s\S]*?)\]\]\]/g)];
  assert.equal(templates.length, fields.length,
    `${file}: expected ${fields.length} templates, found ${templates.length}`);
  return templates.map((match, index) => {
    const before = source.slice(0, match.index);
    const property = before.match(/(?:^|\n)\s*(?:-\s*)?([\w_]+):\s*\|\s*\r?\n\s*$/);
    assert.equal(property?.[1], fields[index],
      `${file}: template ${index + 1} must belong to ${fields[index]}`);
    try {
      return new Function('states', match[1]);
    } catch (error) {
      throw new Error(`${file}: template ${index + 1} is invalid JavaScript: ${error.message}`);
    }
  });
}

const solar = extract('solar.yml', ['color']);
const weather = extract('weather.yml', [
  ...Array(9).fill('entity_picture'),
  'entity', 'entity_picture', 'icon', 'entity', 'color', 'color',
]);

const sunStates = [
  ['missing entity', {}],
  ['null entity', { 'sun.sun': null }],
  ['missing state', { 'sun.sun': {} }],
  ['unknown', { 'sun.sun': { state: 'unknown' } }],
  ['unavailable', { 'sun.sun': { state: 'unavailable' } }],
];
const sun = state => ({ 'sun.sun': { state } });

test('daily cost uses numeric comparison and neutral invalid fallback', () => {
  const cases = [
    ['2.5', '#b7ffb7'], ['0.01', '#b7ffb7'], ['0', '#F98C8C'],
    ['-2', '#F98C8C'], ['not-a-number', '#808080'], ['', '#808080'],
    ['  ', '#808080'], ['unknown', '#808080'], ['unavailable', '#808080'],
    ['Infinity', '#808080'],
  ];
  for (const [state, expected] of cases) {
    assert.equal(solar[0]({ 'sensor.total_cost_daily': { state } }), expected, state);
  }
  for (const value of [undefined, null, {}, { state: null }]) {
    const states = value === undefined ? {} : { 'sensor.total_cost_daily': value };
    assert.equal(solar[0](states), '#808080', `missing cost: ${JSON.stringify(value)}`);
  }
});

// Expected paths are the pre-fix outputs for valid above/below-horizon states.
const pictures = [
  ['clearr.png', 'clearr-night.png'],
  ['rainyy.png', 'rainyy-night.png'],
  ['clearr.png', 'clearr-night.png'],
  ['cloudyy.png', 'cloudyy-night.png'],
  ['rainyy.png', 'rainyy-night.png'],
  ['showerss.png', 'showerss-night.png'],
  ['showerss.png', 'showerss-night.png'],
  ['mostlyy-sunny.png', 'mostlyy-sunny-night.png'],
  ['stormss.png', 'stormss-night.png'],
];
const iconPath = file => `/local/icons/weather/${file}`;

test('all weather pictures preserve day/night paths and use string fallbacks', () => {
  pictures.forEach(([day, night], index) => {
    assert.equal(weather[index](sun('above_horizon')), iconPath(day), `picture ${index + 1} day`);
    assert.equal(weather[index](sun('below_horizon')), iconPath(night), `picture ${index + 1} night`);
    for (const [label, states] of sunStates) {
      const result = weather[index](states);
      assert.equal(typeof result, 'string', `picture ${index + 1} ${label} type`);
      assert.equal(result, iconPath(day), `picture ${index + 1} ${label}`);
    }
  });
});

test('sun-dependent entity, picture, icon and colour selectors', () => {
  const cases = [
    [9, 'sensor.nextsunset', 'sensor.nextsunrise', 'sun.sun'],
    [10, iconPath('sunset.png'), iconPath('sunrise.png'), iconPath('sunrise.png')],
    [11, 'mdi:arrow-down-thick', 'mdi:arrow-up-thick', 'mdi:help-circle-outline'],
    [12, 'sensor.home_temp_max_0', 'sensor.home_temp_min_1', 'sun.sun'],
    [13, '#ff785b', '#90daff', '#808080'],
  ];
  for (const [index, day, night, fallback] of cases) {
    assert.equal(weather[index](sun('above_horizon')), day, `template ${index + 1} day`);
    assert.equal(weather[index](sun('below_horizon')), night, `template ${index + 1} night`);
    for (const [label, states] of sunStates) {
      const result = weather[index](states);
      assert.equal(typeof result, 'string', `template ${index + 1} ${label} type`);
      assert.equal(result, fallback, `template ${index + 1} ${label}`);
    }
  }
});

test('UV colour preserves valid categories and handles invalid entities', () => {
  const uv = (state, sunState = 'above_horizon') => ({
    'sensor.uv_formatted': { state }, ...sun(sunState),
  });
  for (const [state, colour] of [
    ['Low', '#82e0aa'], ['Moderate', '#f7dc6f'], ['High', '#eb984e'],
    ['Very High', '#ec7063'], ['Extreme', '#a93226'],
  ]) {
    assert.equal(weather[14](uv(state)), colour, state);
    assert.equal(weather[14](uv(state, 'below_horizon')), colour, `${state} night`);
  }
  assert.equal(weather[14](uv('Other')), '#000000');
  assert.equal(weather[14](uv('Other', 'below_horizon')), '#0a0a0a');
  for (const state of ['unknown', 'unavailable']) {
    assert.equal(weather[14](uv(state)), '#808080', state);
  }
  // Blank UV is currently treated like an unrecognised category, not unknown.
  assert.equal(weather[14](uv('')), '#000000', 'blank UV during day');
  assert.equal(weather[14](uv('', 'below_horizon')), '#0a0a0a', 'blank UV at night');
  for (const entity of [undefined, null, {}, { state: null }]) {
    const states = entity === undefined ? {} : { 'sensor.uv_formatted': entity };
    assert.equal(weather[14](states), '#808080', `missing UV: ${JSON.stringify(entity)}`);
  }
  for (const [label, states] of sunStates) {
    assert.equal(weather[14]({ ...states, 'sensor.uv_formatted': { state: 'Other' } }),
      '#808080', `UV with ${label} sun`);
  }
});
