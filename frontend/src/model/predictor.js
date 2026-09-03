/**
 * The served cold-start model, evaluated in the browser.
 *
 * On GitHub Pages there is no server to call, and a dashboard that shows a
 * dead "Predict" button is not showing the model. A boosted tree ensemble is a
 * pure function of a feature vector, so the page carries the trees and walks
 * them itself. Nothing about the model is approximated here: the arrays come
 * out of XGBoost's own `save_model` output (see
 * `ai-service/scripts/export_model_json.py`) and the prediction is the same
 * sum of the same leaves.
 *
 * `buildRow` below mirrors `build_features` in `ai-service/app/main.py` term
 * for term. That mirroring is the one real risk in this file, so it is tested
 * rather than asserted: `predictor.test.js` replays a fixture of Python
 * predictions through this code and fails on any disagreement.
 *
 * Float32 is not a detail. The Python design row is cast to float32 and
 * XGBoost compares in float32; JavaScript numbers are float64. A feature
 * landing exactly on a split threshold would take different branches in the
 * two languages, so the feature vector here is a Float32Array and the
 * thresholds were rounded to float32 before export.
 */

/** Where `build_features` splits heating from cooling degree-hours. */
const FALLBACK_DEW_OFFSET = 5.0;

let bundlePromise = null;

/**
 * Fetch and cache the exported ensemble.
 *
 * Called only when a prediction is asked for, so the megabyte of trees is not
 * on the path of the first paint.
 */
export function loadModel(base = import.meta.env.BASE_URL) {
  if (!bundlePromise) {
    bundlePromise = fetch(`${base}model/energy_cold_start.json`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            `Model not published with this build (${res.status}). Run ` +
            '`python -m scripts.export_model_json` in ai-service/.',
          );
        }
        return res.json();
      })
      .then(prepare)
      .catch((err) => {
        // A failed fetch must not poison every later attempt.
        bundlePromise = null;
        throw err;
      });
  }
  return bundlePromise;
}

/** Index the feature columns once; `buildRow` runs on every slider move. */
export function prepare(bundle) {
  if (bundle.format !== 'bei-xgb-trees/1') {
    throw new Error(`Unsupported model format ${bundle.format}.`);
  }
  const index = new Map();
  bundle.feature_columns.forEach((name, i) => index.set(name, i));
  return { ...bundle, index };
}

/**
 * One design row, in the trained column order.
 *
 * `building` carries the BDG2 attributes; `when` is the timestamp being asked
 * about; `weather` the air temperature and its companions. Anything the model
 * was trained on but not given here stays NaN, which is a value XGBoost
 * handles — every split records the branch a missing value takes.
 */
export function buildRow(bundle, building, when, weather) {
  const columns = bundle.feature_columns;
  const x = new Float32Array(columns.length).fill(NaN);

  const t = Number(weather.airTemperature);
  const dew = weather.dewTemperature == null
    ? t - FALLBACK_DEW_OFFSET
    : Number(weather.dewTemperature);

  // Python's `weekday()` counts from Monday; JavaScript's `getDay()` from
  // Sunday. The model was trained on the former.
  const dayOfWeek = (when.getDay() + 6) % 7;

  const values = {
    hour: when.getHours(),
    day_of_week: dayOfWeek,
    month: when.getMonth() + 1,
    is_weekend: dayOfWeek >= 5 ? 1 : 0,
    airTemperature: t,
    dewTemperature: dew,
    windSpeed: weather.windSpeed == null ? 3.0 : Number(weather.windSpeed),
    cloudCoverage: weather.cloudCoverage == null ? 0.0 : Number(weather.cloudCoverage),
    cdh: Math.max(t - bundle.balance_point_c, 0.0),
    hdh: Math.max(bundle.balance_point_c - t, 0.0),
    log_sqm: Math.log(Number(building.sqm)),
    // Absent in BDG2 for half the portfolio. NaN, not a filled-in guess.
    building_age: building.yearbuilt
      ? bundle.age_reference_year - Number(building.yearbuilt)
      : NaN,
    numberoffloors: building.numberoffloors ? Number(building.numberoffloors) : NaN,
  };

  for (const [name, value] of Object.entries(values)) {
    const i = bundle.index.get(name);
    if (i !== undefined) x[i] = value;
  }

  for (let i = 0; i < columns.length; i += 1) {
    const eq = columns[i].indexOf('=');
    if (eq === -1) continue;
    const field = columns[i].slice(0, eq);
    const value = columns[i].slice(eq + 1);
    // A building with no recorded use scores 0 on every indicator, which is
    // what the Python side produces for it too.
    x[i] = String(building[field]) === value ? 1.0 : 0.0;
  }

  return x;
}

/** Walk one tree to its leaf. */
function leafValue(tree, x) {
  let i = 0;
  while (tree.left[i] !== -1) {
    const v = x[tree.feature[i]];
    const goLeft = Number.isNaN(v) ? tree.default_left[i] === 1 : v < tree.thresh[i];
    i = goLeft ? tree.left[i] : tree.right[i];
  }
  return tree.thresh[i];
}

/**
 * The ensemble's raw output for a design row.
 *
 * The objective is `reg:squarederror`, whose link is the identity, so the
 * margin is the base score plus the leaves. The exporter refuses any other
 * objective rather than letting this assumption go unchecked.
 */
export function rawScore(bundle, x) {
  let sum = bundle.base_score;
  for (const tree of bundle.trees) sum += leafValue(tree, x);
  return sum;
}

/** Predicted hourly demand in kWh. The model is trained on `log1p(kWh)`. */
export function predictKwh(bundle, building, when, weather) {
  return Math.expm1(rawScore(bundle, buildRow(bundle, building, when, weather)));
}
