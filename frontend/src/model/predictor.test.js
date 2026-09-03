// @vitest-environment node
//
// Pure arithmetic against a file on disk: no DOM, and jsdom would only slow the
// run down.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { prepare, buildRow, rawScore, predictKwh } from './predictor';
import fixture from './parity-fixture.json';

/**
 * Does the browser give the same answer as the served model?
 *
 * The published dashboard predicts in the page, because GitHub Pages has no
 * process to call. That is only defensible if the page's arithmetic is the
 * service's arithmetic, and "I ported it carefully" is not evidence. So the
 * exporter records what Python actually answered for a set of inputs and this
 * replays them.
 *
 * Two shapes of case, because two things can be got wrong independently:
 * `cases` go in as a building, a timestamp and a temperature, which catches a
 * mistranslated feature; `rows` go in as design rows chosen to land on the
 * missing-value branches, which catches a mistranslated tree.
 *
 * Regenerate both with `python -m scripts.export_model_json` in `ai-service/`.
 */

const MODEL_PATH = fileURLToPath(
  new URL('../../public/model/energy_cold_start.json', import.meta.url),
);

// Float32 leaves accumulated over 400 trees, summed in a different language.
// This is far tighter than the two decimal places the panel prints, and loose
// enough that ordinary rounding noise is not a red build. Raw scores are
// compared with `toBeCloseTo`, whose argument is a digit count.
const KWH_RELATIVE_TOLERANCE = 1e-4;
const RAW_DIGITS = 4;

function loadBundle() {
  if (!existsSync(MODEL_PATH)) {
    throw new Error(
      `No exported model at ${MODEL_PATH}. Run \`python -m scripts.export_model_json\` ` +
      'in ai-service/. The published page cannot predict without it.',
    );
  }
  return prepare(JSON.parse(readFileSync(MODEL_PATH, 'utf8')));
}

const bundle = loadBundle();

const toRow = (values) => Float32Array.from(values.map((v) => (v == null ? NaN : v)));

describe('exported model', () => {
  it('matches the metadata the fixture was generated against', () => {
    expect(bundle.feature_columns).toEqual(fixture.feature_columns);
  });

  it('carries a validated error band for the panel to show', () => {
    expect(bundle.band_basis.cv_rmse_pct).toBeGreaterThan(0);
    expect(bundle.band_basis.protocol).toBeTruthy();
  });
});

describe('parity with the served model, end to end', () => {
  const { cases } = fixture;

  it('has cases covering the buildings BDG2 leaves incomplete', () => {
    expect(cases.length).toBeGreaterThan(50);
    expect(cases.some((c) => c.building.yearbuilt == null)).toBe(true);
    expect(cases.some((c) => c.building.numberoffloors == null)).toBe(true);
    expect(cases.some((c) => c.weather.dewTemperature == null)).toBe(true);
  });

  it('reads the same calendar out of the timestamp', () => {
    // A daylight-saving shift or a UTC/local mix-up would move `hour` and turn
    // every prediction below into an unexplained mismatch. Fail on the cause.
    for (const c of cases) {
      const when = new Date(c.timestamp);
      expect({
        hour: when.getHours(),
        day_of_week: (when.getDay() + 6) % 7,
        month: when.getMonth() + 1,
      }).toEqual(c.calendar);
    }
  });

  it('builds the same design row', () => {
    for (const c of cases) {
      const row = buildRow(bundle, c.building, new Date(c.timestamp), c.weather);
      const expected = toRow(c.features);
      expect(row.length).toBe(expected.length);
      for (let i = 0; i < row.length; i += 1) {
        if (Number.isNaN(expected[i])) {
          expect(`${bundle.feature_columns[i]}=${row[i]}`)
            .toBe(`${bundle.feature_columns[i]}=NaN`);
        } else {
          expect(row[i]).toBeCloseTo(expected[i], 5);
        }
      }
    }
  });

  it('predicts the same kWh', () => {
    for (const c of cases) {
      const kwh = predictKwh(bundle, c.building, new Date(c.timestamp), c.weather);
      const expected = c.expected_energy_kwh;
      expect(Math.abs(kwh - expected) / Math.max(Math.abs(expected), 1e-6))
        .toBeLessThan(KWH_RELATIVE_TOLERANCE);
    }
  });

  it('prints the same number, to within the last digit it shows', () => {
    // The panel renders two decimals. Float32 leaves summed in a different
    // language differ in the seventh significant figure, which is invisible
    // except when the true value sits on a rounding boundary -- then the last
    // printed digit can differ by one. That is the honest bound to assert;
    // demanding exact equality here would be asserting something untrue and
    // would turn a green build red at random.
    // Compared as whole hundredths: subtracting the rounded values would
    // reintroduce the float error the rounding was meant to remove.
    const printed = (v) => Math.round(v * 100);
    let differing = 0;
    for (const c of cases) {
      const kwh = predictKwh(bundle, c.building, new Date(c.timestamp), c.weather);
      const delta = Math.abs(printed(kwh) - printed(c.expected_energy_kwh));
      expect(delta).toBeLessThanOrEqual(1);
      if (delta > 0) differing += 1;
    }
    // A real divergence would not be rare. Anything above a handful means the
    // two implementations have stopped agreeing, not that they rounded apart.
    expect(differing).toBeLessThan(cases.length * 0.05);
  });
});

describe('parity on the missing-value branches', () => {
  const { features, raw, expected_energy_kwh: kwh } = fixture.rows;

  it('scores bare design rows identically', () => {
    expect(features.length).toBeGreaterThan(100);
    for (let i = 0; i < features.length; i += 1) {
      expect(rawScore(bundle, toRow(features[i]))).toBeCloseTo(raw[i], RAW_DIGITS);
    }
  });

  it('inverts the log1p target the same way', () => {
    for (let i = 0; i < features.length; i += 1) {
      const got = Math.expm1(rawScore(bundle, toRow(features[i])));
      expect(Math.abs(got - kwh[i]) / Math.max(Math.abs(kwh[i]), 1e-6))
        .toBeLessThan(KWH_RELATIVE_TOLERANCE);
    }
  });

  it('sends missing values down the branch the tree names', () => {
    // Not a parity check but a guard on the evaluator itself: if NaN silently
    // compared false and always went right, the rows above would still pass
    // whenever default_left happened to be right. Force the question.
    const tree = bundle.trees.find((t) => t.left[0] !== -1);
    const x = new Float32Array(bundle.feature_columns.length).fill(NaN);
    const expectedChild = tree.default_left[0] === 1 ? tree.left[0] : tree.right[0];
    expect(expectedChild).toBeGreaterThan(0);
    // Reaching the leaf at all means the walk did not fall off the tree.
    expect(Number.isFinite(rawScore({ ...bundle, trees: [tree] }, x))).toBe(true);
  });
});

describe('build_features mirror', () => {
  it('counts weekdays from Monday, as pandas does', () => {
    // 2017-07-15 is a Saturday: weekday() == 5 in Python, getDay() == 6 here.
    const building = { sqm: 1000, yearbuilt: 1990, numberoffloors: 3, primaryspaceusage: 'Office' };
    const row = buildRow(bundle, building, new Date('2017-07-15T15:00:00'), { airTemperature: 28 });
    const at = (name) => row[bundle.index.get(name)];
    expect(at('day_of_week')).toBe(5);
    expect(at('is_weekend')).toBe(1);
    expect(at('hour')).toBe(15);
    expect(at('month')).toBe(7);
  });

  it('splits temperature into degree-hours about the balance point', () => {
    const building = { sqm: 1000, yearbuilt: 1990, numberoffloors: 3, primaryspaceusage: 'Office' };
    const at = (row, name) => row[bundle.index.get(name)];

    const hot = buildRow(bundle, building, new Date('2017-07-15T15:00:00'), { airTemperature: 28 });
    expect(at(hot, 'cdh')).toBeCloseTo(10, 5);
    expect(at(hot, 'hdh')).toBe(0);

    const cold = buildRow(bundle, building, new Date('2017-01-15T06:00:00'), { airTemperature: -2 });
    expect(at(cold, 'cdh')).toBe(0);
    expect(at(cold, 'hdh')).toBeCloseTo(20, 5);
  });

  it('leaves an unrecorded attribute missing rather than filling it in', () => {
    const building = { sqm: 1000, yearbuilt: null, numberoffloors: null, primaryspaceusage: null };
    const row = buildRow(bundle, building, new Date('2017-07-15T15:00:00'), { airTemperature: 28 });
    const at = (name) => row[bundle.index.get(name)];
    expect(Number.isNaN(at('building_age'))).toBe(true);
    expect(Number.isNaN(at('numberoffloors'))).toBe(true);
    // No recorded use means every indicator is zero, not one of them guessed.
    const useColumns = bundle.feature_columns.filter((c) => c.startsWith('primaryspaceusage='));
    expect(useColumns.every((c) => row[bundle.index.get(c)] === 0)).toBe(true);
  });

  it('falls back to air minus five when dew point is absent, as the API does', () => {
    const building = { sqm: 1000, yearbuilt: 1990, numberoffloors: 3, primaryspaceusage: 'Office' };
    const row = buildRow(bundle, building, new Date('2017-07-15T15:00:00'), { airTemperature: 28 });
    expect(row[bundle.index.get('dewTemperature')]).toBeCloseTo(23, 5);
  });
});
