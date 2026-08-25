import React, { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';

const CesiumViewer = ({ onEnterBuilding }) => {
  const cesiumContainer = useRef(null);

  useEffect(() => {
    // Required for Cesium access token (Optional for now since we rely on GeoJSON and default imagery)
    // Cesium.Ion.defaultAccessToken = 'YOUR_ACCESS_TOKEN';

    const viewer = new Cesium.Viewer(cesiumContainer.current, {
      terrainProvider: Cesium.createWorldTerrain(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      animation: false,
      timeline: false,
      fullscreenButton: false
    });
    
    viewer.scene.globe.enableLighting = true;

    // Load Buildings
    const loadBuildings = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/gis/buildings');
        const geojsonData = await response.json();
        
        const dataSource = await Cesium.GeoJsonDataSource.load(geojsonData, {
          stroke: Cesium.Color.fromCssColorString('#00ffff'),
          fill: Cesium.Color.fromCssColorString('#0a203f').withAlpha(0.8),
          strokeWidth: 2,
        });
        
        viewer.dataSources.add(dataSource);
        
        // Extrude building heights
        const entities = dataSource.entities.values;
        for (let i = 0; i < entities.length; i++) {
          const entity = entities[i];
          if (entity.polygon) {
            // Give buildings a height (mocked as 30 for visualization purposes)
            entity.polygon.extrudedHeight = 30; 
          }
        }
        
        viewer.zoomTo(dataSource);
      } catch(e) {
        console.error("Failed to load buildings:", e);
      }
    };

    // Load Roads
    const loadRoads = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/gis/roads');
        const geojsonData = await response.json();
        
        const dataSource = await Cesium.GeoJsonDataSource.load(geojsonData, {
          stroke: Cesium.Color.fromCssColorString('#ffffff').withAlpha(0.4),
          strokeWidth: 3,
        });
        
        viewer.dataSources.add(dataSource);
      } catch(e) {
        console.error("Failed to load roads:", e);
      }
    };

    loadBuildings();
    loadRoads();

    // Interaction handler to transition from Cesium macro view to Three.js micro view
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      const pickedObject = viewer.scene.pick(click.position);
      if (Cesium.defined(pickedObject) && pickedObject.id) {
        console.log("Selected building ID:", pickedObject.id.name || pickedObject.id.id);
        if(onEnterBuilding) onEnterBuilding(pickedObject.id.name || pickedObject.id.id);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      viewer.destroy();
    };
  }, [onEnterBuilding]);

  return (
    <div className="cesium-wrapper" style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <div ref={cesiumContainer} style={{ width: '100%', height: '100%' }} />
      <div className="absolute top-4 left-4 z-10 p-4 bg-black/60 border border-cyan-500 rounded text-white backdrop-blur">
        <h1 className="text-xl font-bold text-cyan-400">Urban Digital Twin (Macro)</h1>
        <p className="text-sm">Click on a building to enter Micro BIM mode.</p>
      </div>
    </div>
  );
};

export default CesiumViewer;
