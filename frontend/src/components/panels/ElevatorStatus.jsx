import React from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

const ElevatorStatus = () => {
  const building = useTwinStore(state => state.building);

  return (
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
  );
};

export default ElevatorStatus;
