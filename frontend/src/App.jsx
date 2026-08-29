import React, { useEffect, useMemo, useState } from 'react';
import GlobeMap from './components/GlobeMap';
import ResultsTable from './components/ResultsTable';
import PredictPanel from './components/PredictPanel';
import { api, scoreColor } from './api';

/**
 * A results dashboard, not a simulation.
 *
 * Everything shown is read from the evaluation harness output and the served
 * model. An earlier version of this interface animated drones, CCTV feeds and
 * lift positions over `Math.random()` telemetry for a fictional building; none
 * of it was measurement, so none of it is here.
 */
export default function App() {
  const [task, setTask] = useState('cold_start');
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [cities, setCities] = useState(null);
  const [health, setHealth] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message));
    api.tasks().then((d) => setTasks(d.tasks || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setSummary(null);
    setCities(null);
    api.summary(task).then(setSummary).catch((e) => setError(e.message));
    api.byCity(task).then(setCities).catch(() => setCities(null));
  }, [task]);

  const headline = useMemo(() => {
    if (!summary) return null;
    const col = task === 'forecast' ? 'temporal' : 'leave_block_out';
    const get = (m) => summary.matrix.find((r) => r.model === m)?.[col]?.median;
    return {
      column: summary.protocols.find((p) => p.key === col)?.label ?? col,
      m2: get('M2_weather'),
      m3: get('M3_building'),
      identity: get('M3prime_site_identity'),
      naive: get('M0_seasonal_naive'),
    };
  }, [summary, task]);

  const selectedCity = cities?.blocks?.find((b) => b.block === selected);

  return (
    <div className="w-full h-screen flex flex-col bg-slate-950 text-slate-200 font-sans overflow-hidden">
      {/* Header */}
      <header className="border-b border-slate-800 px-5 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Urban Building Energy — Benchmark
          </h1>
          <p className="text-[11px] text-slate-500">
            Building Data Genome 2 · {health?.trained_on_buildings?.toLocaleString() ?? '—'} buildings ·
            model {health?.spec ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tasks.map((t) => (
            <button
              key={t}
              onClick={() => setTask(t)}
              className={`text-[12px] px-3 py-1.5 rounded border transition ${
                task === t
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'forecast' ? 'Metered building' : 'Cold start'}
            </button>
          ))}
        </div>
      </header>

      {/* Headline strip */}
      {headline && (
        <div className="border-b border-slate-800 px-5 py-2.5 flex gap-6 items-center shrink-0 text-[12px]">
          <Metric label="Seasonal naive" value={headline.naive} />
          <Metric label="+ weather" value={headline.m2} />
          <Metric label="+ site identity (control)" value={headline.identity} />
          <Metric label="+ building attributes" value={headline.m3} highlight />
          <div className="ml-auto text-[11px] text-slate-500 max-w-md text-right">
            {task === 'forecast'
              ? 'ASHRAE Guideline 14 hourly calibration threshold is 30% CV(RMSE).'
              : 'Site identity is a perfect encoding of location — an upper bound on any satellite variable computable here.'}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative min-w-0">
          {cities?.blocks?.some((b) => b.lat != null) ? (
            <GlobeMap blocks={cities.blocks} selected={selected} onSelect={setSelected} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600 text-sm px-8 text-center">
              {task === 'forecast'
                ? 'The metered-building task has no held-out-city folds, so there is no transfer map to draw.'
                : 'No leave-one-city-out results yet. Run the ladder experiment.'}
            </div>
          )}
          {cities && (
            <div className="absolute bottom-3 left-3 right-3 bg-slate-950/85 border border-slate-800 rounded px-3 py-2 text-[10px] leading-relaxed text-slate-500">
              Discs are drawn at 40 km — the dataset's own positional uncertainty.{' '}
              {cities.coordinate_note} {cities.block_note}
            </div>
          )}
        </div>

        {/* Side panel */}
        <aside className="w-[420px] border-l border-slate-800 overflow-y-auto shrink-0">
          <section className="p-4 border-b border-slate-800">
            <ResultsTable summary={summary} />
          </section>

          {cities?.blocks?.length > 0 && (
            <section className="p-4 border-b border-slate-800">
              <h3 className="text-sm font-semibold text-slate-200 mb-2">
                Transfer to an unseen city
              </h3>
              <div className="space-y-1">
                {cities.blocks.map((b) => (
                  <button
                    key={b.block}
                    onClick={() => setSelected(b.block === selected ? null : b.block)}
                    className={`w-full flex items-center gap-2 text-[12px] px-2 py-1.5 rounded transition ${
                      b.block === selected ? 'bg-slate-800' : 'hover:bg-slate-900'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: scoreColor(b.cv_rmse) }} />
                    <span className="text-slate-300 truncate">{b.sites.join(' / ')}</span>
                    <span className="ml-auto tabular-nums" style={{ color: scoreColor(b.cv_rmse) }}>
                      {b.cv_rmse ?? '—'}%
                    </span>
                  </button>
                ))}
              </div>
              {selectedCity && (
                <div className="mt-2 text-[11px] text-slate-500 bg-slate-900/60 border border-slate-800 rounded p-2">
                  <strong className="text-slate-300">{selectedCity.sites.join(' / ')}</strong>
                  {selectedCity.sites.length > 1 && ' — merged: within 40 km of each other'}
                  <br />
                  building attributes improve this fold by{' '}
                  <span className="text-emerald-400">{selectedCity.improvement}</span> CV(RMSE) points
                  {selectedCity.coord_status && selectedCity.coord_status !== 'ok' && (
                    <><br /><span className="text-amber-400">
                      coordinate flagged: {selectedCity.coord_status}
                    </span></>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="p-4">
            <PredictPanel health={health} />
          </section>

          <footer className="px-4 pb-4 text-[10px] text-slate-600 leading-relaxed">
            No satellite, LCZ or OSM feature is used: BDG2 coordinates are
            city-level with a 40 km bound, so none can be attributed to a
            building. See <code>docs/RESULTS.md</code>.
            {error && <div className="text-rose-500 mt-1">{error}</div>}
          </footer>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div
        className={`tabular-nums font-semibold ${highlight ? 'text-lg' : 'text-base'}`}
        style={{ color: highlight ? scoreColor(value) : '#cbd5e1' }}
      >
        {value != null ? `${value.toFixed(1)}%` : '—'}
      </div>
    </div>
  );
}
