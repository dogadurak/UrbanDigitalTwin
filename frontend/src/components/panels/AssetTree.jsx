import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Building, ChevronRight } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

const AssetTree = () => {
  const building = useTwinStore(state => state.building);
  const selectedFloorId = useTwinStore(state => state.selectedFloorId);
  const setSelectedFloorId = useTwinStore(state => state.setSelectedFloorId);

  return (
    <motion.div 
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className="glass-panel shadow-[0_0_20px_rgba(0,0,0,0.5)] text-white overflow-hidden flex flex-col max-h-[50vh]"
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
              
              <AnimatePresence>
                {selectedFloorId === floor.id && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="ml-6 flex flex-col gap-1 mt-1 overflow-hidden"
                  >
                    {floor.rooms.map(zone => (
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
  );
};

export default AssetTree;
