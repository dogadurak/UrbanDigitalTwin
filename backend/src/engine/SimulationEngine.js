const { generateBuildingModel } = require('./DataModel');
const crypto = require('crypto');

class SimulationEngine {
  constructor() {
    this.building = generateBuildingModel();
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

  start(broadcastCallback) {
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
      // Fetch weather for Istanbul
      const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current=temperature_2m,relative_humidity_2m,rain,wind_speed_10m');
      const data = await res.json();
      
      this.weather.temperature = data.current.temperature_2m;
      this.weather.humidity = data.current.relative_humidity_2m;
      this.weather.isRaining = data.current.rain > 0;
      this.weather.windSpeed = data.current.wind_speed_10m;
      this.weather.condition = this.weather.isRaining ? 'RAIN' : 'CLEAR';
      
      console.log(`[WEATHER] Updated: ${this.weather.temperature}°C, Rain: ${this.weather.isRaining}`);
      this.lastWeatherFetch = Date.now();
    } catch (e) {
      console.error("[WEATHER] Failed to fetch weather:", e.message);
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
      f.zones.forEach(z => {
        // Occupancy calculation
        let occ = baseOccupancy + (Math.random() - 0.5) * 5;
        if (this.building.status === 'EMERGENCY' || occ < 0) occ = 0;
        z.sensors.occupancy.currentValue = Math.floor(occ);

        // Base IT Load based on occupancy + baseline servers
        const serverLoad = f.level === 3 ? 150 : 20; // Floor 3 is server room
        z.sensors.itLoad.currentValue = serverLoad + (z.sensors.occupancy.currentValue * 0.5);

        // Heat generation
        const humanHeat = z.sensors.occupancy.currentValue * 0.05; // kW
        const itHeat = z.sensors.itLoad.currentValue * 0.02; // kW
        let heatGenerated = humanHeat + itHeat;

        // Sabotage overrides
        if (this.activeScenario === 'FIRE_EMERGENCY' && f.level === 5) {
          heatGenerated += 50.0;
        } else if (z.sensors.fireSafety.isAlarmActive) {
          heatGenerated += 30.0; 
        }

        z.heatGenerated = heatGenerated;
      });
    });

    // Second pass: Heat Transfer & HVAC (Thermodynamics & PID)
    this.building.floors.forEach((f, index) => {
      f.zones.forEach(z => {
        const hvac = z.assets.hvac;
        let currentTemp = z.sensors.temperature.currentValue;

        // 1. Natural Heat Transfer (Weather)
        const outsideTemp = this.weather.temperature;
        const weatherLeak = 0.05; // Insulation factor
        let tempDelta = (outsideTemp - currentTemp) * weatherLeak;

        // 2. Solar Gain (Sun effect)
        const solarGain = (this.timeOfDay > 9 && this.timeOfDay < 16 && !this.weather.isRaining) ? 0.3 : 0;
        tempDelta += solarGain;

        // 3. Internal Heat Generation
        tempDelta += z.heatGenerated * 0.1;

        // 4. Heat Transfer from below floor (Heat rises)
        if (index > 0) {
          const belowFloor = this.building.floors[index - 1];
          const belowTemp = belowFloor.zones[0].sensors.temperature.currentValue;
          if (belowTemp > currentTemp) {
             tempDelta += (belowTemp - currentTemp) * 0.1;
          }
        }

        // 5. HVAC PID Controller
        if (hvac.status === 'ONLINE' && !z.sensors.fireSafety.isAlarmActive) {
          const error = hvac.targetTemperature - currentTemp;
          // Proportional control
          const coolingEffort = Math.max(-1, Math.min(1, error)); 
          
          if (Math.abs(error) > 0.5) {
             // HVAC is working hard
             hvac.powerDraw = Math.abs(coolingEffort) * 30; // up to 30kW
             tempDelta += coolingEffort * 1.5; // Cooling/Heating capacity
             
             // Wear and Tear calculation
             hvac.wearAndTear += (hvac.powerDraw / 30) * 0.02; 
          } else {
             hvac.powerDraw = 5; // Base fan power
             hvac.wearAndTear += 0.001;
          }

          // Predictive Maintenance check
          if (hvac.wearAndTear > 100) {
            hvac.status = 'OFFLINE';
            hvac.health = 10;
            z.alerts.push({
              id: crypto.randomUUID(),
              severity: 'WARNING',
              timestamp: new Date().toLocaleTimeString(),
              message: `HVAC CRITICAL FAILURE ON ${f.name} DUE TO EXCESSIVE WEAR`
            });
            this.building.activeAlerts++;
            this.aiInsights.push({ type: 'warning', text: `Predictive Maintenance missed! HVAC on ${f.name} broke down.` });
          }
        } else {
          hvac.powerDraw = 0;
        }

        z.sensors.temperature.currentValue = Math.max(10, Math.min(150, currentTemp + tempDelta));
        
        // Air Quality drops with occupancy if HVAC is offline
        if (hvac.status === 'OFFLINE' && z.sensors.occupancy.currentValue > 0) {
           z.sensors.airQuality.currentValue -= 0.5;
        } else if (hvac.status === 'ONLINE') {
           z.sensors.airQuality.currentValue = Math.min(100, z.sensors.airQuality.currentValue + 1.0);
        }
        
        // Add minimal noise for realism
        z.sensors.humidity.currentValue += (Math.random() - 0.5) * 1.0;
        z.sensors.humidity.currentValue = Math.max(20, Math.min(80, z.sensors.humidity.currentValue));
      });
    });
  }

  tickCalculatedMetrics() {
    let totalPower = 0;
    
    this.building.floors.forEach(f => {
      f.zones.forEach(z => {
        totalPower += z.sensors.itLoad.currentValue;
        if (z.assets.hvac.status === 'ONLINE') {
           // Base fan power + PID cooling effort
           totalPower += z.assets.hvac.powerDraw || 0;
        }
        
        // Calculate Zone Health
        let h = 100;
        if (z.sensors.temperature.currentValue > 25 || z.sensors.temperature.currentValue < 19) h -= 10;
        if (z.assets.hvac.status === 'OFFLINE') h -= 40;
        if (z.sensors.fireSafety.isAlarmActive) h = 0;
        z.healthScore = h;
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
    const hvacOnline = this.building.floors.reduce((acc, f) => acc + (f.zones[0].assets.hvac.status === 'ONLINE' ? 1 : 0), 0);
    this.building.hvacEfficiency = (hvacOnline / this.building.floors.length) * (90 + Math.random() * 5); // 90-95%

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
      f.zones.forEach(z => {
        // Base IT Load scaling with occupancy
        let baseIt = z.sensors.itLoad.currentValue * occMult;
        
        // HVAC load increases if outside temp increases or occupancy increases
        let hvacLoad = 15;
        if (deltaT > 0) hvacLoad += (deltaT * 2.5); // 2.5kW per degree C
        if (deltaT < 0) hvacLoad += (Math.abs(deltaT) * 1.5); // Heating penalty
        
        hvacLoad *= occMult;
        
        if (z.assets.hvac.status === 'ONLINE') {
          projectedPower += hvacLoad;
        }
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
