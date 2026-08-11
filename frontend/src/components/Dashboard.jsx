import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Zap, Thermometer, Wind, ShieldCheck, Droplets, Server, ChevronRight, Building, Layers, Eye, AlertTriangle, HeartPulse, ExternalLink, Lock, Flame, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import useTwinStore from '../store/useTwinStore';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import FloorDetailModal from './FloorDetailModal';

const Dashboard = () => {
  const [showModal, setShowModal] = useState(false);
  const building = useTwinStore(state => state.building);
  const selectedFloorId = useTwinStore(state => state.selectedFloorId);
  const setSelectedFloorId = useTwinStore(state => state.setSelectedFloorId);
  const viewMode = useTwinStore(state => state.viewMode);
  const setViewMode = useTwinStore(state => state.setViewMode);
  const activeScenario = useTwinStore(state => state.activeScenario);
  const triggerScenario = useTwinStore(state => state.triggerScenario);
  const aiInsights = useTwinStore(state => state.aiInsights);
  const presentationMode = useTwinStore(state => state.presentationMode);
  const togglePresentationMode = useTwinStore(state => state.togglePresentationMode);

  const selectedFloorData = selectedFloorId ? building.floors.find(f => f.id === selectedFloorId) : null;
  const zoneData = selectedFloorData ? selectedFloorData.zones[0] : null;

  // Gather all active alerts across the building
  const allAlerts = [];
  building.floors.forEach(f => {
    f.zones.forEach(z => {
      z.alerts.forEach(a => {
        allAlerts.push({ ...a, location: `${f.name} - ${z.name}` });
      });
    });
  });

  return (
    <>
      {/* Top Bar: Overall Building Status */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-auto flex gap-6 bg-black/50 backdrop-blur-md border border-cyan-500/30 rounded-full px-8 py-3 shadow-[0_0_20px_rgba(0,255,255,0.1)] text-white">
        <div className="flex items-center gap-2">
          <Activity className="text-cyan-400" size={18} />
          <span className="text-sm font-semibold tracking-wide">STATUS: {building.status}</span>
        </div>
        <div className="w-px h-6 bg-white/20"></div>
        <div className="flex items-center gap-2">
          <Zap className="text-yellow-400" size={18} />
          <span className="text-sm text-gray-300">Power: <span className="font-mono text-cyan-300">{building.powerLoad.toFixed(0)} kW</span></span>
        </div>
        <div className="w-px h-6 bg-white/20"></div>
        <div className="flex items-center gap-2">
          <Wind className="text-green-400" size={18} />
          <span className="text-sm text-gray-300">HVAC Eff: <span className="font-mono text-green-400">{building.hvacEfficiency.toFixed(1)}%</span></span>
        </div>
        <div className="w-px h-6 bg-white/20"></div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-green-400" size={18} />
          <span className="text-sm text-gray-300">Alerts: <span className="font-mono text-yellow-400">{building.activeAlerts}</span></span>
        </div>
      </div>

      {/* Left Panel: Asset Tree Navigation & View Modes */}
      <div className="absolute top-24 left-6 w-72 pointer-events-auto flex flex-col gap-4">
        <motion.div 
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="bg-black/60 backdrop-blur-md border border-white/10 rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] text-white overflow-hidden flex flex-col max-h-[50vh]"
        >
          <div className="p-4 border-b border-white/10 bg-black/40">
            <h2 className="text-xs text-cyan-400 uppercase tracking-widest font-bold flex items-center gap-2">
              <Layers size={14} /> ASSET HIERARCHY
            </h2>
          </div>
          
          <div className="overflow-y-auto p-2 custom-scrollbar">
            <div className="flex items-center gap-2 p-2 hover:bg-white/5 rounded cursor-pointer text-sm">
              <Building size={16} className="text-cyan-400" />
              <span className="font-semibold tracking-wide">{building.name}</span>
            </div>
            
            <div className="ml-4 pl-2 border-l border-white/10 flex flex-col gap-1 mt-1">
              {building.floors.map(floor => (
                <div key={floor.id}>
                  <div 
                    onClick={() => setSelectedFloorId(floor.id === selectedFloorId ? null : floor.id)}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm transition-colors ${selectedFloorId === floor.id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'hover:bg-white/5 text-gray-400'}`}
                  >
                    <ChevronRight size={14} className={`transition-transform ${selectedFloorId === floor.id ? 'rotate-90 text-cyan-400' : ''}`} />
                    <span>{floor.name}</span>
                  </div>
                  
                  {/* Zones */}
                  <AnimatePresence>
                    {selectedFloorId === floor.id && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="ml-6 flex flex-col gap-1 mt-1 overflow-hidden"
                      >
                        {floor.zones.map(zone => (
                          <div key={zone.id} className="p-1.5 px-3 text-xs text-gray-400 hover:text-white hover:bg-white/10 rounded cursor-pointer flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
                            {zone.name}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* View Modes */}
        <motion.div 
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-4 text-white"
        >
          <h2 className="text-xs text-cyan-400 uppercase tracking-widest font-bold flex items-center gap-2 mb-3">
            <Eye size={14} /> VIEW MODES
          </h2>
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => setViewMode('NORMAL')}
              className={`text-left text-sm p-2 rounded transition-colors ${viewMode === 'NORMAL' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
            >
              Normal View
            </button>
            <button 
              onClick={() => setViewMode('ENERGY')}
              className={`text-left text-sm p-2 rounded transition-colors flex items-center gap-2 ${viewMode === 'ENERGY' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
            >
              <Zap size={14} className={viewMode === 'ENERGY' ? 'text-yellow-400' : ''} /> Energy Heatmap
            </button>
            <button 
              onClick={() => setViewMode('HVAC')}
              className={`text-left text-sm p-2 rounded transition-colors flex items-center gap-2 ${viewMode === 'HVAC' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
            >
              <Wind size={14} className={viewMode === 'HVAC' ? 'text-blue-400' : ''} /> HVAC Systems
            </button>
            <button 
              onClick={() => setViewMode('SECURITY')}
              className={`text-left text-sm p-2 rounded transition-colors flex items-center gap-2 ${viewMode === 'SECURITY' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
            >
              <Lock size={14} className={viewMode === 'SECURITY' ? 'text-purple-400' : ''} /> Security & CCTV
            </button>
            <button 
              onClick={() => setViewMode('FIRE')}
              className={`text-left text-sm p-2 rounded transition-colors flex items-center gap-2 ${viewMode === 'FIRE' ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-white/5 hover:bg-white/10 text-gray-300'}`}
            >
              <Flame size={14} className={viewMode === 'FIRE' ? 'text-red-400' : ''} /> Fire & Evacuation
            </button>
          </div>
        </motion.div>

        {/* Elevators */}
        <motion.div 
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-4 text-white"
        >
          <h2 className="text-xs text-cyan-400 uppercase tracking-widest font-bold flex items-center gap-2 mb-3">
            <ArrowUp size={14} /> ELEVATOR STATUS
          </h2>
          <div className="flex flex-col gap-2">
            {building.elevators.map(elv => (
              <div key={elv.id} className="flex items-center justify-between bg-white/5 p-2 rounded text-sm">
                <span className="font-bold text-gray-300">{elv.id}</span>
                <div className="flex items-center gap-2 text-cyan-400 font-mono">
                  {elv.status === 'MOVING_UP' && <ArrowUp size={14} />}
                  {elv.status === 'MOVING_DOWN' && <ArrowDown size={14} />}
                  {elv.status === 'IDLE' && <Minus size={14} />}
                  <span>FL: {Math.round(elv.currentFloor)}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Scenarios */}
        <motion.div 
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="bg-black/60 backdrop-blur-md border border-red-500/20 rounded-xl p-4 text-white"
        >
          <h2 className="text-xs text-red-400 uppercase tracking-widest font-bold flex items-center gap-2 mb-3">
            <Activity size={14} /> SCENARIO INJECTION
          </h2>
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => triggerScenario(activeScenario === 'HVAC_FAILURE' ? null : 'HVAC_FAILURE')}
              className={`text-left text-xs p-2 rounded transition-colors border ${activeScenario === 'HVAC_FAILURE' ? 'bg-orange-500/30 text-orange-300 border-orange-500' : 'bg-orange-500/10 hover:bg-orange-500/20 text-gray-300 border-orange-500/30'}`}
            >
              {activeScenario === 'HVAC_FAILURE' ? '■ STOP HVAC FAILURE' : '▶ SIMULATE HVAC FAILURE'}
            </button>
            <button 
              onClick={() => triggerScenario(activeScenario === 'FIRE_EMERGENCY' ? null : 'FIRE_EMERGENCY')}
              className={`text-left text-xs p-2 rounded transition-colors border ${activeScenario === 'FIRE_EMERGENCY' ? 'bg-red-500/30 text-red-300 border-red-500' : 'bg-red-500/10 hover:bg-red-500/20 text-gray-300 border-red-500/30'}`}
            >
              {activeScenario === 'FIRE_EMERGENCY' ? '■ STOP FIRE ALARM' : '▶ TRIGGER FIRE ALARM'}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Top Right: AI Insights and Presentation Button */}
      <div className="absolute top-6 right-6 w-80 pointer-events-auto flex flex-col gap-3 z-50">
        
        {/* Presentation Toggle */}
        <button 
          onClick={togglePresentationMode}
          className={`w-full py-3 px-4 rounded-xl border flex items-center justify-center gap-2 font-bold tracking-widest text-sm transition-all shadow-lg ${
            presentationMode 
              ? 'bg-cyan-500/30 border-cyan-400 text-cyan-200 animate-pulse' 
              : 'bg-black/60 backdrop-blur-md border-white/20 text-gray-300 hover:bg-white/10'
          }`}
        >
          <Eye size={18} />
          {presentationMode ? 'STOP PRESENTATION' : 'START PRESENTATION'}
        </button>

        {/* AI Insights */}
        <AnimatePresence>
          {aiInsights.map((insight, idx) => (
            <motion.div 
              key={idx}
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 100, opacity: 0 }}
              className={`p-3 rounded-xl border backdrop-blur-md shadow-lg text-sm ${
                insight.type === 'danger' ? 'bg-red-900/40 border-red-500/50 text-red-200' :
                insight.type === 'warning' ? 'bg-yellow-900/40 border-yellow-500/50 text-yellow-200' :
                'bg-green-900/40 border-green-500/50 text-green-200'
              }`}
            >
              <div className="flex gap-3 items-start">
                <div className="mt-0.5">
                  <Activity size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-bold uppercase opacity-70 mb-1">AI INSIGHT</h4>
                  <p>{insight.text}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Right Panel: Selected Floor Details */}
      <AnimatePresence>
        {selectedFloorData && zoneData && (
          <motion.div 
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 100, opacity: 0 }}
            className="absolute top-72 right-6 w-[400px] pointer-events-auto flex flex-col gap-4"
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
                  <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded border ${zoneData.healthScore < 80 ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-green-500/20 text-green-300 border-green-500/30'}`}>
                    <HeartPulse size={12} />
                    Health: {Math.round(zoneData.healthScore)}%
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <div className="flex items-center gap-2 text-gray-400 mb-1">
                    <Thermometer size={16} />
                    <span className="text-xs uppercase">Temperature</span>
                  </div>
                  <div className="text-2xl font-mono text-white">{zoneData.sensors.temperature.value.toFixed(1)}<span className="text-sm text-gray-500">{zoneData.sensors.temperature.unit}</span></div>
                </div>
                
                <div>
                  <div className="flex items-center gap-2 text-gray-400 mb-1">
                    <Wind size={16} />
                    <span className="text-xs uppercase">Air Quality</span>
                  </div>
                  <div className="text-2xl font-mono text-green-400">{Math.round(zoneData.sensors.airQuality.value)}<span className="text-sm text-gray-500">{zoneData.sensors.airQuality.unit}</span></div>
                </div>
                
                <div>
                  <div className="flex items-center gap-2 text-gray-400 mb-1">
                    <Droplets size={16} />
                    <span className="text-xs uppercase">Humidity</span>
                  </div>
                  <div className="text-2xl font-mono text-white">{Math.round(zoneData.sensors.humidity.value)}<span className="text-sm text-gray-500">{zoneData.sensors.humidity.unit}</span></div>
                </div>
                
                <div>
                  <div className="flex items-center gap-2 text-gray-400 mb-1">
                    <Server size={16} />
                    <span className="text-xs uppercase">IT Load</span>
                  </div>
                  <div className="text-2xl font-mono text-white">{Math.round(zoneData.sensors.itLoad.value)}<span className="text-sm text-gray-500">{zoneData.sensors.itLoad.unit}</span></div>
                </div>
              </div>

              {/* Historical Data Chart */}
              <div className="h-40 w-full mt-4 border-t border-white/10 pt-4">
                <h3 className="text-xs text-gray-400 uppercase tracking-widest mb-2">Trend Analysis</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={zoneData.history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                    <XAxis dataKey="time" stroke="#ffffff50" fontSize={10} tickMargin={5} />
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
                  <span className="text-cyan-300">{zoneData.sensors.occupancy.value} / {zoneData.sensors.occupancy.max}</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1">
                  <div className="bg-cyan-400 h-1 rounded-full" style={{ width: `${(zoneData.sensors.occupancy.value / zoneData.sensors.occupancy.max) * 100}%` }}></div>
                </div>
              </div>
              
              <button 
                onClick={() => setShowModal(true)}
                className="mt-4 w-full py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 rounded border border-cyan-500/30 text-xs tracking-widest font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <ExternalLink size={14} /> VIEW ADVANCED TELEMETRY
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Bottom Panel: Alerts / Logs */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[800px] pointer-events-auto">
        <div className="bg-black/60 backdrop-blur-md border border-white/10 rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] text-white overflow-hidden">
          <div className="p-3 border-b border-white/10 bg-black/40 flex items-center justify-between">
            <h2 className="text-xs text-yellow-400 uppercase tracking-widest font-bold flex items-center gap-2">
              <AlertTriangle size={14} /> ACTIVE SYSTEM ALERTS ({allAlerts.length})
            </h2>
          </div>
          <div className="p-2 max-h-32 overflow-y-auto custom-scrollbar flex flex-col gap-1">
            <AnimatePresence>
              {allAlerts.length === 0 ? (
                <div className="text-gray-500 text-sm p-2 text-center">No active alerts. System is operating normally.</div>
              ) : (
                allAlerts.map(alert => (
                  <motion.div 
                    key={alert.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className={`flex items-center justify-between p-2 rounded text-sm ${alert.severity === 'CRITICAL' ? 'bg-red-500/20 border border-red-500/30 text-red-300' : 'bg-yellow-500/20 border border-yellow-500/30 text-yellow-300'}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs opacity-70">{alert.timestamp}</span>
                      <span className="font-bold">{alert.location}</span>
                      <span>{alert.message}</span>
                    </div>
                    <div className="px-2 py-0.5 rounded bg-black/30 text-xs">{alert.id}</div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      
      <FloorDetailModal isOpen={showModal} onClose={() => setShowModal(false)} />
    </>
  );
};

export default Dashboard;
