import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Activity, AlertTriangle } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';
import AlertCard from '../ui/AlertCard';

const AIInsightsPanel = () => {
  const aiInsights = useTwinStore(state => state.aiInsights);
  const presentationMode = useTwinStore(state => state.presentationMode);
  const togglePresentationMode = useTwinStore(state => state.togglePresentationMode);

  return (
    <div className="flex flex-col gap-3">
      
      {/* Presentation Toggle */}
      <button 
        onClick={togglePresentationMode}
        className={`w-full py-3 px-4 rounded-xl border flex items-center justify-center gap-2 font-bold tracking-widest text-sm transition-all shadow-lg ${
          presentationMode 
            ? 'bg-cyan-500/30 border-cyan-400 text-cyan-200 animate-pulse' 
            : 'glass-panel text-gray-300 hover:bg-white/10'
        }`}
      >
        <Eye size={18} />
        {presentationMode ? 'STOP PRESENTATION' : 'START PRESENTATION'}
      </button>

      {/* AI Insights */}
      <AnimatePresence>
        {aiInsights.map((insight, idx) => {
          // FIWARE ML AIInsight Entity
          if (insight.type === 'AIInsight') {
            const severity = insight.severity?.value || 'MEDIUM';
            const expected = insight.expectedValue?.value;
            const observed = insight.observedValue?.value;
            const cause = insight.possibleCause?.value;
            
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: 50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`p-4 rounded-xl border backdrop-blur-md shadow-lg ${
                  severity === 'CRITICAL' 
                    ? 'bg-red-500/10 border-red-500/50' 
                    : 'bg-orange-500/10 border-orange-500/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Activity className={severity === 'CRITICAL' ? 'text-red-400' : 'text-orange-400'} size={20} />
                  <h4 className={`font-bold text-sm tracking-wider ${severity === 'CRITICAL' ? 'text-red-300' : 'text-orange-300'}`}>
                    AI ML ANOMALY ({severity})
                  </h4>
                </div>
                
                <p className="text-gray-300 text-sm mb-3">
                  {insight.insightType?.value} detected in <span className="text-white font-mono">{insight.refRoom?.object}</span>
                </p>
                
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-black/30 p-2 rounded border border-white/5">
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Expected</div>
                    <div className="text-lg font-mono text-cyan-400">{expected ? expected.toFixed(1) : '--'} kW</div>
                  </div>
                  <div className="bg-black/30 p-2 rounded border border-white/5">
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Observed</div>
                    <div className="text-lg font-mono text-red-400">{observed ? observed.toFixed(1) : '--'} kW</div>
                  </div>
                </div>
                
                <div className="bg-black/40 p-3 rounded text-sm text-gray-300 flex items-start gap-2 border border-white/10">
                  <AlertTriangle className="text-yellow-400 shrink-0 mt-0.5" size={16} />
                  <p>{cause}</p>
                </div>
              </motion.div>
            );
          }

          // Simple Engine Insight
          return (
            <AlertCard 
              key={idx}
              title="SYSTEM INSIGHT"
              description={insight.text}
              type={insight.type === 'danger' ? 'danger' : insight.type === 'warning' ? 'warning' : 'info'}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default AIInsightsPanel;
