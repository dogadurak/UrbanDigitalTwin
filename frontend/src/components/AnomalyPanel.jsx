import React, { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * When did this building stop resembling its own past?
 *
 * A baseline is fitted to the building's 2016 data from calendar and weather
 * alone and applied to 2017 — the whole-building approach of IPMVP Option C.
 * Two guards keep the output honest, and both are shown rather than hidden:
 * a persistent level change is reported as itself instead of flagging the whole
 * year, and if the baseline no longer describes the building at all, no events
 * are listed and the panel says why.
 */
export default function AnomalyPanel({ buildingId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!buildingId) return;
    setLoading(true); setError(null);
    api.anomaly(buildingId)
      .then(setData)
      .catch((e) => { setError(e.message); setData(null); })
      .finally(() => setLoading(false));
  }, [buildingId]);

  if (!buildingId) return null;
  if (loading) return <p className="text-[11px] text-slate-500">Fitting baseline on 2016…</p>;
  if (error) return <p className="text-[11px] text-rose-400">{error}</p>;
  if (!data) return null;

  if (!data.available) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-1">Deviation scan</h3>
        <p className="text-[11px] text-slate-500">{data.reason}</p>
      </div>
    );
  }

  const { baseline, reporting, level_shift: shift, summary, events, detection } = data;
  const valid = reporting.baseline_transfers;

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-200 mb-1">Deviation scan</h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Baseline fitted on this building's {baseline.period} from calendar and
        weather only, then applied to {reporting.period}.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <Stat label={`Baseline fit (${baseline.period})`} value={`${baseline.cv_rmse_pct}%`}
          sub="CV(RMSE) — the noise floor" />
        <Stat label={`Fit on ${reporting.period}`} value={`${reporting.cv_rmse_pct}%`}
          sub={valid ? 'baseline still holds' : 'baseline no longer holds'}
          tone={valid ? 'ok' : 'warn'} />
      </div>

      {Math.abs(shift.pct_of_baseline_mean) > 1 && (
        <div className={`rounded p-2.5 mb-3 border ${
          shift.material ? 'border-sky-900 bg-sky-950/30' : 'border-slate-800 bg-slate-900/50'}`}>
          <div className="text-[11px] text-slate-300">
            Level change {shift.pct_of_baseline_mean > 0 ? '+' : ''}
            {shift.pct_of_baseline_mean}% between periods
            {shift.material && <span className="text-sky-300"> — material</span>}
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500 mt-1">{shift.note}</p>
        </div>
      )}

      {!valid ? (
        <div className="border border-amber-900/60 bg-amber-950/20 rounded p-2.5">
          <div className="text-[12px] text-amber-200 font-medium mb-1">
            No events listed
          </div>
          <p className="text-[10px] leading-relaxed text-slate-300">{reporting.note}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Events" value={summary.n_events}
              sub={`${summary.n_over} over · ${summary.n_under} under`} />
            <Stat label="Excess" value={`${Math.round(summary.total_excess_kwh / 1000)} MWh`} tone="warn" />
            <Stat label="Longest" value={`${summary.longest_event_hours} h`} />
          </div>

          <div className="text-[11px] text-slate-400 mb-1">
            Largest deviations ({detection.sigma}σ, ≥{detection.min_event_hours} h)
          </div>
          <div className="space-y-1 mb-3">
            {events.slice(0, 8).map((e, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[11px] px-2 py-1 rounded bg-slate-900/50">
                <span className={e.direction === 'over' ? 'text-rose-400' : 'text-sky-400'}>
                  {e.direction === 'over' ? '▲' : '▼'}
                </span>
                <span className="text-slate-300 tabular-nums">{e.start.slice(0, 10)}</span>
                <span className="text-slate-500 tabular-nums">{e.hours}h</span>
                <span className="ml-auto tabular-nums text-slate-400">
                  {Math.round(e.excess_kwh).toLocaleString()} kWh
                </span>
                <span className="text-slate-600 tabular-nums w-12 text-right">{e.peak_sigma}σ</span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-[10px] leading-relaxed text-slate-500">{data.caveat}</p>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  const color = tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : 'text-slate-200';
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-[13px] tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-600 mt-0.5">{sub}</div>}
    </div>
  );
}
