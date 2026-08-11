const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- DATA MODEL (Moved from Frontend assetHierarchy.js) ---
const generateBuildingModel = () => {
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
          alerts: [],
          history: []
        }
      ]
    });
  }

  return {
    id: "BLDG-001",
    name: "Alpha Tower",
    type: "BUILDING",
    status: "ONLINE",
    powerLoad: 425,
    hvacEfficiency: 92,
    activeAlerts: 0,
    elevators: [
      { id: 'E1', currentFloor: 0, targetFloor: 0, status: 'IDLE' },
      { id: 'E2', currentFloor: 5, targetFloor: 5, status: 'IDLE' },
      { id: 'E3', currentFloor: 14, targetFloor: 14, status: 'IDLE' }
    ],
    floors
  };
};

let buildingState = generateBuildingModel();
let activeScenario = null;
let aiInsights = [];

// --- SIMULATION ENGINE (Moved from Frontend useTwinStore.js) ---
const simulateTick = () => {
  const updatedFloors = buildingState.floors.map(floor => {
    const updatedZones = floor.zones.map(zone => {
      let newTemp = zone.sensors.temperature.value + (Math.random() - 0.5) * 0.2;
      let newHum = Math.max(30, Math.min(70, zone.sensors.humidity.value + (Math.random() - 0.5) * 2));
      let newAqi = Math.max(80, Math.min(120, zone.sensors.airQuality.value + (Math.random() - 0.5) * 3));
      let newIt = Math.max(10, Math.min(80, zone.sensors.itLoad.value + (Math.random() - 0.5) * 1));

      const now = new Date();
      const timeStr = `${now.getHours()}:${now.getMinutes()}:${String(now.getSeconds()).padStart(2, '0')}`;

      // Scenario logic
      let isFireActive = false;
      if (activeScenario === 'HVAC_FAILURE') {
        newTemp += (Math.random() * 0.5 + 0.5);
        newIt += (Math.random() * 1);
      } else if (activeScenario === 'FIRE_EMERGENCY') {
        newTemp += (Math.random() * 1.5);
        newAqi -= 10;
        isFireActive = true;
      }

      const newHistoryItem = {
        time: timeStr,
        temperature: Number(newTemp.toFixed(1)),
        humidity: Number(newHum.toFixed(0)),
        airQuality: Number(newAqi.toFixed(0)),
        itLoad: Number(newIt.toFixed(0))
      };

      const newHistory = [...(zone.history || []), newHistoryItem].slice(-20);

      let healthScore = 100;
      if (newTemp > 24) healthScore -= (newTemp - 24) * 10;
      if (newIt > 60) healthScore -= (newIt - 60) * 0.5;
      if (activeScenario === 'HVAC_FAILURE') healthScore -= 20;
      healthScore = Math.max(0, Math.min(100, healthScore));

      let activeAlerts = [...zone.alerts];
      if (activeScenario === 'HVAC_FAILURE' && newTemp > 26 && !activeAlerts.some(a => a.severity === 'CRITICAL')) {
         activeAlerts.push({
          id: `ALT-HVAC-${Date.now()}`,
          severity: 'CRITICAL',
          message: 'HVAC System Failure - Temp Rising Rapidly',
          timestamp: timeStr
        });
      } else if (Math.random() > 0.995 && activeAlerts.length === 0) {
        const type = Math.random() > 0.5 ? 'WARNING' : 'CRITICAL';
        activeAlerts.push({
          id: `ALT-${Date.now()}-${Math.floor(Math.random()*100)}`,
          severity: type,
          message: type === 'CRITICAL' ? 'High Temperature Detected' : 'HVAC Efficiency Drop',
          timestamp: timeStr
        });
      }
      
      if (healthScore > 85 && activeAlerts.length > 0 && Math.random() > 0.90) {
        activeAlerts.shift();
      }

      if (activeScenario === 'FIRE_EMERGENCY' && !activeAlerts.some(a => a.severity === 'CRITICAL' && a.id.includes('FIRE'))) {
        activeAlerts.push({
          id: `ALT-FIRE-${Date.now()}`,
          severity: 'CRITICAL',
          message: 'FIRE DETECTED - EVACUATION INITIATED',
          timestamp: timeStr
        });
      }

      return {
        ...zone,
        healthScore: healthScore,
        alerts: activeAlerts,
        sensors: {
          ...zone.sensors,
          temperature: { ...zone.sensors.temperature, value: newTemp },
          humidity: { ...zone.sensors.humidity, value: newHum },
          airQuality: { ...zone.sensors.airQuality, value: newAqi },
          itLoad: { ...zone.sensors.itLoad, value: newIt },
          fireSafety: { ...zone.sensors.fireSafety, isAlarmActive: isFireActive }
        },
        history: newHistory
      };
    });

    return { ...floor, zones: updatedZones };
  });

  const updatedElevators = buildingState.elevators.map(elv => {
    let current = elv.currentFloor;
    let target = elv.targetFloor;
    let status = 'IDLE';

    if (activeScenario === 'FIRE_EMERGENCY') {
      target = 0; 
    } else if (current === target) {
      if (Math.random() > 0.8) {
        target = Math.floor(Math.random() * 15);
      }
    }

    if (current < target) {
      current += Math.min(1.5, target - current);
      status = 'MOVING_UP';
    } else if (current > target) {
      current -= Math.min(1.5, current - target);
      status = 'MOVING_DOWN';
    }

    return { ...elv, currentFloor: current, targetFloor: target, status };
  });

  const totalPowerLoad = updatedFloors.reduce((acc, floor) => acc + floor.zones[0].sensors.itLoad.value, 0) + 150; 
  let totalAlertsCount = 0;
  
  const insights = [];
  if (activeScenario === 'HVAC_FAILURE') {
    insights.push({ type: 'danger', text: "CRITICAL: HVAC failure simulation active. Immediate cooling loss detected across all zones. [SIMULATED]" });
  } else if (activeScenario === 'FIRE_EMERGENCY') {
    insights.push({ type: 'danger', text: "EVACUATION: Fire protocol engaged. Elevators recalled to ground. Evacuation routes illuminated." });
  }
  
  let maxTemp = 0;
  let maxTempFloor = "";
  
  updatedFloors.forEach(f => {
    f.zones.forEach(z => { 
      totalAlertsCount += z.alerts.length;
      if (z.sensors.temperature.value > maxTemp) {
        maxTemp = z.sensors.temperature.value;
        maxTempFloor = f.name;
      }
    });
  });

  if (maxTemp > 25.5) {
    insights.push({ type: 'warning', text: `Temperature in ${maxTempFloor} has exceeded optimal levels (${maxTemp.toFixed(1)}°C). Suggest increasing localized HVAC airflow.` });
  } else if (maxTemp < 23 && !activeScenario) {
    insights.push({ type: 'success', text: `Building thermal profile is optimal. Potential for 5% HVAC energy savings by reducing fan speeds.` });
  }

  if (totalPowerLoad > 1000) {
    insights.push({ type: 'warning', text: `Total IT Load is unusually high (${totalPowerLoad.toFixed(0)} kW). Monitor UPS battery temperatures closely.` });
  }

  aiInsights = insights;
  buildingState = {
    ...buildingState,
    floors: updatedFloors,
    elevators: updatedElevators,
    powerLoad: totalPowerLoad,
    activeAlerts: totalAlertsCount,
    status: totalAlertsCount > 5 || activeScenario === 'FIRE_EMERGENCY' ? 'CRITICAL' : (totalAlertsCount > 0 ? 'WARNING' : 'NORMAL')
  };

  // Broadcast to all connected clients
  io.emit('building_update', { building: buildingState, aiInsights, activeScenario });
};

// Tick every 1 second (1000ms)
setInterval(simulateTick, 1000);

// --- WEBSOCKET HANDLERS ---
io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);
  
  // Send immediate state on connect
  socket.emit('building_update', { building: buildingState, aiInsights, activeScenario });

  // Listen for scenario triggers from Dashboard
  socket.on('trigger_scenario', (scenarioName) => {
    console.log(`[*] Scenario Triggered: ${scenarioName}`);
    activeScenario = scenarioName; // e.g., 'HVAC_FAILURE', 'FIRE_EMERGENCY', or null
  });

  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Urban Digital Twin Backend running on http://localhost:${PORT}`);
});
