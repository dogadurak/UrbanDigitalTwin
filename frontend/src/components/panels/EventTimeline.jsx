import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

const EventTimeline = () => {
  const building = useTwinStore(state => state.building);

  // Gather all active alerts across the building
  const allAlerts = [];
  building.floors.forEach(f => {
    f.rooms.forEach(z => {
      z.alerts.forEach(a => {
        allAlerts.push({ ...a, location: `${f.name} - ${z.name}` });
      });
    });
  });

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[800px] pointer-events-auto z-40">
      <div className="glass-panel shadow-[0_0_20px_rgba(0,0,0,0.5)] text-white overflow-hidden">
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
  );
};

export default EventTimeline;
