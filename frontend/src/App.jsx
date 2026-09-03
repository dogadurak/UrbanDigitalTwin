import React, { useEffect, useMemo, useRef, useState } from 'react';
import GlobeMap from './components/GlobeMap';
import ResultsTable from './components/ResultsTable';
import PredictPanel from './components/PredictPanel';
import BuildingProfile from './components/BuildingProfile';
import EuiByUse from './components/EuiByUse';
import ScreeningPanel from './components/ScreeningPanel';
import DiagnosticsPanel from './components/DiagnosticsPanel';
import AnomalyPanel from './components/AnomalyPanel';
import { api, isStatic, staticInfo, scoreColor, SCORE_STOPS } from './api';

/**
 * The width the reader last dragged the panel to, or the default.
 *
 * Reading `localStorage` can throw, not just return null: a browser set to
 * block site data raises SecurityError on the property itself. This runs
 * inside the initialiser of the top-level component, so an unguarded read
 * takes the whole page down to a blank screen over a remembered pane width.
 */
function readRememberedWidth() {
  try {
    return Number(window.localStorage.getItem('bei.panelWidth')) || 500;
  } catch {
    return 500;
  }
}

/**
 * A results dashboard, not a simulation. Every value is read from the
 * evaluation harness output, the BDG2 measurements, or a live model call.
 */
export default function App() {
  const [task, setTask] = useState('cold_start');
  const [tasks, setTasks] = useState([]);
  const activeTask = tasks.find((t) => t.key === task);
  const isColdStartTask = !activeTask || activeTask.group === 'cold_start';
  const [summary, setSummary] = useState(null);
  const [cities, setCities] = useState(null);
  const [health, setHealth] = useState(null);
  const [selected, setSelected] = useState(null);
  // Tab lives in the URL hash so a view can be linked to, and so the
  // screenshot script can address each one directly.
  const [tab, setTabState] = useState(
    () => (typeof window !== 'undefined' && window.location.hash.slice(1)) || 'results',
  );
  const setTab = (t) => {
    setTabState(t);
    if (typeof window !== 'undefined') window.location.hash = t;
  };
  const [buildingId, setBuildingId] = useState('');
  const [error, setError] = useState(null);
  // Null on a live build. On the published one it carries the date the figures
  // were frozen, which the footer states.
  const [snapshot, setSnapshot] = useState(null);

  // Below this the two panes cannot both be useful, so they stack instead of
  // sitting side by side. A 500px panel next to a map on a 375px phone leaves
  // the map exactly zero pixels wide, and the root is overflow-hidden, so the
  // panel is clipped rather than scrolled: the page shows neither.
  const NARROW_PX = 860;
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW_PX,
  );

  // Panel width is draggable and remembered: the ladder table wants room, the
  // map wants room, and which matters depends on what you are reading. The
  // remembered value is clamped to this viewport -- it was stored on whatever
  // screen the reader last used, which may have been a much wider one.
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 500;
    return Math.max(Math.min(readRememberedWidth(), window.innerWidth - 320), 320);
  });
  const dragging = useRef(false);

  useEffect(() => {
    const onResize = () => {
      setNarrow(window.innerWidth < NARROW_PX);
      setPanelWidth((w) => Math.max(Math.min(w, window.innerWidth - 320), 320));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      // Clamped so neither pane can be dragged away entirely.
      const next = Math.min(Math.max(window.innerWidth - e.clientX, 360), window.innerWidth - 320);
      setPanelWidth(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { window.localStorage.setItem('bei.panelWidth', String(panelWidth)); } catch { /* private mode */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panelWidth]);

  useEffect(() => {
    api.health().then(setHealth).catch((e) => setError(e.message));
    api.tasks().then((d) => setTasks(d.tasks || [])).catch(() => {});
    staticInfo().then(setSnapshot).catch(() => setSnapshot(null));
    const onHash = () => setTabState(window.location.hash.slice(1) || 'results');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setSummary(null); setCities(null);
    api.summary(task).then(setSummary).catch((e) => setError(e.message));
    api.byCity(task).then(setCities).catch(() => setCities(null));
  }, [task]);

  const headline = useMemo(() => {
    if (!summary) return null;
    const col = isColdStartTask ? 'leave_block_out' : 'temporal';
    const get = (m) => summary.matrix.find((r) => r.model === m)?.[col]?.median;
    return {
      m2: get('M2_weather'), m3: get('M3_building'),
      identity: get('M3prime_site_identity'), naive: get('M0_seasonal_naive'),
    };
  }, [summary, task]);

  const selectedCity = cities?.blocks?.find((b) => b.block === selected);

  return (
    <div className="w-full h-screen flex flex-col bg-slate-950 text-slate-200 font-sans overflow-hidden">
      <header className="border-b border-slate-800 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-y-2 shrink-0">
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Building Energy Intelligence
          </h1>
          <p className="text-[11px] text-slate-500">
            Building Data Genome 2 · {health?.trained_on_buildings?.toLocaleString() ?? '—'} buildings ·
            2016–2017 hourly · model {health?.spec ?? '—'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-slate-600 mr-1">
              Metered · forecast horizon
            </span>
            {tasks.filter((t) => t.group === 'forecast').map((t) => (
              <button key={t.key} onClick={() => setTask(t.key)}
                className={`text-[12px] px-2.5 py-1.5 rounded border transition ${
                  task === t.key ? 'bg-sky-600 border-sky-500 text-white'
                                 : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
                {t.label}
              </button>
            ))}
          </div>
          {tasks.filter((t) => t.group === 'cold_start').map((t) => (
            <button key={t.key} onClick={() => setTask(t.key)}
              className={`text-[12px] px-3 py-1.5 rounded border transition ${
                task === t.key ? 'bg-sky-600 border-sky-500 text-white'
                               : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {headline && (
        <div className="border-b border-slate-800 px-4 sm:px-5 py-2.5 flex flex-wrap gap-x-6 gap-y-2 items-center shrink-0">
          <Metric label="Seasonal naive" value={headline.naive} />
          <Metric label="+ weather" value={headline.m2} />
          <Metric label="+ site identity (control)" value={headline.identity} />
          <Metric label="+ building attributes" value={headline.m3} highlight />
          <div className="ml-auto text-[11px] text-slate-500 max-w-sm text-right leading-relaxed">
            {isColdStartTask
              ? 'Error when predicting a building with no meter history, in a city never seen in training.'
              : `Forecast error ${activeTask?.label ?? ''}, for a building already metered. ASHRAE Guideline 14 allows 30%.`}
          </div>
        </div>
      )}

      <div className={`flex-1 flex min-h-0 ${narrow ? 'flex-col' : ''}`}>
        {/* Map */}
        <div className={`relative min-w-0 min-h-0 ${narrow ? 'h-[45vh] shrink-0' : 'flex-1'}`}>
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
              {isColdStartTask
                ? 'No leave-one-city-out results yet. Run the ladder experiment.'
                : 'A forecast horizon holds out time, not cities, so there is no transfer map for it. Switch to "No meter history" to see the map.'}
            </div>
          )}
        </div>

        {/* Drag handle — pointless when the panes are stacked */}
        {!narrow && (
        <div
          onMouseDown={() => {
            dragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          onDoubleClick={() => setPanelWidth(500)}
          title="Drag to resize · double-click to reset"
          className="w-1.5 shrink-0 cursor-col-resize bg-slate-800 hover:bg-sky-600 transition-colors"
        />
        )}

        {/* Side panel */}
        <aside style={narrow ? undefined : { width: panelWidth }}
          className={`border-slate-800 flex flex-col min-h-0 ${
            narrow ? 'w-full flex-1 border-t' : 'shrink-0 border-l'}`}>
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
                {!isColdStartTask && (
                  <p className="text-[11px] text-slate-500 mb-3">
                    City-level transfer is only defined without meter history.
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
                    <section className="p-4 border-b border-slate-800">
                      <AnomalyPanel buildingId={buildingId} />
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
            {isStatic && (
              <div className="mt-1.5 text-slate-500">
                Published snapshot: every figure here is a response the API returned
                {snapshot?.generatedAt
                  ? ` on ${new Date(snapshot.generatedAt).toISOString().slice(0, 10)}`
                  : ''}
                , frozen to a file. Predictions are not frozen — the model itself runs
                in this page. Run the service locally for live data.
              </div>
            )}
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
