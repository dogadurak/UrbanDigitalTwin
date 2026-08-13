import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import L from 'leaflet';
import useTwinStore from '../../store/useTwinStore';

// Levent, Istanbul coordinates
const CENTER = [41.0825, 29.0125];

// Custom marker icon
const buildingIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const alertIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const MiniMap = () => {
  const building = useTwinStore(state => state.building);
  const viewMode = useTwinStore(state => state.viewMode);

  if (!building) return null;

  const hasCriticalAlert = building.activeAlerts > 0 || building.status === 'EMERGENCY';
  const icon = hasCriticalAlert ? alertIcon : buildingIcon;

  // Dark Canvas map style for ArcGIS feel
  const mapboxUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

  const getViewModeColor = () => {
    switch (viewMode) {
      case 'ENERGY': return '#ffaa00';
      case 'HVAC': return '#00aaff';
      case 'SECURITY': return '#aa00ff';
      case 'FIRE': return '#ff3300';
      default: return '#00ffff';
    }
  };

  return (
    <motion.div
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="bg-black/70 backdrop-blur-lg border border-white/10 rounded-xl overflow-hidden shadow-[0_0_20px_rgba(0,0,0,0.5)] h-64 flex flex-col relative"
    >
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between z-10 bg-black/50 absolute top-0 w-full pointer-events-none">
        <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">
          GIS Live Feed
        </span>
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: getViewModeColor() }} />
      </div>
      
      <div className="flex-1 w-full h-full relative z-0">
        <MapContainer 
          center={CENTER} 
          zoom={15} 
          scrollWheelZoom={true} 
          style={{ height: '100%', width: '100%', background: '#0a0a0a' }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
            url={mapboxUrl}
          />
          
          {/* Main Building Marker */}
          <Marker position={CENTER} icon={icon}>
            <Popup>
              <div className="text-black text-xs font-bold">
                Alpha Tower <br/>
                Status: {building.status} <br/>
                Alerts: {building.activeAlerts}
              </div>
            </Popup>
          </Marker>

          {/* Simulated nearby sensor nodes / cameras */}
          <Circle center={[41.0835, 29.0115]} radius={50} pathOptions={{ color: viewMode === 'SECURITY' ? '#aa00ff' : '#00ffff', fillColor: viewMode === 'SECURITY' ? '#aa00ff' : '#00ffff', fillOpacity: 0.2 }} />
          <Circle center={[41.0815, 29.0135]} radius={80} pathOptions={{ color: viewMode === 'ENERGY' ? '#ffaa00' : '#00ffff', fillColor: viewMode === 'ENERGY' ? '#ffaa00' : '#00ffff', fillOpacity: 0.2 }} />
          
          {hasCriticalAlert && (
            <Circle center={CENTER} radius={150} pathOptions={{ color: '#ff0000', fillColor: '#ff0000', fillOpacity: 0.3 }} />
          )}
        </MapContainer>
      </div>
    </motion.div>
  );
};

export default MiniMap;
