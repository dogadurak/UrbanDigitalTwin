const { generateBuildingModel } = require('./DataModel');
const crypto = require('crypto');

class SimulationEngine {
  constructor() {
    this.building = null;
    this.activeScenario = null;
    this.tickRateMs = 1000; // 1 Hz
    this.timeMultipliers = {
      realtime: 1, // 1 real second = 1 sim second
      fast: 60,    // 1 real second = 1 sim minute
    };
    this.currentMultiplier = 'realtime';
    this.aiInsights = [];
    this.timeOfDay = 12.0; // Start at 12:00 PM
    
    // Weather State
    this.weather = {
      temperature: 22.0,
      humidity: 45.0,
      isRaining: false,
      windSpeed: 10,
      condition: 'CLEAR'
    };
    this.lastWeatherFetch = 0;
  }

  async start(broadcastCallback) {
    const bimRepo = require('../repositories/bimRepository');
    try {
      this.building = await bimRepo.getBuildingHierarchy('urn:ngsi-ld:Building:Izmir-1');
      console.log("[SIMULATION] BIM Hierarchy loaded.");
    } catch (e) {
      console.error("[SIMULATION] Failed to load BIM Hierarchy:", e.message);
      // Fallback
      this.building = generateBuildingModel();
    }
    
    this.fetchWeather();
    
    this.interval = setInterval(() => {
      this.tick();
      if (broadcastCallback) {
        broadcastCallback({
          building: this.building,
          aiInsights: this.aiInsights,
          activeScenario: this.activeScenario,
          weather: this.weather
        });
      }
    }, this.tickRateMs);
  }

  async fetchWeather() {
    try {
      const weatherRepo = require('../repositories/weatherRepository');
      const fiwareGateway = require('../gateways/fiwareGateway');
      
      const dbWeather = await weatherRepo.getLatestWeather();
      if (!dbWeather) return;

      this.weather.temperature = dbWeather.temperature;
      this.weather.humidity = dbWeather.humidity;
      this.weather.windSpeed = dbWeather.wind_speed;
      this.weather.isRaining = dbWeather.precipitation > 0;
      this.weather.condition = this.weather.isRaining ? 'RAIN' : 'CLEAR';
      
      console.log(`[WEATHER] Updated from DB: ${this.weather.temperature}°C, Rain: ${this.weather.isRaining}`);
      this.lastWeatherFetch = Date.now();

      // Push to FIWARE Orion-LD context broker
      await fiwareGateway.updateWeatherContext(dbWeather);
    } catch (e) {
      console.error("[WEATHER] Failed to fetch weather from DB or update FIWARE:", e.message);
    }
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  setScenario(scenario) {
    this.activeScenario = scenario;
    console.log(`[SIMULATION] Scenario set to: ${scenario || 'NORMAL'}`);
    
    // Clear existing alerts if returning to normal
    if (!scenario) {
      this.building.status = 'NORMAL';
      this.building.floors.forEach(f => {
        f.zones.forEach(z => {
          z.alerts = [];
          z.sensors.fireSafety.isAlarmActive = false;
        });
      });
      this.building.activeAlerts = 0;
    }

    if (scenario === 'FIRE_EMERGENCY') {
      this.building.status = 'EMERGENCY';
      // Trigger fire in floor 5
      const f5 = this.building.floors.find(f => f.level === 5);
      if (f5) {
        const zone = f5.zones[0];
        zone.sensors.fireSafety.isAlarmActive = true;
        zone.sensors.temperature.currentValue = 85.0; // Fire Temp!
        zone.alerts.push({
          id: crypto.randomUUID(),
          severity: 'CRITICAL',
          timestamp: new Date().toLocaleTimeString(),
          message: 'FIRE DETECTED - EVACUATION REQUIRED'
        });
      }
      this.building.activeAlerts = this.calculateTotalAlerts();
    }

      if (scenario === 'HVAC_FAILURE') {
        this.building.status = 'WARNING';
        // Trigger HVAC failure in floor 10
        const f10 = this.building.floors.find(f => f.level === 10);
        if (f10) {
          const zone = f10.zones[0];
          zone.assets.hvac.status = 'OFFLINE';
          zone.assets.hvac.health = 20;
          zone.alerts.push({
            id: crypto.randomUUID(),
            severity: 'WARNING',
            timestamp: new Date().toLocaleTimeString(),
            message: 'HVAC UNIT OFFLINE - MAINTENANCE DISPATCHED'
          });
        }
        this.building.activeAlerts = this.calculateTotalAlerts();
      }

      if (scenario === 'SECURITY_BREACH') {
      this.building.status = 'EMERGENCY';
      const f15 = this.building.floors.find(f => f.level === 15);
      if (f15) {
        const zone = f15.zones[0];
        zone.alerts.push({
          id: crypto.randomUUID(),
          severity: 'CRITICAL',
          timestamp: new Date().toLocaleTimeString(),
          message: 'UNAUTHORIZED ACCESS - F15 EXECUTIVE OFFICE'
        });
      }
      this.building.activeAlerts = this.calculateTotalAlerts();
    }
  }

  triggerSabotage(type, floorId) {
    const floor = this.building.floors.find(f => f.id === floorId);
    if (!floor) return;
    const zone = floor.zones[0];
    
    this.building.status = 'EMERGENCY';
    
    if (type === 'FIRE') {
      zone.sensors.fireSafety.isAlarmActive = true;
      zone.sensors.temperature.currentValue = 90.0;
      zone.alerts.push({
        id: crypto.randomUUID(),
        severity: 'CRITICAL',
        timestamp: new Date().toLocaleTimeString(),
        message: 'SABOTAGE DETECTED: FIRE INSTIGATED MANUALLY!'
      });
    } else if (type === 'HVAC_LEAK') {
      zone.assets.hvac.status = 'OFFLINE';
      zone.assets.hvac.health = 0;
      zone.alerts.push({
        id: crypto.randomUUID(),
        severity: 'WARNING',
        timestamp: new Date().toLocaleTimeString(),
        message: 'SABOTAGE DETECTED: HVAC PIPES RUPTURED!'
      });
    } else if (type === 'WINDOW_BREAK') {
      zone.sensors.temperature.currentValue = this.weather.temperature;
      zone.alerts.push({
        id: crypto.randomUUID(),
        severity: 'WARNING',
        timestamp: new Date().toLocaleTimeString(),
        message: 'SABOTAGE DETECTED: STRUCTURAL COMPROMISE (WINDOW BROKEN)'
      });
    }
    
    this.building.activeAlerts = this.calculateTotalAlerts();
    this.aiInsights.push({ type: 'danger', text: `SABOTAGE RECORDED ON ${floor.name}` });
  }

  calculateTotalAlerts() {
    let count = 0;
    this.building.floors.forEach(f => {
      f.zones.forEach(z => {
        count += z.alerts.length;
      });
    });
    return count;
  }

  tick() {
    // 1. Time progression
    const timeDeltaHours = (this.tickRateMs / 3600000) * this.timeMultipliers[this.currentMultiplier];
    this.timeOfDay += timeDeltaHours;
    if (this.timeOfDay >= 24) this.timeOfDay = 0;
    this.building.timeOfDay = this.timeOfDay;

    // Fetch weather every 15 minutes real-time
    if (Date.now() - this.lastWeatherFetch > 15 * 60 * 1000) {
      this.fetchWeather();
    }

    this.tickElevators();
    this.tickSensors();
    this.tickCalculatedMetrics();
  }

  tickElevators() {
    if (this.building.status === 'EMERGENCY') {
      this.building.elevators.forEach(elv => {
        elv.targetFloor = 0;
        if (elv.currentFloor > 0) {
          elv.status = 'MOVING_DOWN';
          elv.currentFloor = Math.max(0, elv.currentFloor - 0.5);
        } else {
          elv.currentFloor = 0;
          elv.status = 'LOCKED';
        }
      });
      return;
    }

    this.building.elevators.forEach(elv => {
      if (elv.status === 'LOCKED') elv.status = 'IDLE';

      // Very simple elevator logic
      if (elv.status === 'IDLE' && Math.random() > 0.95) {
        elv.targetFloor = Math.floor(Math.random() * 15);
      }

      if (elv.currentFloor < elv.targetFloor) {
        elv.status = 'MOVING_UP';
        elv.currentFloor += 0.5;
        if (elv.currentFloor >= elv.targetFloor) {
          elv.currentFloor = elv.targetFloor;
          elv.status = 'IDLE';
        }
      } else if (elv.currentFloor > elv.targetFloor) {
        elv.status = 'MOVING_DOWN';
        elv.currentFloor -= 0.5;
        if (elv.currentFloor <= elv.targetFloor) {
          elv.currentFloor = elv.targetFloor;
          elv.status = 'IDLE';
        }
      } else {
        elv.status = 'IDLE';
      }
    });
  }

  tickSensors() {
    const isWorkingHours = this.timeOfDay >= 8 && this.timeOfDay <= 18;
    const baseOccupancy = isWorkingHours ? (Math.sin(((this.timeOfDay - 8) / 10) * Math.PI) * 45) : 0;

    // First pass: Calculate occupancy and heat generation
    this.building.floors.forEach((f, index) => {
      if (!f.rooms) return;
      f.rooms.forEach(room => {
        // Find environment sensor
        const envSensor = room.devices?.find(d => d.device_type === 'ENVIRONMENTAL_SENSOR');
        if (!envSensor) return;
        
        let currentTemp = envSensor.lastReading?.temperature ? parseFloat(envSensor.lastReading.temperature) : this.weather.temperature;
        // Occupancy calculation
        let occ = baseOccupancy + (Math.random() - 0.5) * 5;
        if (this.building.status === 'EMERGENCY' || occ < 0) occ = 0;
        
        let itLoad = f.level_name === 'First Floor' ? 150 : 20;
        itLoad += (occ * 0.5);

        // Heat generation
        const humanHeat = occ * 0.05; // kW
        const itHeat = itLoad * 0.02; // kW
        let heatGenerated = humanHeat + itHeat;

        // Sabotage overrides
        if (this.activeScenario === 'FIRE_EMERGENCY' && f.level_name === 'First Floor') {
          heatGenerated += 50.0;
        }

        // Store calculated heat on room temporarily
        room.heatGenerated = heatGenerated;
      });
    });

    // Second pass: Heat Transfer & HVAC (Thermodynamics & PID)
    this.building.floors.forEach((f, index) => {
      if (!f.rooms) return;
      f.rooms.forEach(room => {
        const envSensor = room.devices?.find(d => d.device_type === 'ENVIRONMENTAL_SENSOR');
        if (!envSensor) return;
        
        let currentTemp = envSensor.lastReading?.temperature ? parseFloat(envSensor.lastReading.temperature) : this.weather.temperature;

        const hvacStatus = 'ONLINE'; // We assume online for now
        
        // 1. Natural Heat Transfer (Weather)
        const outsideTemp = this.weather.temperature;
        const weatherLeak = 0.05; // Insulation factor
        let tempDelta = (outsideTemp - currentTemp) * weatherLeak;

        // 2. Solar Gain (Sun effect)
        const solarGain = (this.timeOfDay > 9 && this.timeOfDay < 16 && !this.weather.isRaining) ? 0.3 : 0;
        tempDelta += solarGain;

        // 3. Internal Heat Generation
        tempDelta += room.heatGenerated * 0.1;

        // 4. Heat Transfer from below floor (Heat rises)
        if (index > 0) {
          const belowFloor = this.building.floors[index - 1];
          if (belowFloor.rooms && belowFloor.rooms[0]) {
             const belowSensor = belowFloor.rooms[0].devices?.find(d => d.device_type === 'ENVIRONMENTAL_SENSOR');
             const belowTemp = belowSensor?.lastReading?.temperature ? parseFloat(belowSensor.lastReading.temperature) : currentTemp;
             if (belowTemp > currentTemp) {
                tempDelta += (belowTemp - currentTemp) * 0.1;
             }
          }
        }

        // 5. HVAC PID Controller
        if (hvacStatus === 'ONLINE') {
          const targetTemperature = 22.0;
          const error = targetTemperature - currentTemp;
          // Proportional control
          const coolingEffort = Math.max(-1, Math.min(1, error)); 
          
          if (Math.abs(error) > 0.5) {
             tempDelta += coolingEffort * 1.5; // Cooling/Heating capacity
          }
        }

        // Push the updated sensor reading to FIWARE
        if (!envSensor.lastReading) envSensor.lastReading = {};
        envSensor.lastReading.temperature = Math.max(10, Math.min(150, currentTemp + tempDelta));
        envSensor.lastReading.status_flag = hvacStatus === 'OFFLINE' ? 'WARNING' : 'NORMAL';
        
        // Asynchronously update FIWARE (fire-and-forget for simulation tick)
        const fiwareGateway = require('../gateways/fiwareGateway');
        fiwareGateway.updateIoTDeviceContext(envSensor.id, room.id, envSensor.device_type, envSensor.lastReading).catch(e => {});
      });
    });
  }

  tickCalculatedMetrics() {
    let totalPower = 0;
    
    this.building.floors.forEach(f => {
      if (!f.rooms) return;
      f.rooms.forEach(room => {
        // Base itLoad calculation is simplified for now
        totalPower += 20; 
        
        // Base fan power + PID cooling effort
        totalPower += 5; // simplified HVAC power draw
        
        // Calculate Room Health
        let h = 100;
        const envSensor = room.devices?.find(d => d.device_type === 'ENVIRONMENTAL_SENSOR');
        const currentTemp = envSensor?.lastReading?.temperature ? parseFloat(envSensor.lastReading.temperature) : 22.0;
        if (currentTemp > 25 || currentTemp < 19) h -= 10;
        
        room.healthScore = h;
      });
    });

    // Elevators
    this.building.elevators.forEach(e => {
      if (e.status !== 'IDLE') totalPower += 20;
    });

    this.building.powerLoad = totalPower;
    
    // PHASE 14: Finance & CO2
    // Assuming 1 tick is a timeframe, let's represent hourly rate:
    // Rate: $0.12 per kW, CO2: 0.42 kg per kW
    this.building.opex = totalPower * 0.12; // $/hour
    this.building.co2 = totalPower * 0.42; // kg/hour
    
    // HVAC Efficiency metric
    this.building.hvacEfficiency = 92 + Math.random() * 3; // 92-95%

    // AI Insights Generation
    this.aiInsights = [];
    if (this.building.status === 'NORMAL') {
      this.aiInsights.push({ type: 'success', text: `System nominal. HVAC efficiency is at ${this.building.hvacEfficiency.toFixed(1)}%.` });
      if (this.building.powerLoad > 500) {
        this.aiInsights.push({ type: 'warning', text: `Overall power consumption is slightly elevated (${this.building.powerLoad.toFixed(0)} kW). Consider reducing base IT loads on lower floors.` });
      } else {
        this.aiInsights.push({ type: 'success', text: 'Energy consumption is optimal based on historical Tuesday patterns.' });
      }
    } else if (this.building.status === 'EMERGENCY') {
      if (this.activeScenario === 'SECURITY_BREACH') {
        this.aiInsights.push({ type: 'danger', text: 'SECURITY BREACH DETECTED: Unauthorized access in Floor 15. All elevators halted.' });
        this.aiInsights.push({ type: 'danger', text: 'Initiating security protocols and notifying authorities.' });
      } else {
        this.aiInsights.push({ type: 'danger', text: 'CRITICAL EMERGENCY: Fire detected. Initiating auto-evacuation protocol on affected floors.' });
        this.aiInsights.push({ type: 'danger', text: 'HVAC systems isolated to prevent smoke spread.' });
      }
    } else if (this.building.status === 'WARNING') {
      this.aiInsights.push({ type: 'warning', text: 'Anomalous sensor readings detected. Maintenance team notified.' });
      if (this.activeScenario === 'HVAC_FAILURE') {
        this.aiInsights.push({ type: 'danger', text: 'HVAC Unit Offline: Temperature expected to rise by 2.4°C in the next 30 minutes.' });
      }
    }
  }

  simulateWhatIf(params) {
    // params: { outsideTempDelta: number, occupancyMultiplier: number }
    const deltaT = params.outsideTempDelta || 0;
    const occMult = params.occupancyMultiplier || 1.0;

    let projectedPower = 0;
    
    this.building.floors.forEach(f => {
      if (!f.rooms) return;
      f.rooms.forEach(room => {
        let baseIt = 20 * occMult;
        
        // HVAC load increases if outside temp increases or occupancy increases
        let hvacLoad = 15;
        if (deltaT > 0) hvacLoad += (deltaT * 2.5); // 2.5kW per degree C
        if (deltaT < 0) hvacLoad += (Math.abs(deltaT) * 1.5); // Heating penalty
        
        hvacLoad *= occMult;
        
        projectedPower += hvacLoad;
        projectedPower += baseIt;
      });
    });

    this.building.elevators.forEach(e => {
      if (e.status !== 'IDLE') projectedPower += (20 * occMult);
    });

    return {
      currentPower: this.building.powerLoad,
      projectedPower: projectedPower,
      delta: projectedPower - this.building.powerLoad,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = SimulationEngine;
