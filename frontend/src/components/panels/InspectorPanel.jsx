import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Thermometer, Wind, Droplets, Server, HeartPulse, ExternalLink, Users, ShieldCheck } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';
import GaugeChart from '../ui/GaugeChart';
import TimeSeriesChart from '../ui/TimeSeriesChart';
import ProgressBar from '../ui/ProgressBar';

const InspectorPanel = () => {
  const building = useTwinStore(state => state.building);
  const selectedFloorId = useTwinStore(state => state.selectedFloorId);

  const selectedFloorData = selectedFloorId ? building.floors.find(f => f.id === selectedFloorId) : null;
  const zoneData = selectedFloorData ? selectedFloorData.zones[0] : null;

  // Combine history for chart
  let chartData = [];
  if (zoneData && zoneData.sensors.temperature.history1h) {
    const tempHist = zoneData.sensors.temperature.history1h;
    const itHist = zoneData.sensors.itLoad.history1h;
    chartData = tempHist.map((tPoint, idx) => ({
      time: new Date(tPoint.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      temperature: tPoint.value,
      itLoad: itHist[idx] ? itHist[idx].value : 0
    }));
  }

  return (
    <AnimatePresence>
      {selectedFloorData && zoneData && (
        <motion.div 
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -50, opacity: 0 }}
          className="flex flex-col gap-3"
        >
          {/* Header Card */}
          <div className="bg-black/60 backdrop-blur-lg border border-cyan-400/30 rounded-xl p-4 shadow-[0_0_25px_rgba(0,255,255,0.1)] text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-20 h-20 bg-cyan-500/10 blur-3xl rounded-full" />
            
            <div className="flex justify-between items-start mb-4 border-b border-white/10 pb-3">
              <div>
                <h3 className="text-[10px] text-cyan-400 uppercase tracking-[0.2em] font-bold">Zone Inspector</h3>
                <h2 className="text-xl font-light mt-1">{selectedFloorData.name}</h2>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${
                  (zoneData.healthScore || 100) < 80 
                    ? 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' 
                    : 'bg-green-500/15 text-green-300 border-green-500/30'
                }`}>
                  <HeartPulse size={10} />
                  Health: {Math.round(zoneData.healthScore || 100)}%
                </div>
                <div className="text-[9px] text-gray-500 font-mono">{zoneData.id?.slice(0, 8)}</div>
              </div>
            </div>
            
            {/* Gauge Charts Row */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <GaugeChart 
                value={zoneData.sensors.temperature.currentValue}
                min={15} max={35}
                label="Temperature"
                unit="°C"
                size={100}
                thresholds={{ warning: 70, danger: 85 }}
                colorScheme="cyan"
              />
              <GaugeChart 
                value={zoneData.sensors.humidity.currentValue}
                min={20} max={80}
                label="Humidity"
                unit="%"
                size={100}
                thresholds={{ warning: 70, danger: 85 }}
                colorScheme="cyan"
              />
            </div>
            
            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              <QuickStat icon={Wind} label="AQI" value={Math.round(zoneData.sensors.airQuality.currentValue)} color="text-green-400" />
              <QuickStat icon={Server} label="IT Load" value={`${Math.round(zoneData.sensors.itLoad.currentValue)} kW`} color="text-yellow-400" />
              <QuickStat icon={Users} label="Occupants" value={`${zoneData.sensors.occupancy.currentValue}/${zoneData.sensors.occupancy.max}`} color="text-blue-400" />
            </div>

            {/* HVAC Status */}
            <div className={`flex items-center justify-between p-2 rounded-lg border text-xs ${
              zoneData.assets.hvac.status === 'ONLINE' 
                ? 'bg-green-500/10 border-green-500/20 text-green-300' 
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}>
              <div className="flex items-center gap-2">
                <ShieldCheck size={12} />
                <span>HVAC: {zoneData.assets.hvac.status}</span>
              </div>
              <span className="font-mono text-[10px]">
                Health: {Math.round(zoneData.assets.hvac.health)}%
              </span>
            </div>
          </div>

          {/* Trend Chart Card */}
          <div className="bg-black/60 backdrop-blur-lg border border-white/10 rounded-xl p-4 text-white">
            <h3 className="text-[10px] text-gray-400 uppercase tracking-[0.2em] mb-2 font-bold">Trend (1h)</h3>
            <TimeSeriesChart 
              data={chartData}
              lines={[
                { dataKey: "temperature", name: "Temp (°C)", color: "#00ffff" },
                { dataKey: "itLoad", name: "IT (kW)", color: "#ffaa00" }
              ]}
            />
          </div>
          
          {/* Occupancy Bar */}
          <div className="bg-black/60 backdrop-blur-lg border border-white/10 rounded-xl p-4 text-white">
            <ProgressBar 
              label="Floor Occupancy"
              currentValue={zoneData.sensors.occupancy.currentValue}
              maxValue={zoneData.sensors.occupancy.max}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const QuickStat = ({ icon: Icon, label, value, color = 'text-white' }) => (
  <div className="bg-white/5 rounded-lg p-2 text-center">
    <Icon size={12} className={`${color} mx-auto mb-1`} />
    <div className={`text-xs font-mono ${color}`}>{value}</div>
    <div className="text-[8px] text-gray-500 uppercase mt-0.5">{label}</div>
  </div>
);

export default InspectorPanel;
