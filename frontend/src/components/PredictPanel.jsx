import React, { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Live cold-start prediction against the served model.
 *
 * The uncertainty band is the model's validated out-of-sample CV(RMSE), and the
 * panel says which protocol produced it. A point estimate without that context
 * would overstate what the model knows about a building it has never metered.
 */
export default function PredictPanel({ health }) {
  const [buildings, setBuildings] = useState([]);
  const [buildingId, setBuildingId] = useState('');
  const [temp, setTemp] = useState(28);
  const [hour, setHour] = useState(15);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.buildings(300)
      .then((d) => {
        setBuildings(d.buildings || []);
        if (d.buildings?.length) setBuildingId(d.buildings[0].building_id);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function run() {
    if (!buildingId) return;
    setBusy(true);
    setError(null);
    try {
      const ts = `2017-07-15T${String(hour).padStart(2, '0')}:00:00`;
      const r = await api.predict({
        building_id: buildingId,
        timestamp: ts,
        airTemperature: Number(temp),
        dewTemperature: Number(temp) - 8,
      });
      setResult(r);
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  const selected = buildings.find((b) => b.building_id === buildingId);

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-200 mb-1">
        Cold-start prediction
      </h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Predicts hourly demand for a building with <em>no</em> meter history, from
        its attributes, the calendar and the weather.
      </p>

      <div className="space-y-2.5">
        <label className="block">
          <span className="text-[11px] text-slate-400">Building</span>
          <select
            className="w-full mt-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-[12px] text-slate-200"
            value={buildingId}
            onChange={(e) => setBuildingId(e.target.value)}
          >
            {buildings.map((b) => (
              <option key={b.building_id} value={b.building_id}>
                {b.building_id} · {b.primaryspaceusage} · {Math.round(b.sqm).toLocaleString()} m²
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[11px] text-slate-400">Temperature {temp}°C</span>
            <input type="range" min="-20" max="45" value={temp}
              onChange={(e) => setTemp(e.target.value)} className="w-full mt-1" />
          </label>
          <label className="block">
            <span className="text-[11px] text-slate-400">Hour {hour}:00</span>
            <input type="range" min="0" max="23" value={hour}
              onChange={(e) => setHour(e.target.value)} className="w-full mt-1" />
          </label>
        </div>

        <button
          onClick={run}
          disabled={busy || !buildingId}
          className="w-full bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-[12px] font-medium rounded py-1.5 transition"
        >
          {busy ? 'Predicting…' : 'Predict'}
        </button>
      </div>

      {error && (
        <p className="mt-3 text-[11px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-2 py-1.5">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3 bg-slate-900/60 border border-slate-800 rounded p-3">
          <div className="text-2xl font-semibold text-sky-300 tabular-nums">
            {result.expected_energy_kwh.toLocaleString()}{' '}
            <span className="text-sm text-slate-400 font-normal">kWh</span>
          </div>
          {result.expected_band_1cvrmse && (
            <div className="text-[11px] text-slate-400 mt-1 tabular-nums">
              band {result.expected_band_1cvrmse.lo.toLocaleString()} –{' '}
              {result.expected_band_1cvrmse.hi.toLocaleString()} kWh
            </div>
          )}
          <p className="text-[10px] leading-relaxed text-slate-500 mt-2">
            Band = ±1 validated CV(RMSE) ({result.band_basis.cv_rmse_pct}%), measured
            under <span className="text-slate-400">{result.band_basis.protocol}</span> —
            the error this model actually showed on cities it had never seen.
          </p>
          {selected && (
            <p className="text-[10px] text-slate-600 mt-1.5">
              {selected.site_id} · {selected.primaryspaceusage} ·{' '}
              {Math.round(selected.sqm).toLocaleString()} m²
              {selected.yearbuilt ? ` · built ${selected.yearbuilt}` : ''}
            </p>
          )}
        </div>
      )}

      {health && !health.model_loaded && (
        <p className="mt-3 text-[11px] text-amber-400">
          No model loaded — run <code>train_production</code>.
        </p>
      )}
    </div>
  );
}
