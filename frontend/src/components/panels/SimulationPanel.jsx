import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings2, TrendingUp, TrendingDown } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

const SimulationPanel = () => {
  const [deltaTemp, setDeltaTemp] = useState(0);
  const [occMult, setOccMult] = useState(1.0);
  
  const simulateWhatIf = useTwinStore(state => state.simulateWhatIf);
  const whatIfResult = useTwinStore(state => state.whatIfResult);
  
  // Trigger simulation whenever parameters change
  useEffect(() => {
    simulateWhatIf({ outsideTempDelta: deltaTemp, occupancyMultiplier: occMult });
  }, [deltaTemp, occMult, simulateWhatIf]);

  return (
    <motion.div 
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="bg-black/60 backdrop-blur-md border border-indigo-500/20 rounded-xl p-4 text-white mt-4"
    >
      <h2 className="text-xs text-indigo-400 uppercase tracking-widest font-bold flex items-center gap-2 mb-4">
        <Settings2 size={14} /> WHAT-IF SIMULATION
      </h2>
      
      <div className="flex flex-col gap-4">
        {/* Sliders */}
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Outside Temp Delta</span>
            <span className="text-white font-mono">{deltaTemp > 0 ? '+' : ''}{deltaTemp}°C</span>
          </div>
          <input 
            type="range" 
            min="-10" max="10" step="1" 
            value={deltaTemp} 
            onChange={(e) => setDeltaTemp(parseFloat(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>
        
        <div>
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Occupancy Multiplier</span>
            <span className="text-white font-mono">{occMult.toFixed(1)}x</span>
          </div>
          <input 
            type="range" 
            min="0.1" max="2.0" step="0.1" 
            value={occMult} 
            onChange={(e) => setOccMult(parseFloat(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>

        {/* Results */}
        {whatIfResult && (
          <div className="mt-2 pt-3 border-t border-white/10">
            <div className="text-xs text-gray-400 mb-2">Projected Impact</div>
            
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm">Power Load</span>
              <span className="font-mono">{whatIfResult.projectedPower.toFixed(0)} kW</span>
            </div>
            
            <div className={`flex justify-end items-center gap-1 text-xs font-mono font-bold ${whatIfResult.delta > 0 ? 'text-red-400' : (whatIfResult.delta < 0 ? 'text-green-400' : 'text-gray-400')}`}>
              {whatIfResult.delta > 0 ? <TrendingUp size={12} /> : (whatIfResult.delta < 0 ? <TrendingDown size={12} /> : null)}
              {whatIfResult.delta > 0 ? '+' : ''}{whatIfResult.delta.toFixed(1)} kW delta
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default SimulationPanel;
