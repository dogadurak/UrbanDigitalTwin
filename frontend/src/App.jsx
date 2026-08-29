import React, { useEffect, useMemo, useState } from 'react';
import GlobeMap from './components/GlobeMap';
import ResultsTable from './components/ResultsTable';
import PredictPanel from './components/PredictPanel';
import BuildingProfile from './components/BuildingProfile';
import EuiByUse from './components/EuiByUse';
import ScreeningPanel from './components/ScreeningPanel';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import { api, scoreColor, SCORE_STOPS } from './api';

/**
 * A results dashboard, not a simulation. Every value is read from the
 * evaluation harness output, the BDG2 measurements, or a live model call.
 */
export default function App() {
  const [task, setTask] = useState('cold_start');
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [cities, setCities] = useState(null);
  const [health, setHealth] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('results');
  const [buildingId, setBuildingId] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message));
    api.tasks().then((d) => setTasks(d.tasks || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setSummary(null); setCities(null);
    api.summary(task).then(setSummary).catch((e) => setError(e.message));
    api.byCity(task).then(setCities).catch(() => setCities(null));
  }, [task]);

  const headline = useMemo(() => {
    if (!summary) return null;
    const col = task === 'forecast' ? 'temporal' : 'leave_block_out';
    const get = (m) => summary.matrix.find((r) => r.model === m)?.[col]?.median;
    return {
      m2: get('M2_weather'), m3: get('M3_building'),
      identity: get('M3prime_site_identity'), naive: get('M0_seasonal_naive'),
    };
  }, [summary, task]);

  const selectedCity = cities?.blocks?.find((b) => b.block === selected);
  const isColdStart = task === 'cold_start';

  return (
    <div className="w-full h-screen flex flex-col bg-slate-950 text-slate-200 font-sans overflow-hidden">
      <header className="border-b border-slate-800 px-5 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Urban Building Energy — Benchmark
          </h1>
          <p className="text-[11px] text-slate-500">
            Building Data Genome 2 · {health?.trained_on_buildings?.toLocaleString() ?? '—'} buildings ·
            2016–2017 hourly · model {health?.spec ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tasks.map((t) => (
            <button key={t} onClick={() => setTask(t)}
              className={`text-[12px] px-3 py-1.5 rounded border transition ${
                task === t ? 'bg-sky-600 border-sky-500 text-white'
                           : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
              {t === 'forecast' ? 'Metered building' : 'Cold start (no history)'}
            </button>
          ))}
        </div>
      </header>

      {headline && (
        <div className="border-b border-slate-800 px-5 py-2.5 flex gap-6 items-center shrink-0">
          <Metric label="Seasonal naive" value={headline.naive} />
          <Metric label="+ weather" value={headline.m2} />
          <Metric label="+ site identity (control)" value={headline.identity} />
          <Metric label="+ building attributes" value={headline.m3} highlight />
          <div className="ml-auto text-[11px] text-slate-500 max-w-sm text-right leading-relaxed">
            {task === 'forecast'
              ? 'Hourly forecast error. ASHRAE Guideline 14 calibration threshold is 30%.'
              : 'Error when predicting a building with no meter history, in a city never seen in training.'}
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Map */}
        <div className="flex-1 relative min-w-0">
          {cities?.blocks?.some((b) => b.lat != null) ? (
            <>
              <GlobeMap blocks={cities.blocks} selected={selected} onSelect={setSelected} />
              <div className="absolute top-3 left-3 bg-slate-950/90 border border-slate-800 rounded px-3 py-2 max-w-xs">
                <div className="text-[12px] font-semibold text-slate-200">
                  Where the model transfers
                </div>
                <p className="text-[10px] leading-relaxed text-slate-400 mt-1">
                  Each disc is one city held out of training entirely. Colour is the
                  model's error there — <span className="text-emerald-400">green</span> means it
                  transferred well, <span className="text-rose-400">red</span> badly.
                </p>
                <div className="mt-2 space-y-0.5">
                  {SCORE_STOPS.map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                      <span className="w-3 h-2 rounded-sm" style={{ background: s.color }} />
                      CV(RMSE) {s.label}
                    </div>
                  ))}
                </div>
                <p className="text-[9px] leading-relaxed text-slate-600 mt-2">
                  Discs are 40 km wide — the dataset publishes city centroids, not
                  building locations, so this is the real positional uncertainty.
                </p>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600 text-sm px-8 text-center">
              {task === 'forecast'
                ? 'The metered-building task holds out time, not cities, so there is no transfer map for it. Switch to Cold start to see the map.'
                : 'No leave-one-city-out results yet. Run the ladder experiment.'}
            </div>
          )}
        </div>

        {/* Side panel */}
        <aside className="w-[440px] border-l border-slate-800 flex flex-col shrink-0">
          <nav className="flex border-b border-slate-800 shrink-0">
            {[['results', 'Results'], ['screening', 'Screening'],
              ['cities', 'Cities'], ['buildings', 'Buildings']].map(
              ([k, label]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={`flex-1 text-[12px] py-2 transition border-b-2 ${
                    tab === k ? 'border-sky-500 text-slate-100'
                              : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                  {label}
                </button>
              ))}
          </nav>

          <div className="flex-1 overflow-y-auto">
            {tab === 'results' && (
              <>
                <section className="p-4 border-b border-slate-800">
                  <ResultsTable summary={summary} />
                </section>
                <section className="p-4">
                  <EuiByUse />
                </section>
              </>
            )}

            {tab === 'screening' && (
              <section className="p-4">
                <ScreeningPanel onSelectBuilding={(id) => { setBuildingId(id); setTab('buildings'); }} />
              </section>
            )}

            {tab === 'cities' && (
              <section className="p-4">
                {!isColdStart && (
                  <p className="text-[11px] text-slate-500 mb-3">
                    City-level transfer is only defined for the cold-start task.
                  </p>
                )}
                <h3 className="text-sm font-semibold text-slate-200 mb-2">
                  {cities?.n_blocks ?? 0} held-out cities
                </h3>
                <div className="space-y-1">
                  {(cities?.blocks ?? []).map((b) => (
                    <button key={b.block}
                      onClick={() => setSelected(b.block === selected ? null : b.block)}
                      className={`w-full flex items-center gap-2 text-[12px] px-2 py-1.5 rounded transition ${
                        b.block === selected ? 'bg-slate-800' : 'hover:bg-slate-900'}`}>
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
                  <div className="mt-3 text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800 rounded p-2.5 leading-relaxed">
                    <strong className="text-slate-200">{selectedCity.sites.join(' / ')}</strong>
                    {selectedCity.sites.length > 1 && (
                      <span className="text-slate-500">
                        {' '}— {selectedCity.sites.length} BDG2 sites within 40 km of each other,
                        so they are one fold: holding out only part of a city would leak.
                      </span>
                    )}
                    <div className="mt-1.5">
                      building attributes improve this city by{' '}
                      <span className="text-emerald-400">{selectedCity.improvement}</span> CV(RMSE)
                      points over weather alone
                    </div>
                    {selectedCity.coord_status && selectedCity.coord_status !== 'ok' && (
                      <div className="text-amber-400 mt-1">
                        coordinate flagged: {selectedCity.coord_status}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {tab === 'buildings' && (
              <>
                <section className="p-4 border-b border-slate-800">
                  <PredictPanel health={health} onBuildingChange={setBuildingId} />
                </section>
                {buildingId && (
                  <>
                    <section className="p-4 border-b border-slate-800">
                      <DiagnosticsPanel buildingId={buildingId} />
                    </section>
                    <section className="p-4">
                      <h3 className="text-sm font-semibold text-slate-200 mb-2">
                        Measured 2017 load vs prediction
                      </h3>
                      <BuildingProfile buildingId={buildingId} />
                    </section>
                  </>
                )}
              </>
            )}
          </div>

          <footer className="px-4 py-3 border-t border-slate-800 text-[10px] text-slate-600 leading-relaxed shrink-0">
            No satellite or OSM feature is used: BDG2 coordinates are city-level with a
            40 km bound. See <code>docs/RESULTS.md</code>.
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
      <div className={`tabular-nums font-semibold ${highlight ? 'text-lg' : 'text-base'}`}
        style={{ color: highlight ? scoreColor(value) : '#cbd5e1' }}>
        {value != null ? `${value.toFixed(1)}%` : '—'}
      </div>
    </div>
  );
}
