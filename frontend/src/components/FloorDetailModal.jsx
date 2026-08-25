import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Activity, Server, Wind, Thermometer, Droplets, Zap } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';
import useTwinStore from '../store/useTwinStore';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

const FloorDetailModal = ({ isOpen, onClose }) => {
  const building = useTwinStore(state => state.building);
  const selectedFloorId = useTwinStore(state => state.selectedFloorId);
  
  if (!isOpen || !selectedFloorId) return null;
  
  const floorData = building.floors.find(f => f.id === selectedFloorId);
  const zone = floorData.rooms?.[0];
  
  // Mock data for detailed charts
  const powerDistribution = [
    { name: 'IT Servers', value: zone.sensors.itLoad.currentValue },
    { name: 'HVAC', value: zone.sensors.itLoad.currentValue * 0.4 },
    { name: 'Lighting', value: 15 },
    { name: 'Misc', value: 5 }
  ];

  let chartData = [];
  if (zone && zone.sensors.temperature.history1h) {
    const tempHist = zone.sensors.temperature.history1h;
    const humHist = zone.sensors.humidity.history1h;
    const itHist = zone.sensors.itLoad.history1h;
    const aqiHist = zone.sensors.airQuality.history1h;
    chartData = tempHist.map((tPoint, idx) => ({
      time: new Date(tPoint.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      temperature: tPoint.value,
      humidity: humHist[idx] ? humHist[idx].value : 0,
      itLoad: itHist[idx] ? itHist[idx].value : 0,
      airQuality: aqiHist[idx] ? aqiHist[idx].value : 0,
    }));
  }

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-auto p-8"
      >
        <motion.div 
          initial={{ y: 50, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.95 }}
          className="w-full max-w-6xl max-h-full bg-[#0a0a10] border border-cyan-500/30 rounded-2xl shadow-[0_0_50px_rgba(0,255,255,0.1)] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b border-white/10 bg-gradient-to-r from-cyan-900/30 to-transparent">
            <div>
              <h2 className="text-2xl font-light text-white flex items-center gap-3">
                <Activity className="text-cyan-400" />
                Advanced Telemetry: <span className="font-bold">{floorData.name}</span>
              </h2>
              <p className="text-sm text-gray-400 mt-1">Real-time Zone Analysis & Historical Trends</p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg transition-colors border border-transparent hover:border-red-500/30"
            >
              <X size={24} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar grid grid-cols-3 gap-6">
            
            {/* Column 1: Core Metrics & Power */}
            <div className="col-span-1 flex flex-col gap-6">
              <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-4 font-bold flex items-center gap-2">
                  <Zap size={14} className="text-yellow-400" /> Power Distribution
                </h3>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={powerDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {powerDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#111', borderColor: '#333', borderRadius: '8px' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Legend verticalAlign="bottom" height={36} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-5 flex-1">
                <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-4 font-bold flex items-center gap-2">
                  <Server size={14} className="text-cyan-400" /> Infrastructure Health
                </h3>
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="flex justify-between text-sm text-gray-300 mb-1">
                      <span>Network Throughput</span>
                      <span className="font-mono text-cyan-300">4.2 GB/s</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5"><div className="bg-cyan-400 h-1.5 rounded-full w-[70%]"></div></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm text-gray-300 mb-1">
                      <span>UPS Battery Charge</span>
                      <span className="font-mono text-green-400">98%</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5"><div className="bg-green-400 h-1.5 rounded-full w-[98%]"></div></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm text-gray-300 mb-1">
                      <span>Cooling Capacity Used</span>
                      <span className="font-mono text-yellow-400">82%</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5"><div className="bg-yellow-400 h-1.5 rounded-full w-[82%]"></div></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2 & 3: Charts */}
            <div className="col-span-2 flex flex-col gap-6">
              
              {/* Thermal Profile */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 h-64 flex flex-col">
                <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-2 font-bold flex items-center gap-2">
                  <Thermometer size={14} className="text-red-400" /> Thermal & Humidity Profile
                </h3>
                <div className="flex-1 w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ff4444" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#ff4444" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorHum" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00aaff" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#00aaff" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                      <XAxis dataKey="time" stroke="#ffffff50" fontSize={10} />
                      <YAxis yAxisId="left" stroke="#ff4444" fontSize={10} domain={['auto', 'auto']} />
                      <YAxis yAxisId="right" orientation="right" stroke="#00aaff" fontSize={10} domain={['auto', 'auto']} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                      />
                      <Area yAxisId="left" type="monotone" dataKey="temperature" name="Temp (°C)" stroke="#ff4444" fillOpacity={1} fill="url(#colorTemp)" isAnimationActive={false} />
                      <Area yAxisId="right" type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#00aaff" fillOpacity={1} fill="url(#colorHum)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* IT Load vs HVAC Efficiency */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 h-64 flex flex-col">
                <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-2 font-bold flex items-center gap-2">
                  <Wind size={14} className="text-cyan-400" /> System Load Correlation
                </h3>
                <div className="flex-1 w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                      <XAxis dataKey="time" stroke="#ffffff50" fontSize={10} />
                      <YAxis stroke="#ffffff50" fontSize={10} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: 'rgba(0,0,0,0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                      />
                      <Bar dataKey="itLoad" name="IT Load (kW)" fill="#ffaa00" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <Bar dataKey="airQuality" name="Air Qlty (AQI)" fill="#00ffcc" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default FloorDetailModal;
