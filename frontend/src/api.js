import { loadModel, predictKwh } from './model/predictor';

/**
 * One API surface, two backings.
 *
 * Running locally, this talks to the FastAPI service: every value is computed
 * on request from the BDG2 parquet partitions and the served model.
 *
 * Published to GitHub Pages, there is no service to talk to. Pages serves
 * files. So a build with `VITE_STATIC_DATA=1` reads frozen responses from
 * `public/data/`, written by `ai-service/scripts/export_web_data.py` straight
 * out of the same endpoints, and runs the model itself in the page for the one
 * thing that cannot be frozen — a prediction for arbitrary input.
 *
 * Each method therefore names two things: the live URL, and the file the
 * export wrote for it. They are kept together deliberately. A path assembled
 * on one side and taken apart on the other is how a showcase starts serving
 * last month's numbers under this month's labels.
 */

const AI = import.meta.env.VITE_AI_URL || 'http://localhost:8000';
const STATIC = import.meta.env.VITE_STATIC_DATA === '1';
const BASE = import.meta.env.BASE_URL;

/** True when this build reads frozen data instead of a live service. */
export const isStatic = STATIC;

let manifestPromise = null;

/**
 * What the export actually contains.
 *
 * Consulted before every read so a gap is reported as a gap. Without it a
 * missing file arrives as GitHub's 404 page, and JSON parsing fails with a
 * message about an unexpected `<`, which says nothing about what went wrong.
 */
function manifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}data/manifest.json`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            'No static data published with this build. Run ' +
            '`python -m scripts.export_web_data` in ai-service/.',
          );
        }
        return res.json();
      })
      .then((m) => ({ ...m, index: new Set(m.files) }))
      .catch((err) => { manifestPromise = null; throw err; });
  }
  return manifestPromise;
}

/**
 * When this build's figures were frozen, or null on a live build.
 *
 * The page says so where a reader can see it. A dashboard that looks live and
 * is not is the more misleading of the two failure modes.
 */
export async function staticInfo() {
  if (!STATIC) return null;
  const m = await manifest();
  return { generatedAt: m.generated_at, nFiles: m.n_files };
}

async function getStatic(stem) {
  const m = await manifest();
  if (!m.index.has(stem)) {
    throw new Error(
      `Not in the published export (${stem}). The live API serves this; ` +
      'see the README to run it locally.',
    );
  }
  const res = await fetch(`${BASE}data/${stem}.json`);
  if (!res.ok) throw new Error(`${stem}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function get(path, stem) {
  if (STATIC) return getStatic(stem);
  const res = await fetch(`${AI}${path}`);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* keep statusText */ }
    throw new Error(detail);
  }
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${AI}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* keep statusText */ }
    throw new Error(detail);
  }
  return res.json();
}

// --------------------------------------------------------------------------
// Static-build model serving
// --------------------------------------------------------------------------

let attributesPromise = null;

/** BDG2 attributes for the buildings this export reaches, keyed by id. */
function attributes() {
  if (!attributesPromise) {
    attributesPromise = getStatic('model/attributes')
      .catch((err) => { attributesPromise = null; throw err; });
  }
  return attributesPromise;
}

/**
 * The building, checked the way `_require_building` in `app/main.py` checks it.
 *
 * A building with no floor area cannot be given to the model at all — `sqm` is
 * the EUI denominator and a feature — and saying so is more use than returning
 * a number derived from `log(NaN)`.
 */
async function requireBuilding(buildingId) {
  const attrs = await attributes();
  const b = attrs[buildingId];
  if (!b) {
    throw new Error(`Unknown building '${buildingId}'. See the building list.`);
  }
  if (!(b.sqm > 0)) {
    throw new Error(
      `Building '${buildingId}' has no usable floor area in BDG2 metadata, so ` +
      'the model cannot be applied.',
    );
  }
  return b;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** `POST /api/predict`, computed in the page. Same response shape. */
async function staticPredict(body) {
  const [bundle, building] = await Promise.all([
    loadModel(BASE), requireBuilding(body.building_id),
  ]);
  const expected = predictKwh(bundle, building, new Date(body.timestamp), body);
  const { cv_rmse_pct: cv } = bundle.band_basis;

  const margin = cv ? (expected * cv) / 100.0 : null;
  return {
    building_id: body.building_id,
    timestamp: body.timestamp,
    expected_energy_kwh: round2(expected),
    expected_band_1cvrmse: margin == null ? null : {
      lo: round2(Math.max(expected - margin, 0.0)),
      hi: round2(expected + margin),
    },
    band_basis: bundle.band_basis,
    building: {
      site_id: building.site_id,
      use: building.primaryspaceusage,
      sqm: building.sqm,
      yearbuilt: building.yearbuilt,
    },
  };
}

/** `POST /api/simulate-what-if`, computed in the page. Same response shape. */
async function staticWhatIf(body) {
  const [bundle, building] = await Promise.all([
    loadModel(BASE), requireBuilding(body.building_id),
  ]);
  const when = body.timestamp ? new Date(body.timestamp) : new Date();
  const baselineT = body.baseline_airTemperature == null
    ? Number(body.airTemperature) - 5.0
    : Number(body.baseline_airTemperature);

  const common = { windSpeed: body.windSpeed, cloudCoverage: body.cloudCoverage };
  const baseline = predictKwh(bundle, building, when, { ...common, airTemperature: baselineT });
  const scenario = predictKwh(bundle, building, when, { ...common, airTemperature: body.airTemperature });

  return {
    building_id: body.building_id,
    timestamp: when.toISOString(),
    baseline: { airTemperature: baselineT, expected_energy_kwh: round2(baseline) },
    scenario: { airTemperature: body.airTemperature, expected_energy_kwh: round2(scenario) },
    delta_kwh: round2(scenario - baseline),
    delta_pct: baseline > 0 ? round2((100.0 * (scenario - baseline)) / baseline) : null,
    note: 'Weather sensitivity only. The model uses no spatial or '
        + 'remote-sensing input; see GET /api/health.',
  };
}

export const api = {
  health: () => get('/api/health', 'health'),
  tasks: () => get('/api/results/tasks', 'results/tasks'),
  summary: (task) => get(`/api/results/${task}/summary`, `results/${task}/summary`),
  byCity: (task) => get(`/api/results/${task}/by-city`, `results/${task}/by-city`),
  contrasts: (task) => get(`/api/results/${task}/contrasts`, `results/${task}/contrasts`),
  // The export holds one list; slicing it here is the endpoint's own LIMIT,
  // applied to the same `ORDER BY building_id`.
  buildings: async (limit = 200) => {
    const d = await get(`/api/buildings?limit=${limit}`, 'buildings');
    return STATIC ? { buildings: (d.buildings || []).slice(0, limit) } : d;
  },
  predict: (body) => (STATIC ? staticPredict(body) : post('/api/predict', body)),
  whatIf: (body) => (STATIC ? staticWhatIf(body) : post('/api/simulate-what-if', body)),
  profile: (id, year = 2017) =>
    get(`/api/explore/building/${id}/profile?year=${year}`, `explore/building/${id}/profile`),
  siteSummary: (site, year = 2017) =>
    get(`/api/explore/site/${site}/summary?year=${year}`, `explore/site/${site}/summary`),
  euiByUse: () => get('/api/explore/eui-by-use', 'explore/eui-by-use'),
  anomaly: (id, sigma = 3.0) => get(`/api/anomaly/${id}?sigma=${sigma}`, `anomaly/${id}`),
  diagnose: (id, year = 2017) => get(`/api/diagnose/${id}?year=${year}`, `diagnose/${id}`),
  screening: async (threshold = 2.0, limit = 40) => {
    const d = await get(
      `/api/screening?threshold=${threshold}&limit=${limit}`,
      `screening/${Number(threshold).toFixed(1)}`,
    );
    return STATIC ? { ...d, buildings: (d.buildings || []).slice(0, limit) } : d;
  },
};

/** Legend stops for the CV(RMSE) colour scale, shared by map and swatches. */
export const SCORE_STOPS = [
  { max: 60, color: '#22c55e', label: '< 60%' },
  { max: 75, color: '#84cc16', label: '60–75%' },
  { max: 100, color: '#eab308', label: '75–100%' },
  { max: 150, color: '#f97316', label: '100–150%' },
  { max: Infinity, color: '#ef4444', label: '> 150%' },
];

/** Colour scale for CV(RMSE): green = accurate transfer, red = poor. */
export function scoreColor(cvRmse) {
  if (cvRmse == null) return '#475569';
  if (cvRmse < 60) return '#22c55e';
  if (cvRmse < 75) return '#84cc16';
  if (cvRmse < 100) return '#eab308';
  if (cvRmse < 150) return '#f97316';
  return '#ef4444';
}
