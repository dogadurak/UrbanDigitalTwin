import React, { useState, useEffect } from 'react';
import Scene from './Scene';
import TopStatusBar from './panels/TopStatusBar';
import AIInsightsPanel from './panels/AIInsightsPanel';
import InspectorPanel from './panels/InspectorPanel';
import ControlPanel from './panels/ControlPanel';
import SimulationPanel from './panels/SimulationPanel';
import FloorDetailModal from './FloorDetailModal';
import CCTVModal from './panels/CCTVModal';
import TimelineControl from './ui/TimelineControl';
import useTwinStore from '../store/useTwinStore';

const Dashboard = () => {
  const { building, selectedFloorId, setSelectedFloorId, initSocket } = useTwinStore();
  const [isCctvOpen, setIsCctvOpen] = useState(false);

  useEffect(() => {
    initSocket();
  }, [initSocket]);

  if (!building) {
    return <div className="h-screen w-screen bg-black flex items-center justify-center text-white font-mono text-xl">INITIALIZING DIGITAL TWIN...</div>;
  }

  const selectedFloor = selectedFloorId 
    ? building.floors.find(f => f.id === selectedFloorId)
    : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white font-sans selection:bg-purple-500/30">
      
      {/* Hidden trigger for CCTV */}
      <button id="cctv-trigger" className="hidden" onClick={() => setIsCctvOpen(true)}></button>

      {/* 3D Scene Background */}
      <div className="absolute inset-0 z-0">
        <Scene />
      </div>

      {/* UI Overlay */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col p-6">
        
        {/* Top Status Bar */}
        <TopStatusBar />

        {/* Main Content Area */}
        <div className="flex-1 flex justify-between mt-6">
          
          {/* Left Column: Context Inspector */}
          <div className="w-80 pointer-events-auto flex flex-col gap-4">
            <InspectorPanel />
          </div>

          {/* Right Column: AI & Controls */}
          <div className="w-80 flex flex-col gap-4 pointer-events-auto">
            <AIInsightsPanel />
            <ControlPanel />
            <SimulationPanel />
          </div>
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

    </div>
  );
};

export default Dashboard;
