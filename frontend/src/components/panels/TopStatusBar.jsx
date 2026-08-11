import React from 'react';
import { Activity, Zap, Wind, ShieldCheck } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

const TopStatusBar = () => {
  const building = useTwinStore(state => state.building);

  return (
    <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-auto flex gap-6 bg-black/50 backdrop-blur-md border border-cyan-500/30 rounded-full px-8 py-3 shadow-[0_0_20px_rgba(0,255,255,0.1)] text-white">
      <div className="flex items-center gap-2">
        <Activity className="text-cyan-400" size={18} />
        <span className="text-sm font-semibold tracking-wide">STATUS: {building.status}</span>
      </div>
      <div className="w-px h-6 bg-white/20"></div>
      <div className="flex items-center gap-2">
        <Zap className="text-yellow-400" size={18} />
        <span className="text-sm text-gray-300">Power: <span className="font-mono text-cyan-300">{(building.powerLoad || 0).toFixed(0)} kW</span></span>
      </div>
      <div className="w-px h-6 bg-white/20"></div>
      <div className="flex items-center gap-2">
        <Wind className="text-green-400" size={18} />
        <span className="text-sm text-gray-300">HVAC Eff: <span className="font-mono text-green-400">{(building.hvacEfficiency || 0).toFixed(1)}%</span></span>
      </div>
      <div className="w-px h-6 bg-white/20"></div>
      <div className="flex items-center gap-2">
        <ShieldCheck className="text-green-400" size={18} />
        <span className="text-sm text-gray-300">Alerts: <span className="font-mono text-yellow-400">{building.activeAlerts}</span></span>
      </div>
    </div>
  );
};

export default TopStatusBar;
