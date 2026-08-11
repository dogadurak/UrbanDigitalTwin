import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Thermometer, Wind, Droplets, Server, HeartPulse, ExternalLink } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

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
              <div>
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                  <Thermometer size={16} />
                  <span className="text-xs uppercase">Temperature</span>
                </div>
                <div className="text-2xl font-mono text-white">{zoneData.sensors.temperature.currentValue.toFixed(1)}<span className="text-sm text-gray-500">{zoneData.sensors.temperature.unit}</span></div>
              </div>
              
              <div>
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                  <Wind size={16} />
                  <span className="text-xs uppercase">Air Quality</span>
                </div>
                <div className="text-2xl font-mono text-green-400">{Math.round(zoneData.sensors.airQuality.currentValue)}<span className="text-sm text-gray-500">{zoneData.sensors.airQuality.unit}</span></div>
              </div>
              
              <div>
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                  <Droplets size={16} />
                  <span className="text-xs uppercase">Humidity</span>
                </div>
                <div className="text-2xl font-mono text-white">{Math.round(zoneData.sensors.humidity.currentValue)}<span className="text-sm text-gray-500">{zoneData.sensors.humidity.unit}</span></div>
              </div>
              
              <div>
                <div className="flex items-center gap-2 text-gray-400 mb-1">
                  <Server size={16} />
                  <span className="text-xs uppercase">IT Load</span>
                </div>
                <div className="text-2xl font-mono text-white">{Math.round(zoneData.sensors.itLoad.currentValue)}<span className="text-sm text-gray-500">{zoneData.sensors.itLoad.unit}</span></div>
              </div>
            </div>

            {/* Historical Data Chart */}
            <div className="h-40 w-full mt-4 border-t border-white/10 pt-4">
              <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-2">Trend Analysis (Last 1h)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="time" stroke="#ffffff50" fontSize={10} tickMargin={5} minTickGap={20} />
                  <YAxis yAxisId="left" stroke="#ffffff50" fontSize={10} width={30} domain={['dataMin - 5', 'dataMax + 5']} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: 'rgba(0,255,255,0.3)', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff', fontSize: '12px' }}
                    labelStyle={{ color: '#00ffff', fontSize: '12px' }}
                  />
                  <Line yAxisId="left" type="monotone" dataKey="temperature" name="Temp (°C)" stroke="#00ffff" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line yAxisId="left" type="monotone" dataKey="itLoad" name="IT Load (kW)" stroke="#ffaa00" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                <span>Occupancy</span>
                <span className="text-cyan-300">{zoneData.sensors.occupancy.currentValue} / {zoneData.sensors.occupancy.max}</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-1">
                <div className="bg-cyan-400 h-1 rounded-full" style={{ width: `${(zoneData.sensors.occupancy.currentValue / zoneData.sensors.occupancy.max) * 100}%` }}></div>
              </div>
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
