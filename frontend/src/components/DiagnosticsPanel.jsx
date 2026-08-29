import React, { useEffect, useState } from 'react';
import { api } from '../api';

const LABELS = {
  base_peak: 'Always-on share of peak',
  night_day: 'Overnight vs occupied hours',
  weekend_weekday: 'Weekend vs weekday',
  summer_shoulder: 'Summer vs shoulder season',
  winter_shoulder: 'Winter vs shoulder season',
};

/**
 * What to check, and what would rule it out.
 *
 * The findings come from the shape of the measured load compared against the
 * building's peer group, not from its total. Each one is a hypothesis with an
 * inspection attached — and each carries the legitimate explanation that would
 * dismiss it, because a high overnight load is as consistent with a data centre
 * as with a scheduling fault.
 */
export default function DiagnosticsPanel({ buildingId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!buildingId) return;
    setLoading(true); setError(null);
    api.diagnose(buildingId)
      .then(setData)
      .catch((e) => { setError(e.message); setData(null); })
      .finally(() => setLoading(false));
  }, [buildingId]);

  if (!buildingId) return null;
  if (loading) return <p className="text-[11px] text-slate-500">Comparing load shape to peers…</p>;
  if (error) return <p className="text-[11px] text-rose-400">{error}</p>;
  if (!data) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-200 mb-1">What to check first</h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Load shape against {data.peer_group.n} peer buildings of the same use
        ({data.use}). Shape says <em>when</em> the energy goes, which totals cannot.
      </p>

      <div className="bg-slate-900/60 border border-slate-800 rounded p-2.5 mb-3">
        <div className="text-[9px] uppercase tracking-wide text-slate-500">Summary</div>
        <div className="text-[12px] text-slate-200 mt-0.5">{data.summary}</div>
      </div>

      {data.findings.length > 0 && (
        <div className="space-y-2 mb-3">
          {data.findings.map((f) => (
            <div key={f.metric} className="border border-amber-900/50 bg-amber-950/20 rounded p-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] text-amber-200 font-medium">{f.headline}</span>
                <span className="ml-auto text-[10px] tabular-nums text-amber-400/80 shrink-0">
                  {f.value} vs {f.peer_median}
                </span>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-300 mt-1.5">
                <strong className="text-slate-400">Inspect:</strong> {f.action}
              </p>
              <p className="text-[10px] leading-relaxed text-slate-500 mt-1">
                <strong>Would explain it:</strong> {f.would_rule_out}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="text-[11px] text-slate-400 mb-1">All shape metrics</div>
      <table className="w-full text-[11px] border-collapse mb-2">
        <thead>
          <tr className="text-slate-500">
            <th className="text-left font-medium py-1">Metric</th>
            <th className="text-right font-medium py-1 px-1">This</th>
            <th className="text-right font-medium py-1 px-1">Peers</th>
            <th className="text-right font-medium py-1">Pctile</th>
          </tr>
        </thead>
        <tbody>
          {data.metrics.map((m) => (
            <tr key={m.metric} className="border-t border-slate-800/70">
              <td className={`py-1 ${m.flagged ? 'text-amber-300' : 'text-slate-400'}`}>
                {LABELS[m.metric] ?? m.metric}
              </td>
              <td className={`text-right py-1 px-1 tabular-nums ${m.flagged ? 'text-amber-300' : 'text-slate-300'}`}>
                {m.value}
              </td>
              <td className="text-right py-1 px-1 tabular-nums text-slate-500">{m.peer_median}</td>
              <td className="text-right py-1 tabular-nums text-slate-500">
                {Math.round(m.percentile * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-[10px] leading-relaxed text-slate-500">{data.caveat}</p>
    </div>
  );
}
