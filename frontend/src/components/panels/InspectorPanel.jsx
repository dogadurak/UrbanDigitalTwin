import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Thermometer, Wind, Droplets, Server, HeartPulse, ExternalLink } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';
import SensorCard from '../ui/SensorCard';
import TimeSeriesChart from '../ui/TimeSeriesChart';
import ProgressBar from '../ui/ProgressBar';

const InspectorPanel = ({ onOpenModal }) => {
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
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 100, opacity: 0 }}
          className="absolute top-72 right-6 w-[400px] pointer-events-auto flex flex-col gap-4 z-40"
        >
          <div className="bg-black/60 backdrop-blur-lg border border-cyan-400/50 rounded-xl p-6 shadow-[0_0_30px_rgba(0,255,255,0.15)] text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-cyan-500/20 blur-2xl rounded-full"></div>
            
            <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-4">
              <div>
                <h3 className="text-sm text-cyan-400 uppercase tracking-widest font-bold">Zone Analysis</h3>
                <h2 className="text-3xl font-light">{selectedFloorData.name}</h2>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="bg-cyan-500/20 text-cyan-300 px-2 py-1 rounded text-xs border border-cyan-500/30">
                  {building.status}
                </div>
                <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${(zoneData.healthScore || 100) < 80 ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-green-500/20 text-green-300 border-green-500/30'}`}>
                  <HeartPulse size={12} />
                  Health: {Math.round(zoneData.healthScore || 100)}%
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-6 mb-6">
              <SensorCard 
                icon={Thermometer} 
                label="Temperature" 
                value={zoneData.sensors.temperature.currentValue.toFixed(1)} 
                unit={zoneData.sensors.temperature.unit} 
              />
              <SensorCard 
                icon={Wind} 
                label="Air Quality" 
                value={Math.round(zoneData.sensors.airQuality.currentValue)} 
                unit={zoneData.sensors.airQuality.unit}
                valueColor="text-green-400"
              />
              <SensorCard 
                icon={Droplets} 
                label="Humidity" 
                value={Math.round(zoneData.sensors.humidity.currentValue)} 
                unit={zoneData.sensors.humidity.unit} 
              />
              <SensorCard 
                icon={Server} 
                label="IT Load" 
                value={Math.round(zoneData.sensors.itLoad.currentValue)} 
                unit={zoneData.sensors.itLoad.unit} 
              />
            </div>

            {/* Historical Data Chart */}
            <div className="mt-4 border-t border-white/10 pt-4">
              <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-2">Trend Analysis (Last 1h)</h3>
              <TimeSeriesChart 
                data={chartData}
                lines={[
                  { dataKey: "temperature", name: "Temp (°C)", color: "#00ffff" },
                  { dataKey: "itLoad", name: "IT Load (kW)", color: "#ffaa00" }
                ]}
              />
            </div>
            
            <div className="mt-4 pt-4 border-t border-white/10">
              <ProgressBar 
                label="Occupancy"
                currentValue={zoneData.sensors.occupancy.currentValue}
                maxValue={zoneData.sensors.occupancy.max}
              />
            </div>
            
            <button 
              onClick={onOpenModal}
              className="mt-4 w-full py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30 text-xs tracking-widest font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <ExternalLink size={14} /> VIEW ADVANCED TELEMETRY
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default InspectorPanel;
