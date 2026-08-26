import { create } from 'zustand';

const useTwinStore = create((set, get) => ({
  building: null,
  selectedFloorId: null,
  viewLevel: 'MACRO', // 'MACRO' | 'MICRO'
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
  setViewLevel: (level) => set({ viewLevel: level }),
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

      socket.on('fiware_alert', (payload) => {
        console.log("FIWARE ALERT RECEIVED", payload);
        // We can show a toast or update state here.
        // For now, if we receive a context update, we could log it or trigger a micro-update
        // that alters the UI.
      });

      socket.on('ai_insight_alert', (payload) => {
        console.warn("AI INSIGHT ALERT:", payload);
        set((state) => ({
          aiInsights: [...state.aiInsights, payload.insight],
          latestAlert: payload
        }));
        
        // Auto-clear alert after 5 seconds
        setTimeout(() => {
          set({ latestAlert: null });
        }, 5000);
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
  
  simulateWhatIf: async (params) => {
    const state = get();
    const building = state.building;
    if (!building) return;
    
    // params expected: target_temperature, target_ndvi, target_building_density, target_green_ratio
    const requestBody = {
      building_id: building.id.replace("urn:ngsi-ld:Building:", ""),
      target_temperature: params.target_temperature !== undefined ? params.target_temperature : 20.0,
      target_ndvi: params.target_ndvi !== undefined ? params.target_ndvi : 0.3,
      target_building_density: params.target_building_density !== undefined ? params.target_building_density : 0.5,
      target_green_ratio: params.target_green_ratio !== undefined ? params.target_green_ratio : 0.2
    };

    try {
      const response = await fetch("http://localhost:8000/api/simulate-what-if", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const data = await response.json();
      if (data.simulated_energy !== undefined) {
        set({ whatIfResult: { projectedPower: data.simulated_energy, delta: data.simulated_energy - (building.energy?.value || 0) } });
      }
    } catch (err) {
      console.error("Failed to simulate what if", err);
    }
  },
  
  // Keep empty just in case existing components call it during transition
  simulateIoTUpdate: () => {}
}));

export default useTwinStore;
