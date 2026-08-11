import React, { useEffect } from 'react';
import Scene from './components/Scene';
import Dashboard from './components/Dashboard';
import useTwinStore from './store/useTwinStore';

function App() {
  const building = useTwinStore((state) => state.building);
  const initSocket = useTwinStore((state) => state.initSocket);

  // Connect to Backend WebSocket
  useEffect(() => {
    initSocket();
  }, [initSocket]);

  return (
    <div className="w-full h-screen overflow-hidden bg-black text-white relative font-sans">
      <Scene />
      
      {/* Title */}
      <div className="absolute top-6 left-6 z-10 pointer-events-none">
        <h1 className="text-3xl font-light text-white tracking-widest drop-shadow-[0_0_10px_rgba(0,255,255,0.5)]">
          {building.name.toUpperCase()} <span className="font-bold text-cyan-400">TWIN</span> <span className="text-sm text-gray-400 tracking-normal ml-2">SMART FACILITY</span>
        </h1>
      </div>

      {/* Dashboard UI */}
      <Dashboard />
    </div>
  );
}

export default App;
