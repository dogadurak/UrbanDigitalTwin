import React, { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A building's real 2017 load, with the model's cold-start prediction over it.
 *
 * This is the evidence behind the headline metric. The model is given no past
 * reading for this building, so the two curves are a genuine out-of-sample
 * comparison rather than a fit replayed against its own training data.
 */
export default function BuildingProfile({ buildingId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!buildingId) return;
    setLoading(true);
    setError(null);
    api.profile(buildingId)
      .then(setData)
      .catch((e) => { setError(e.message); setData(null); })
      .finally(() => setLoading(false));
  }, [buildingId]);

  if (!buildingId) return null;
  if (loading) return <p className="text-[11px] text-slate-500">Loading measured series…</p>;
  if (error) return <p className="text-[11px] text-rose-400">{error}</p>;
  if (!data) return null;

  const hourly = data.by_hour.map((r) => ({
    hour: r.hour, Measured: r.measured, Predicted: r.predicted ?? null,
  }));
  const weekly = data.by_weekday.map((r) => ({
    day: DAYS[r.day_of_week], Measured: r.measured, Predicted: r.predicted ?? null,
  }));
  const monthly = data.by_month.map((r) => ({
    month: MONTHS[r.month - 1], Measured: r.measured, Predicted: r.predicted ?? null,
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Measured mean" value={`${data.measured.mean_kwh} kWh`} />
        <Stat label="Energy intensity" value={`${data.measured.eui_wh_m2_h} Wh/m²·h`} />
        <Stat label="Hours of data" value={data.n_hours.toLocaleString()} />
      </div>

      {data.model && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Model CV(RMSE)" value={`${data.model.cv_rmse_pct}%`} accent />
          <Stat label="Model bias (NMBE)" value={`${data.model.nmbe_pct > 0 ? '+' : ''}${data.model.nmbe_pct}%`} accent />
        </div>
      )}

      <Chart title="Average day — measured vs predicted" data={hourly} xKey="hour" />
      <Chart title="Average by weekday" data={weekly} xKey="day" bars />
      <Chart title="Seasonal — monthly mean" data={monthly} xKey="month" />

      <p className="text-[10px] leading-relaxed text-slate-500">
        {data.attributes.use} · {Math.round(data.attributes.sqm).toLocaleString()} m²
        {data.attributes.yearbuilt ? ` · built ${data.attributes.yearbuilt}` : ''} · site {data.site_id}.
        {data.model && ` ${data.model.note}`}
      </p>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-[13px] tabular-nums ${accent ? 'text-amber-300' : 'text-slate-200'}`}>
        {value}
      </div>
    </div>
  );
}

function Chart({ title, data, xKey, bars }) {
  const Wrapper = bars ? BarChart : LineChart;
  return (
    <div>
      <div className="text-[11px] text-slate-400 mb-1">{title}</div>
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Wrapper data={data} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#64748b' }} stroke="#334155" />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} stroke="#334155" />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155',
                fontSize: 11, borderRadius: 4 }}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {bars ? (
              <>
                <Bar dataKey="Measured" fill="#38bdf8" />
                <Bar dataKey="Predicted" fill="#f59e0b" />
              </>
            ) : (
              <>
                <Line type="monotone" dataKey="Measured" stroke="#38bdf8" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="Predicted" stroke="#f59e0b" dot={false} strokeWidth={2}
                  strokeDasharray="4 3" />
              </>
            )}
          </Wrapper>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
