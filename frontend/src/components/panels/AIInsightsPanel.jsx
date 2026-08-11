import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Eye } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

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
  );
};

export default AIInsightsPanel;
