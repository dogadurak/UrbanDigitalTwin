import React from 'react';
import { scoreColor } from '../api';

/**
 * The model ladder across evaluation protocols.
 *
 * The columns are ordered from most optimistic to strictest on purpose: the
 * left-to-right increase within a row is the optimism that a looser protocol
 * buys, and it is one of the study's findings rather than a presentation
 * detail.
 */
export default function ResultsTable({ summary }) {
  if (!summary) return null;
  const { protocols, matrix, run, metric } = summary;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-200">Model ladder</h3>
        <span className="text-[11px] text-slate-500">
          {run.n_buildings?.toLocaleString()} buildings · {run.n_rows?.toLocaleString()} rows ·{' '}
          {run.seeds?.length ?? 0} seeds
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-slate-400">
              <th className="text-left font-medium py-1.5 pr-2">Model</th>
              {protocols.map((p) => (
                <th key={p.key} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.model} className="border-t border-slate-800">
                <td className="py-1.5 pr-2 text-slate-300 whitespace-nowrap">
                  {row.label}
                </td>
                {protocols.map((p) => {
                  const cell = row[p.key];
                  return (
                    <td key={p.key} className="text-right py-1.5 px-2 tabular-nums">
                      {cell ? (
                        <span style={{ color: scoreColor(cell.median) }}>
                          {cell.median.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {metric} Median across folds; the mean is skewed by folds containing very
        small consumers, where dividing by a near-zero building mean inflates the
        percentage.
      </p>
    </div>
  );
}
