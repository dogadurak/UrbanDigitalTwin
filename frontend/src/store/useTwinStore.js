import { create } from 'zustand';

const useTwinStore = create((set, get) => ({
  building: null,
  selectedFloorId: null,
  viewMode: 'NORMAL', // 'NORMAL', 'ENERGY', 'HVAC', 'SECURITY', 'FIRE'
  activeScenario: null,
  aiInsights: [],
  whatIfResult: null,
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

      socket.on('telemetry', (buildingData) => {
        // Hydrate state from backend
        set({
          building: buildingData
        });
      });

      socket.on('what_if_result', (result) => {
        set({ whatIfResult: result });
      });

      socket.on('disconnect', () => {
        console.log('Disconnected from Backend');
      });
    });
  },

  triggerScenario: (scenario) => {
    const socket = get().socket;
    if (socket) {
      socket.emit('setScenario', scenario);
    }
    set({ activeScenario: scenario });
  },
  
  simulateWhatIf: (params) => {
    const socket = get().socket;
    if (socket) {
      socket.emit('simulate_what_if', params);
    }
  },
  
  // Keep empty just in case existing components call it during transition
  simulateIoTUpdate: () => {}
}));

export default useTwinStore;
