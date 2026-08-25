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

const spatialRepo = require('./src/repositories/spatialRepository');
const fiwareGateway = require('./src/gateways/fiwareGateway');

app.use(express.json()); // To parse FIWARE notifications

// API routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/building', (req, res) => {
  res.json(engine.building);
});

app.get('/api/gis/buildings', async (req, res) => {
  try {
    const data = await spatialRepo.getBuildings();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/gis/roads', async (req, res) => {
  try {
    const data = await spatialRepo.getRoads();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// BIM Endpoints
app.get('/api/bim/building/:id', async (req, res) => {
  try {
    const bimRepo = require('./src/repositories/bimRepository');
    const data = await bimRepo.getBuildingHierarchy(req.params.id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/fiware/notify', async (req, res) => {
  console.log('[FIWARE NOTIFICATION] Received context update:', JSON.stringify(req.body, null, 2));
  
  const data = req.body.data || [];
  
  for (const entity of data) {
    if (entity.type === 'AIInsight') {
      try {
        await spatialRepo.insertAIInsight(entity);
        engine.aiInsights.push(entity); // keep in memory for telemetry
        
        io.emit('ai_insight_alert', {
          message: 'THERMAL ANOMALY DETECTED',
          insight: entity
        });
        console.log(`[AI INSIGHT] Processed anomaly for ${entity.refRoom?.object} with score ${entity.anomalyScore?.value}`);
      } catch (err) {
        console.error('Failed to save AIInsight:', err);
      }
    }
  }
  
  // Here we broadcast the FIWARE event to the React frontend
  io.emit('fiware_alert', {
    message: 'FIWARE Context Updated',
    data: req.body
  });

  res.status(200).send();
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
server.listen(PORT, async () => {
  console.log(`[BACKEND] UrbanDigitalTwin server running on port ${PORT}`);
  // Wait a few seconds for Orion-LD to be fully up, then setup subscription
  setTimeout(async () => {
    // In local dev from Windows to docker container, host.docker.internal points back to host
    await fiwareGateway.setupSubscription('http://host.docker.internal:3001/api/fiware/notify');
  }, 5000);
});
