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
  }

  start(broadcastCallback) {
    this.interval = setInterval(() => {
      this.tick();
      if (broadcastCallback) {
        broadcastCallback({
          building: this.building,
          aiInsights: this.aiInsights,
          activeScenario: this.activeScenario
        });
      }
    }, this.tickRateMs);
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
    this.tickElevators();
    this.tickSensors();
    this.tickCalculatedMetrics();
  }

  tickElevators() {
    if (this.building.status === 'EMERGENCY') {
      this.building.elevators.forEach(elv => elv.status = 'IDLE');
      return;
    }

    this.building.elevators.forEach(elv => {
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
    // Generate organic noise for sensors
    const now = new Date().toISOString();
    
    this.building.floors.forEach(f => {
      f.zones.forEach(z => {
        // Normal Temp fluctuation unless fire
        if (this.activeScenario === 'FIRE_EMERGENCY' && f.level === 5) {
          z.sensors.temperature.currentValue = Math.min(100, z.sensors.temperature.currentValue + 1.0);
        } else if (this.activeScenario === 'HVAC_FAILURE' && f.level === 10) {
          z.sensors.temperature.currentValue = Math.min(30, z.sensors.temperature.currentValue + 0.1);
        } else {
          z.sensors.temperature.currentValue += (Math.random() - 0.5) * 0.2;
          // bounds clamp 18 - 26
          z.sensors.temperature.currentValue = Math.max(18, Math.min(26, z.sensors.temperature.currentValue));
        }

        z.sensors.humidity.currentValue += (Math.random() - 0.5) * 1.0;
        z.sensors.itLoad.currentValue += (Math.random() - 0.5) * 0.5;
        z.sensors.airQuality.currentValue += (Math.random() - 0.5) * 1.5;

        // Optionally, push to history (simplified here, in reality we'd throttle this to 1 per min)
        // We'll skip pushing to history arrays every tick to save memory/bandwidth for 1Hz broadcast.
        // History arrays are static generated initially, they'll be dynamic later if we implement a DB.
      });
    });
  }

  tickCalculatedMetrics() {
    let totalPower = 0;
    
    this.building.floors.forEach(f => {
      f.zones.forEach(z => {
        totalPower += z.sensors.itLoad.currentValue;
        if (z.assets.hvac.status === 'ONLINE') totalPower += 15; // HVAC Base Load
        
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
