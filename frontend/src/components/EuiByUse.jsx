import React, { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api';

/**
 * Measured energy intensity by building use, across all sites.
 *
 * This is the gradient that explains the study's main finding. Building use
 * spans 12x from parking to healthcare, in the order building physics predicts,
 * which is why attributes outperform location by 7.7x in the cold-start task.
 * It is measured, not modelled.
 */
export default function EuiByUse() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.euiByUse().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="text-[11px] text-rose-400">{error}</p>;
  if (!data) return <p className="text-[11px] text-slate-500">Loading measured intensities…</p>;

  const rows = data.uses.map((u) => ({
    use: u.use.length > 20 ? `${u.use.slice(0, 19)}…` : u.use,
    median: u.median_eui,
    n: u.n,
  }));
  const max = Math.max(...rows.map((r) => r.median));

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-200 mb-1">
        Measured intensity by use
      </h3>
      <p className="text-[11px] text-slate-500 mb-2">
        Median {data.unit}, {data.year}. Buildings with n ≥ 10 per category.
      </p>

      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical"
            margin={{ top: 0, right: 12, left: 70, bottom: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} stroke="#334155" />
            <YAxis type="category" dataKey="use" width={110}
              tick={{ fontSize: 10, fill: '#94a3b8' }} stroke="#334155" />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155',
                fontSize: 11, borderRadius: 4 }}
              formatter={(v, _n, p) => [`${v} Wh/m²·h  (n=${p.payload.n})`, 'median']}
            />
            <Bar dataKey="median" radius={[0, 3, 3, 0]}>
              {rows.map((r, i) => (
                <Cell key={i} fill={`hsl(${200 - (r.median / max) * 200}, 70%, 55%)`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{data.note}</p>
    </div>
  );
}
