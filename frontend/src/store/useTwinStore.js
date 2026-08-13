import { create } from 'zustand';

const useTwinStore = create((set, get) => ({
  building: null,
  selectedFloorId: null,
  viewMode: 'NORMAL', // 'NORMAL', 'ENERGY', 'HVAC', 'SECURITY', 'FIRE'
  activeScenario: null,
  aiInsights: [],
  weather: null,
  whatIfResult: null,
  presentationMode: false,
  sabotageMode: false,
  
  historyBuffer: [],
  isHistoricalMode: false,
  historicalIndex: 0,

  setSelectedFloorId: (floorId) => set({ selectedFloorId: floorId }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setPresentationMode: (mode) => set({ presentationMode: mode }),
  setSabotageMode: (mode) => set({ sabotageMode: mode }),
  triggerScenario: (scenario) => set({ activeScenario: scenario }),
  togglePresentationMode: () => set(state => ({ presentationMode: !state.presentationMode })),
  
  setHistoricalState: (isHistorical, index) => set((state) => {
    if (!isHistorical || state.historyBuffer.length === 0) {
      return { 
        isHistoricalMode: false, 
        building: state.historyBuffer[state.historyBuffer.length - 1] || state.building 
      };
    }
    const idx = Math.min(Math.max(0, index), state.historyBuffer.length - 1);
    return {
      isHistoricalMode: true,
      historicalIndex: idx,
      building: state.historyBuffer[idx] || state.building
    };
  }),

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

      socket.on('telemetry', (payload) => {
        // The payload might be just the building (initial) or { building, aiInsights, activeScenario, weather } (from engine tick)
        const buildingData = payload.building || payload;

        // Hydrate state from backend and keep history
        set((state) => {
          const newHistory = [...state.historyBuffer, buildingData].slice(-300); // 5 minutes history
          
          if (state.isHistoricalMode) {
            return { 
              historyBuffer: newHistory,
              aiInsights: payload.aiInsights || state.aiInsights,
              activeScenario: payload.activeScenario !== undefined ? payload.activeScenario : state.activeScenario,
              weather: payload.weather !== undefined ? payload.weather : state.weather
            }; // Don't update current building state
          }
          
          return {
            building: buildingData,
            historyBuffer: newHistory,
            aiInsights: payload.aiInsights || state.aiInsights,
            activeScenario: payload.activeScenario !== undefined ? payload.activeScenario : state.activeScenario
          };
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

  triggerSabotageAction: (type, floorId) => {
    const socket = get().socket;
    if (socket) {
      socket.emit('sabotage', { type, floorId });
    }
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
