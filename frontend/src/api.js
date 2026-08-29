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
};

/** Colour scale for CV(RMSE): green = accurate transfer, red = poor. */
export function scoreColor(cvRmse) {
  if (cvRmse == null) return '#475569';
  if (cvRmse < 60) return '#22c55e';
  if (cvRmse < 75) return '#84cc16';
  if (cvRmse < 100) return '#eab308';
  if (cvRmse < 150) return '#f97316';
  return '#ef4444';
}
