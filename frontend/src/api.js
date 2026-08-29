const AI = import.meta.env.VITE_AI_URL || 'http://localhost:8000';

async function get(path) {
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

export const api = {
  health: () => get('/api/health'),
  tasks: () => get('/api/results/tasks'),
  summary: (task) => get(`/api/results/${task}/summary`),
  byCity: (task) => get(`/api/results/${task}/by-city`),
  contrasts: (task) => get(`/api/results/${task}/contrasts`),
  buildings: (limit = 200) => get(`/api/buildings?limit=${limit}`),
  predict: (body) => post('/api/predict', body),
  whatIf: (body) => post('/api/simulate-what-if', body),
  profile: (id, year = 2017) => get(`/api/explore/building/${id}/profile?year=${year}`),
  siteSummary: (site, year = 2017) => get(`/api/explore/site/${site}/summary?year=${year}`),
  euiByUse: () => get('/api/explore/eui-by-use'),
  anomaly: (id, sigma = 3.0) => get(`/api/anomaly/${id}?sigma=${sigma}`),
  diagnose: (id, year = 2017) => get(`/api/diagnose/${id}?year=${year}`),
  screening: (threshold = 2.0, limit = 40) =>
    get(`/api/screening?threshold=${threshold}&limit=${limit}`),
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
