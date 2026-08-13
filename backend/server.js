const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const SimulationEngine = require('./src/engine/SimulationEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

const engine = new SimulationEngine();

// API routes can be added here for historic data later
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/building', (req, res) => {
  res.json(engine.building);
});

// Socket.io for Real-time telemetry (1Hz)
io.on('connection', (socket) => {
  console.log(`[CLIENT CONNECTED] ${socket.id}`);
  
  // Send immediate state
  socket.emit('telemetry', engine.building);

  // Listen for actions (scenarios)
  socket.on('setScenario', (scenario) => {
    engine.setScenario(scenario);
    io.emit('telemetry', {
      building: engine.building,
      aiInsights: engine.aiInsights,
      activeScenario: engine.activeScenario,
      weather: engine.weather
    });
  });
  
  socket.on('sabotage', (data) => {
    // data: { type: 'FIRE' | 'HVAC_LEAK' | 'WINDOW_BREAK', floorId }
    engine.triggerSabotage(data.type, data.floorId);
    io.emit('telemetry', {
      building: engine.building,
      aiInsights: engine.aiInsights,
      activeScenario: engine.activeScenario,
      weather: engine.weather
    });
  });

  socket.on('simulate_what_if', (params) => {
    const result = engine.simulateWhatIf(params);
    socket.emit('what_if_result', result);
  });

  socket.on('disconnect', () => {
    console.log(`[CLIENT DISCONNECTED] ${socket.id}`);
  });
});

// Start Simulation Engine
engine.start((state) => {
  io.emit('telemetry', state);
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`[BACKEND] UrbanDigitalTwin server running on port ${PORT}`);
});
