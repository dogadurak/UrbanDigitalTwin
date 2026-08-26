import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings2, TrendingUp, TrendingDown, Sun, TreePine, Building } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

const SimulationPanel = () => {
  const [targetTemp, setTargetTemp] = useState(25.0);
  const [targetNdvi, setTargetNdvi] = useState(0.4);
  const [targetGreenRatio, setTargetGreenRatio] = useState(0.3);
  
  const simulateWhatIf = useTwinStore(state => state.simulateWhatIf);
  const whatIfResult = useTwinStore(state => state.whatIfResult);
  
  useEffect(() => {
    simulateWhatIf({ 
      target_temperature: targetTemp, 
      target_ndvi: targetNdvi,
      target_building_density: 0.6,
      target_green_ratio: targetGreenRatio
    });
  }, [targetTemp, targetNdvi, targetGreenRatio, simulateWhatIf]);

  return (
    <motion.div 
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="bg-black/60 backdrop-blur-md border border-indigo-500/30 rounded-xl p-4 text-white mt-4 shadow-lg shadow-indigo-500/10"
    >
      <h2 className="text-xs text-indigo-400 uppercase tracking-widest font-bold flex items-center gap-2 mb-4">
        <Settings2 size={16} className="text-indigo-300" /> WHAT-IF SIMULATION (AI)
      </h2>
      
      <div className="flex flex-col gap-5">
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-2">
            <span className="flex items-center gap-1"><Sun size={12} className="text-yellow-500"/> Outdoor Temperature</span>
            <span className="text-white font-mono bg-black/40 px-2 py-0.5 rounded">{targetTemp}°C</span>
          </div>
          <input 
            type="range" 
            min="-10" max="45" step="1" 
            value={targetTemp} 
            onChange={(e) => setTargetTemp(parseFloat(e.target.value))}
            className="w-full accent-indigo-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-2">
            <span className="flex items-center gap-1"><TreePine size={12} className="text-emerald-500"/> Greenery Ratio</span>
            <span className="text-white font-mono bg-black/40 px-2 py-0.5 rounded">{(targetGreenRatio * 100).toFixed(0)}%</span>
          </div>
          <input 
            type="range" 
            min="0.0" max="1.0" step="0.05" 
            value={targetGreenRatio} 
            onChange={(e) => setTargetGreenRatio(parseFloat(e.target.value))}
            className="w-full accent-emerald-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-2">
            <span className="flex items-center gap-1"><TreePine size={12} className="text-green-400"/> NDVI (Vegetation Index)</span>
            <span className="text-white font-mono bg-black/40 px-2 py-0.5 rounded">{targetNdvi.toFixed(2)}</span>
          </div>
          <input 
            type="range" 
            min="-0.2" max="0.8" step="0.05" 
            value={targetNdvi} 
            onChange={(e) => setTargetNdvi(parseFloat(e.target.value))}
            className="w-full accent-green-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {whatIfResult && (
          <div className="mt-2 pt-4 border-t border-white/10 bg-indigo-950/20 -mx-4 -mb-4 p-4 rounded-b-xl">
            <div className="text-xs text-indigo-300 mb-3 font-semibold uppercase tracking-wider">AI Projected Impact (V3)</div>
            
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-300">Expected Power Load</span>
              <span className="font-mono text-lg font-bold text-white">{whatIfResult.projectedPower.toFixed(1)} kW</span>
            </div>
            
            <div className={`flex justify-end items-center gap-1 text-sm font-mono font-bold ${whatIfResult.delta > 0 ? 'text-red-400' : (whatIfResult.delta < 0 ? 'text-green-400' : 'text-gray-400')}`}>
              {whatIfResult.delta > 0 ? <TrendingUp size={16} /> : (whatIfResult.delta < 0 ? <TrendingDown size={16} /> : null)}
              {whatIfResult.delta > 0 ? '+' : ''}{whatIfResult.delta.toFixed(2)} kW vs Baseline
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default SimulationPanel;
