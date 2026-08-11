import { create } from 'zustand';
import { generateBuildingModel } from '../models/assetHierarchy';

const useTwinStore = create((set, get) => ({
  building: generateBuildingModel(),
  selectedFloorId: null,
  viewMode: 'NORMAL', // 'NORMAL', 'ENERGY', 'HVAC', 'SECURITY', 'FIRE'
  activeScenario: null,
  aiInsights: [],
  presentationMode: false,

  setSelectedFloorId: (floorId) => set({ selectedFloorId: floorId }),
  setViewMode: (mode) => set({ viewMode: mode }),
  triggerScenario: (scenario) => set({ activeScenario: scenario }),
  togglePresentationMode: () => set(state => ({ presentationMode: !state.presentationMode })),

  socket: null,

  initSocket: () => {
    // Prevent multiple connections
    if (get().socket) return;

    import('socket.io-client').then(({ io }) => {
      const socket = io('http://localhost:3001');
      set({ socket });

      socket.on('connect', () => {
        console.log('Connected to Digital Twin Backend');
      });

      socket.on('building_update', (data) => {
        // Hydrate state from backend
        set({
          building: data.building,
          aiInsights: data.aiInsights,
          activeScenario: data.activeScenario
        });
      });

      socket.on('disconnect', () => {
        console.log('Disconnected from Backend');
      });
    });
  },

  triggerScenario: (scenario) => {
    const socket = get().socket;
    if (socket) {
      socket.emit('trigger_scenario', scenario);
    }
  },
  
  // Keep empty just in case existing components call it during transition
  simulateIoTUpdate: () => {}
}));

export default useTwinStore;
