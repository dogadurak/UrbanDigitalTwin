import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Lock, Camera, AlertTriangle } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

const CCTVModal = ({ isOpen, onClose }) => {
  const activeScenario = useTwinStore(state => state.activeScenario);
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const cameras = [
    { id: 'CAM-01', location: 'Main Lobby (F1)', status: 'ONLINE' },
    { id: 'CAM-02', location: 'Elevator Shaft A', status: 'ONLINE' },
    { id: 'CAM-03', location: 'Server Room (F2)', status: 'ONLINE' },
    { id: 'CAM-04', location: 'Executive Office (F15)', status: activeScenario === 'SECURITY_BREACH' ? 'MOTION DETECTED' : 'ONLINE' },
  ];

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md pointer-events-auto p-8"
      >
        <motion.div 
          initial={{ y: 50, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 20, opacity: 0, scale: 0.95 }}
          className="w-full max-w-7xl max-h-full bg-[#050508] border border-purple-500/30 rounded-2xl shadow-[0_0_50px_rgba(168,85,247,0.15)] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b border-white/10 bg-gradient-to-r from-purple-900/30 to-transparent">
            <div className="flex items-center gap-3">
              <Lock className="text-purple-400" />
              <h2 className="text-xl font-light text-white tracking-widest uppercase">
                Central Security Feed
              </h2>
              <div className="ml-4 px-2 py-1 bg-red-500/20 text-red-400 text-xs font-mono rounded border border-red-500/30">
                REC •
              </div>
            </div>
            <div className="flex items-center gap-6">
              <span className="font-mono text-gray-400">{time}</span>
              <button 
                onClick={onClose}
                className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* CCTV Grid */}
          <div className="flex-1 p-4 grid grid-cols-2 gap-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjIiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMykiLz48L3N2Zz4=')]">
            {cameras.map((cam, i) => (
              <div key={cam.id} className={`relative rounded-xl overflow-hidden border ${cam.status === 'MOTION DETECTED' ? 'border-red-500 shadow-[0_0_30px_rgba(255,0,0,0.3)]' : 'border-white/10'} bg-black group aspect-video`}>
                
                {/* Simulated Camera Feed (Static noise + scanline overlay) */}
                <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] mix-blend-screen animate-pulse"></div>
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-500/5 to-transparent h-[200%] animate-[scan_4s_linear_infinite] pointer-events-none"></div>

                {cam.status === 'MOTION DETECTED' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
                    <motion.div 
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ repeat: Infinity, duration: 1, repeatType: 'reverse' }}
                      className="border-2 border-red-500 w-32 h-32 absolute top-1/3 left-1/3"
                    ></motion.div>
                    <div className="absolute top-1/3 left-1/3 mt-36 ml-4 bg-red-500 text-black text-xs font-bold px-2 py-1">UNAUTHORIZED ACCESS</div>
                  </div>
                )}

                <div className="absolute top-4 left-4 flex flex-col">
                  <span className="text-white font-mono text-sm tracking-wider drop-shadow-md">{cam.id}</span>
                  <span className="text-gray-300 font-mono text-xs drop-shadow-md">{cam.location}</span>
                </div>
                
                <div className="absolute top-4 right-4">
                  {cam.status === 'MOTION DETECTED' ? (
                    <span className="flex items-center gap-1 text-red-500 font-bold text-xs bg-black/60 px-2 py-1 rounded">
                      <AlertTriangle size={12} /> ALARM
                    </span>
                  ) : (
                    <span className="text-green-500 font-bold text-xs bg-black/60 px-2 py-1 rounded">
                      {cam.status}
                    </span>
                  )}
                </div>
                
                <div className="absolute bottom-4 left-4">
                  <Camera className="text-white/30" size={16} />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default CCTVModal;
