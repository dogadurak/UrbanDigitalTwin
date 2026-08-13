import React, { useEffect } from 'react';
import Dashboard from './components/Dashboard';
import useTwinStore from './store/useTwinStore';

function App() {
  const initSocket = useTwinStore((state) => state.initSocket);

  useEffect(() => {
    initSocket();
  }, [initSocket]);

  return (
    <div className="w-full h-screen overflow-hidden bg-black text-white relative font-sans">
      <Dashboard />
    </div>
  );
}

export default App;
