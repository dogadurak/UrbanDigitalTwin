import React, { useState, useEffect, useRef } from 'react';
import Scene from './Scene';
import TopStatusBar from './panels/TopStatusBar';
import AIInsightsPanel from './panels/AIInsightsPanel';
import InspectorPanel from './panels/InspectorPanel';
import ControlPanel from './panels/ControlPanel';
import SimulationPanel from './panels/SimulationPanel';
import FloorDetailModal from './FloorDetailModal';
import CCTVModal from './panels/CCTVModal';
import MiniMap from './panels/MiniMap';
import TimelineControl from './ui/TimelineControl';
import ToastContainer, { showToast } from './ui/Toast';
import useTwinStore from '../store/useTwinStore';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeftClose, PanelRightClose, ChevronLeft, ChevronRight } from 'lucide-react';

const Dashboard = () => {
  const { building, selectedFloorId, setSelectedFloorId, initSocket, activeScenario, viewMode } = useTwinStore();
  const [isCctvOpen, setIsCctvOpen] = useState(false);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const prevScenarioRef = useRef(null);

  useEffect(() => {
    initSocket();
  }, [initSocket]);

  // Show toast on scenario change
  useEffect(() => {
    if (activeScenario && activeScenario !== prevScenarioRef.current) {
      const toastMap = {
        'FIRE_EMERGENCY': { type: 'danger', title: 'FIRE EMERGENCY', message: 'Fire detected — Evacuation protocol initiated on affected floors.' },
        'HVAC_FAILURE': { type: 'warning', title: 'HVAC FAILURE', message: 'HVAC unit offline on Floor 10. Temperature rising.' },
        'SECURITY_BREACH': { type: 'security', title: 'SECURITY BREACH', message: 'Unauthorized access detected on Floor 15. Drone dispatched.' },
      };
      const config = toastMap[activeScenario];
      if (config) showToast({ ...config, duration: 8000 });
    }
    prevScenarioRef.current = activeScenario;
  }, [activeScenario]);

  // Show toast on view mode change
  useEffect(() => {
    if (viewMode && viewMode !== 'NORMAL') {
      const modeNames = {
        'ENERGY': 'Energy Heatmap',
        'HVAC': 'HVAC X-Ray',
        'SECURITY': 'Security & CCTV',
        'FIRE': 'Fire & Evacuation',
      };
      showToast({
        type: 'info',
        title: 'View Mode',
        message: `Switched to ${modeNames[viewMode] || viewMode} visualization.`,
        duration: 3000,
      });
    }
  }, [viewMode]);

  if (!building) {
    return (
      <div className="h-screen w-screen bg-[#020206] flex flex-col items-center justify-center text-white font-mono gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-2 border-cyan-500/30 rounded-full animate-spin border-t-cyan-400" />
          <div className="w-10 h-10 border-2 border-cyan-500/20 rounded-full animate-spin absolute top-3 left-3 border-b-cyan-300" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
        </div>
        <div className="text-lg tracking-[0.3em] text-cyan-400/80">INITIALIZING DIGITAL TWIN</div>
        <div className="text-xs text-gray-600 tracking-widest">Connecting to simulation engine...</div>
      </div>
    );
  }

  const selectedFloor = selectedFloorId 
    ? building.floors.find(f => f.id === selectedFloorId)
    : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white font-sans selection:bg-purple-500/30">
      
      {/* Toast Notifications */}
      <ToastContainer />
      
      {/* Hidden trigger for CCTV */}
      <button id="cctv-trigger" className="hidden" onClick={() => setIsCctvOpen(true)}></button>

      {/* 3D Scene Background */}
      <div className="absolute inset-0 z-0">
        <Scene />
      </div>

      {/* UI Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col">
        
        {/* Top Status Bar */}
        <div className="p-4">
          <TopStatusBar />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex px-4 gap-4">
          
          {/* ═══ Left Panel: MiniMap + Asset Info ═══ */}
          <AnimatePresence>
            {leftPanelOpen && (
              <motion.div
                initial={{ x: -320, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -320, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="w-72 pointer-events-auto flex flex-col gap-3 overflow-y-auto custom-scrollbar pb-20"
              >
                <MiniMap />
                <InspectorPanel />
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* Left Toggle Button */}
          <button
            onClick={() => setLeftPanelOpen(!leftPanelOpen)}
            className="pointer-events-auto self-center p-1.5 bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white z-20"
          >
            {leftPanelOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          
          {/* Center spacer */}
          <div className="flex-1" />
          
          {/* Right Toggle Button */}
          <button
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className="pointer-events-auto self-center p-1.5 bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white z-20"
          >
            {rightPanelOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>

          {/* ═══ Right Panel: AI + Controls + Simulation ═══ */}
          <AnimatePresence>
            {rightPanelOpen && (
              <motion.div
                initial={{ x: 320, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 320, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="w-80 flex flex-col gap-3 pointer-events-auto overflow-y-auto custom-scrollbar pb-20"
              >
                <AIInsightsPanel />
                <ControlPanel />
                <SimulationPanel />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Modals */}
      <FloorDetailModal 
        isOpen={!!selectedFloorId}
        onClose={() => setSelectedFloorId(null)}
        floor={selectedFloor}
      />
      
      <CCTVModal 
        isOpen={isCctvOpen}
        onClose={() => setIsCctvOpen(false)}
      />
      
      <div className="pointer-events-auto">
        <TimelineControl />
      </div>

      {/* Keyboard shortcut hints */}
      <div className="absolute bottom-4 left-4 z-20 pointer-events-none">
        <div className="flex gap-2 text-[10px] text-gray-600 font-mono">
          <span className="bg-black/40 px-1.5 py-0.5 rounded border border-white/5">LMB: Rotate</span>
          <span className="bg-black/40 px-1.5 py-0.5 rounded border border-white/5">RMB: Pan</span>
          <span className="bg-black/40 px-1.5 py-0.5 rounded border border-white/5">Scroll: Zoom</span>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
