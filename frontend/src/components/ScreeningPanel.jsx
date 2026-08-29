import React, { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * The decision layer: which buildings to send an auditor to first.
 *
 * A building is listed only when two independent peer tests agree — its
 * measured intensity against the median for its use, and its consumption
 * against what the model predicts for a building of that type, size and age.
 * A deviation smaller than the model's demonstrated out-of-sample error cannot
 * put a building on this list.
 */
export default function ScreeningPanel({ onSelectBuilding }) {
  const [threshold, setThreshold] = useState(2.0);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.screening(threshold, 40)
      .then(setData)
      .catch((e) => { setError(e.message); setData(null); })
      .finally(() => setLoading(false));
  }, [threshold]);

  const s = data?.summary;

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-200 mb-1">
        Where to look first
      </h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Buildings consuming well above comparable buildings — a triage list for
        an energy audit, ranked by how much energy is at stake.
      </p>

      <label className="block mb-3">
        <span className="text-[11px] text-slate-400">
          Flag above {threshold.toFixed(1)}× the median for its use type
        </span>
        <input type="range" min="1.5" max="4" step="0.5" value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="w-full mt-1" />
      </label>

      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      {/* Dim the previous result while a new threshold is being screened.
          Showing "screening…" above numbers computed for the old threshold
          read as though those numbers were the answer to the new one. */}
      <div className={loading ? 'opacity-40 pointer-events-none transition-opacity' : 'transition-opacity'}>
      {loading && (
        <p className="text-[11px] text-slate-400 mb-2">
          Screening at {threshold.toFixed(1)}× …
        </p>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Stat label="Flagged" value={`${s.n_flagged} / ${s.n_screened}`}
              sub={`${(s.share_flagged * 100).toFixed(1)}% of portfolio`} />
            <Stat label="Energy above peer level" value={`${s.excess_annual_gwh} GWh/yr`}
              sub={`${(s.excess_share_of_portfolio * 100).toFixed(1)}% of ${s.portfolio_annual_gwh} GWh`}
              accent />
          </div>

          <div className="space-y-1 mb-3">
            {(data.buildings || []).map((b, i) => (
              <button key={b.building_id}
                onClick={() => onSelectBuilding?.(b.building_id)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-900 transition group">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-slate-600 w-5 shrink-0">{i + 1}.</span>
                  <span className="text-[12px] text-slate-300 truncate group-hover:text-sky-300">
                    {b.building_id}
                  </span>
                  <span className="ml-auto text-[11px] tabular-nums text-amber-400 shrink-0">
                    {b.peer_ratio}×
                  </span>
                </div>
                <div className="flex items-baseline gap-2 pl-7">
                  <span className="text-[10px] text-slate-500 truncate">
                    {b.use} · {Math.round(b.sqm).toLocaleString()} m²
                    {b.yearbuilt ? ` · ${b.yearbuilt}` : ''}
                  </span>
                  <span className="ml-auto text-[10px] tabular-nums text-slate-500 shrink-0">
                    +{Math.round(b.excess_kwh / 1000).toLocaleString()} MWh/yr
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="text-[10px] leading-relaxed text-slate-500 bg-slate-900/60 border border-slate-800 rounded p-2.5 space-y-1.5">
            <p><strong className="text-slate-400">How a building gets here:</strong> {s.model_note}</p>
            <p><strong className="text-amber-500/80">Not a verdict.</strong> {s.caveat}</p>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-[15px] tabular-nums font-semibold ${accent ? 'text-amber-300' : 'text-slate-200'}`}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}
