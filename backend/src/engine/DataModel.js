const crypto = require('crypto');

const generateHistory = (baseValue, variance, count) => {
  const history = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    // 1 point per minute for 1h (60 points)
    // 1 point per hour for 24h (24 points)
    // 1 point per day for 7d (7 points)
    // We will just generate generic arrays here.
    const time = new Date(now - (count - i) * 60000).toISOString();
    const val = baseValue + (Math.random() - 0.5) * variance;
    history.push({ time, value: Number(val.toFixed(2)) });
  }
  return history;
};

const createSensor = (type, name, unit, baseValue, variance) => {
  return {
    id: crypto.randomUUID(),
    type,
    name,
    unit,
    currentValue: baseValue,
    history1h: generateHistory(baseValue, variance, 60), // 1 point per min
    history24h: generateHistory(baseValue, variance * 2, 24), // 1 point per hour
    history7d: generateHistory(baseValue, variance * 3, 7) // 1 point per day
  };
};

const createAsset = (type, name, baseHealth) => {
  return {
    id: crypto.randomUUID(),
    type,
    name,
    status: 'ONLINE',
    health: baseHealth,
    wearAndTear: 0,
    targetTemperature: 22.0,
    powerDraw: 0,
    condition: baseHealth > 80 ? 'GOOD' : (baseHealth > 50 ? 'FAIR' : 'POOR'),
    maintenanceRisk: baseHealth > 80 ? 'LOW' : (baseHealth > 50 ? 'MEDIUM' : 'HIGH'),
    lastMaintenance: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
    nextMaintenance: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
  };
};

const createZone = (floorNum, zoneNum) => {
  return {
    id: crypto.randomUUID(),
    name: `Zone ${zoneNum}`,
    type: 'ZONE',
    sensors: {
      temperature: createSensor('TEMPERATURE', 'Zone Temp', '°C', 22.0, 1.5),
      humidity: createSensor('HUMIDITY', 'Zone Humidity', '%', 45, 10),
      co2: createSensor('CO2', 'CO2 Levels', 'ppm', 400, 50),
      airQuality: createSensor('AIR_QUALITY', 'Air Quality Index', 'AQI', 95, 15),
      itLoad: createSensor('IT_LOAD', 'IT Power Load', 'kW', 35, 10),
      occupancy: { id: crypto.randomUUID(), type: 'OCCUPANCY', currentValue: Math.floor(Math.random() * 50), max: 50 },
      security: { cameras: 4, activeBreaches: 0 },
      fireSafety: { smokeDetectors: 6, isAlarmActive: false }
    },
    assets: {
      hvac: createAsset('HVAC', `HVAC Unit ${floorNum}-${zoneNum}`, 85 + Math.random() * 15)
    },
    alerts: []
  };
};

const generateBuildingModel = () => {
  const floorCount = 15;
  const floors = [];

  for (let i = 1; i <= floorCount; i++) {
    floors.push({
      id: crypto.randomUUID(),
      name: `Floor ${i}`,
      level: i,
      type: "FLOOR",
      zones: [
        createZone(i, 1) // 1 main zone per floor for now
      ]
    });
  }

  return {
    id: crypto.randomUUID(),
    name: "Alpha Tower",
    type: "BUILDING",
    status: "NORMAL",
    healthScore: 95,
    activeAlerts: 0,
    elevators: [
      { id: 'E1', currentFloor: 0, targetFloor: 0, status: 'IDLE' },
      { id: 'E2', currentFloor: 5, targetFloor: 5, status: 'IDLE' },
      { id: 'E3', currentFloor: 14, targetFloor: 14, status: 'IDLE' }
    ],
    floors
  };
};

module.exports = {
  generateBuildingModel
};
