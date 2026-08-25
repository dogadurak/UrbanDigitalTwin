import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Zap, Wind, Lock, Flame, Activity, Bomb } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

const ControlPanel = () => {
  const viewMode = useTwinStore(state => state.viewMode);
  const setViewMode = useTwinStore(state => state.setViewMode);
  const activeScenario = useTwinStore(state => state.activeScenario);
  const sabotageMode = useTwinStore(state => state.sabotageMode);
  const setSabotageMode = useTwinStore(state => state.setSabotageMode);
  const triggerScenario = useTwinStore(state => state.triggerScenario);

  return (
    <div className="flex flex-col gap-4">
      {/* View Modes */}
      <motion.div 
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="glass-panel p-4 text-white"
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
          
          <AnimatePresence>
            {viewMode === 'SECURITY' && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <button 
                  onClick={() => document.getElementById('cctv-trigger').click()}
                  className="w-full mt-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/50 p-2 rounded text-xs font-bold tracking-widest transition-colors flex items-center justify-center gap-2"
                >
                  <Eye size={14} /> LIVE CAMERA FEEDS
                </button>
              </motion.div>
            )}
          </AnimatePresence>
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
            onClick={() => triggerScenario(activeScenario === 'SECURITY_BREACH' ? null : 'SECURITY_BREACH')}
            className={`text-left text-xs p-2 rounded transition-colors border ${activeScenario === 'SECURITY_BREACH' ? 'bg-purple-500/30 text-purple-300 border-purple-500' : 'bg-purple-500/10 hover:bg-purple-500/20 text-gray-300 border-purple-500/30'}`}
          >
            {activeScenario === 'SECURITY_BREACH' ? '■ STOP INTRUDER ALARM' : '▶ SIMULATE INTRUDER'}
          </button>
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

      {/* Sabotage Mode */}
      <motion.div 
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="bg-black/60 backdrop-blur-md border border-red-500/20 rounded-xl p-4 text-white"
      >
        <h2 className="text-xs text-red-400 uppercase tracking-widest font-bold flex items-center gap-2 mb-3">
          <Bomb size={14} /> GAMIFICATION
        </h2>
        <button
          className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded text-sm font-bold transition-colors ${
            sabotageMode 
              ? 'bg-red-600 text-white shadow-[0_0_15px_rgba(220,38,38,0.6)]' 
              : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          }`}
          onClick={() => setSabotageMode(!sabotageMode)}
        >
          <Bomb size={18} />
          {sabotageMode ? 'SABOTAGE MODE ON' : 'ENABLE SABOTAGE'}
        </button>
      </motion.div>
    </div>
  );
};

export default ControlPanel;
