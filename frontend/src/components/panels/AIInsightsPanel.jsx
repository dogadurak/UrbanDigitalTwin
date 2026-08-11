import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye } from 'lucide-react';
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
            : 'bg-black/60 backdrop-blur-md border-white/20 text-gray-300 hover:bg-white/10'
        }`}
      >
        <Eye size={18} />
        {presentationMode ? 'STOP PRESENTATION' : 'START PRESENTATION'}
      </button>

      {/* AI Insights */}
      <AnimatePresence>
        {aiInsights.map((insight, idx) => (
          <AlertCard 
            key={idx}
            title="AI INSIGHT"
            description={insight.text}
            type={insight.type === 'danger' ? 'danger' : insight.type === 'warning' ? 'warning' : 'info'}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

export default AIInsightsPanel;
