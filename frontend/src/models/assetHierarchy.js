// Represents the structural hierarchy for the Digital Twin

export const generateBuildingModel = () => {
  const floorCount = 15;
  const floors = [];

  for (let i = 1; i <= floorCount; i++) {
    const floorId = `FLR-${String(i).padStart(2, '0')}`;
    floors.push({
      id: floorId,
      name: `Floor ${i}`,
      level: i,
      type: "FLOOR",
      zones: [
        {
          id: `ZONE-${String(i).padStart(2, '0')}01`,
          name: "Main Area",
          type: "ZONE",
          sensors: {
            temperature: { id: `SEN-TEMP-${String(i).padStart(2, '0')}01`, value: 22.0 + Math.random() * 2, unit: "°C" },
            humidity: { id: `SEN-HUM-${String(i).padStart(2, '0')}01`, value: 40 + Math.floor(Math.random() * 15), unit: "%" },
            airQuality: { id: `SEN-AQI-${String(i).padStart(2, '0')}01`, value: 90 + Math.floor(Math.random() * 20), unit: "AQI" },
            itLoad: { id: `SEN-IT-${String(i).padStart(2, '0')}01`, value: 30 + Math.floor(Math.random() * 20), unit: "kW" },
            occupancy: { id: `SEN-OCC-${String(i).padStart(2, '0')}01`, value: Math.floor(Math.random() * 50), max: 50 },
            security: { cameras: 4, activeBreaches: 0 },
            fireSafety: { smokeDetectors: 6, isAlarmActive: false }
          },
          assets: {
            hvac: { id: `HVAC-${String(i).padStart(2, '0')}01`, efficiency: 85 + Math.floor(Math.random() * 15), status: "NORMAL" }
          },
          alerts: [], // E.g., { id: 'ALT-1', severity: 'WARNING', message: 'Temp high' }
          history: [] // For time-series charts
        }
      ]
    });
  }

  return {
    id: "BLDG-001",
    name: "Alpha Tower",
    type: "BUILDING",
    status: "ONLINE",
    powerLoad: 425, // kW total
    hvacEfficiency: 92, // %
    activeAlerts: 0,
    elevators: [
      { id: 'E1', currentFloor: 0, targetFloor: 0, status: 'IDLE' },
      { id: 'E2', currentFloor: 5, targetFloor: 5, status: 'IDLE' },
      { id: 'E3', currentFloor: 14, targetFloor: 14, status: 'IDLE' }
    ],
    floors
  };
};
