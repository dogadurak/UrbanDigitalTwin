import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html, Environment, ContactShadows } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import useTwinStore from '../store/useTwinStore';

const Floor = ({ position, floorData, selected, isIsolated, onClick }) => {
  const meshRef = useRef();
  const viewMode = useTwinStore(state => state.viewMode);
  
  const alerts = floorData.zones[0]?.alerts || [];
  const hasCritical = alerts.some(a => a.severity === 'CRITICAL');
  const hasWarning = alerts.some(a => a.severity === 'WARNING');

  // Materials refs for opacity animation (all objects)
  const ghostMatRefs = useRef([]);
  // Materials refs for alert pulsing (only specific objects like slab)
  const alertMatRefs = useRef([]);
  
  // Basic calculations for view modes
  const itLoad = floorData.zones[0]?.sensors?.itLoad?.currentValue || 0;
  const energyColor = itLoad > 60 ? "#ff2200" : (itLoad > 30 ? "#ffaa00" : "#00ff00");
  const hvacEff = floorData.zones[0]?.assets?.hvac?.health || 0;
  
  const isSecurityMode = viewMode === 'SECURITY';
  const isFireMode = viewMode === 'FIRE';
  const isFireAlarm = floorData.zones[0]?.sensors?.fireSafety?.isAlarmActive;

  useFrame((state, delta) => {
    // Position Animation
    if (selected) {
      meshRef.current.position.x = THREE.MathUtils.lerp(meshRef.current.position.x, 1.5, delta * 5);
      meshRef.current.position.z = THREE.MathUtils.lerp(meshRef.current.position.z, 1.5, delta * 5);
    } else {
      meshRef.current.position.x = THREE.MathUtils.lerp(meshRef.current.position.x, 0, delta * 5);
      meshRef.current.position.z = THREE.MathUtils.lerp(meshRef.current.position.z, 0, delta * 5);
    }

    // Alarm pulsing effect
    const time = state.clock.getElapsedTime();
    let pulseOpacity = 0;
    let pulseColor = null;
    
    if (isFireAlarm || hasCritical) {
      pulseOpacity = (Math.sin(time * 8) + 1) / 2; // 0 to 1 very fast
      pulseColor = new THREE.Color("#ff0000");
    } else if (hasWarning) {
      pulseOpacity = (Math.sin(time * 2) + 1) / 2; // 0 to 1 slow
      pulseColor = new THREE.Color("#ff8800");
    }

    // Opacity Animation (Ghost mode for unselected floors)
    const targetOpacityMultiplier = (isIsolated && !selected) ? 0.05 : 1.0;
    
    ghostMatRefs.current.forEach(mat => {
      if (mat) {
        mat.transparent = true;
        if (mat.userData.origOpacity === undefined) {
          mat.userData.origOpacity = mat.opacity !== undefined ? mat.opacity : 1.0;
        }
        let targetOpacity = mat.userData.origOpacity * targetOpacityMultiplier;
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, delta * 5);
        mat.depthWrite = !isIsolated || selected;
      }
    });

    // Alert pulsing only on designated materials (e.g., floor slab, glass)
    alertMatRefs.current.forEach(mat => {
      if (mat) {
        if (mat.userData.origColor === undefined) {
          mat.userData.origColor = mat.color ? mat.color.clone() : new THREE.Color("#ffffff");
          mat.userData.origEmissive = mat.emissive ? mat.emissive.clone() : new THREE.Color("#000000");
        }
        if (pulseColor && (!isIsolated || selected)) {
           if (mat.color) mat.color.lerpColors(mat.userData.origColor, pulseColor, pulseOpacity * 0.7);
           if (mat.emissive) {
             mat.emissive.lerpColors(mat.userData.origEmissive, pulseColor, pulseOpacity * 0.5);
             mat.emissiveIntensity = 1 + pulseOpacity * 4.0; // Huge boost for Bloom glow
           }
        } else {
           if (mat.color) mat.color.lerp(mat.userData.origColor, delta * 5);
           if (mat.emissive) {
             mat.emissive.lerp(mat.userData.origEmissive, delta * 5);
             mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity || 0, 1, delta * 5);
           }
        }
      }
    });
  });

  const addGhostMat = (mat) => {
    if (mat && !ghostMatRefs.current.includes(mat)) ghostMatRefs.current.push(mat);
  };
  
  const addAlertMat = (mat) => {
    if (mat && !alertMatRefs.current.includes(mat)) alertMatRefs.current.push(mat);
    addGhostMat(mat); // alert materials should also be ghosted
  };

  return (
    <group position={position} ref={meshRef}>
      <group
        onClick={(e) => {
          e.stopPropagation();
          onClick(floorData.id);
        }}
        onPointerOver={(e) => { 
          e.stopPropagation(); 
          if (!isIsolated || selected) document.body.style.cursor = 'pointer'; 
        }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; }}
      >
        {/* Floor Slab */}
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[10, 0.2, 10]} />
          <meshPhysicalMaterial 
            ref={addAlertMat}
            color={selected ? "#00ffff" : "#d1d5db"} // Very bright base color
            metalness={0.2} roughness={0.8}
            transparent opacity={viewMode === 'HVAC' ? 0.2 : 1.0}
            wireframe={viewMode === 'HVAC'}
          />
        </mesh>
        
        {/* Structural Columns */}
        {[-4.8, 4.8].map(x => 
          [-4.8, 4.8].map(z => (
            <mesh key={`col-${x}-${z}`} position={[x, 1.1, z]}>
              <cylinderGeometry args={[0.1, 0.1, 2.2, 8]} />
              <meshStandardMaterial ref={addGhostMat} color="#9ca3af" metalness={0.3} roughness={0.7} transparent opacity={viewMode === 'HVAC' ? 0.1 : 1} />
            </mesh>
          ))
        )}

        {/* HVAC Pipes */}
        <mesh position={[0, 2.0, 2]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.2, 0.2, 9, 16]} />
          <meshStandardMaterial 
            ref={addGhostMat} 
            color={viewMode === 'HVAC' ? "#00ffff" : "#cbd5e1"} 
            emissive={viewMode === 'HVAC' ? "#00aaff" : "#000000"}
            emissiveIntensity={viewMode === 'HVAC' ? 2.5 : 0}
            metalness={0.8} roughness={0.2} 
          />
        </mesh>
        <mesh position={[2, 2.0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.2, 0.2, 9, 16]} />
          <meshStandardMaterial 
            ref={addGhostMat} 
            color={viewMode === 'HVAC' ? "#00ffff" : "#cbd5e1"} 
            emissive={viewMode === 'HVAC' ? "#00aaff" : "#000000"}
            emissiveIntensity={viewMode === 'HVAC' ? 2.5 : 0}
            metalness={0.8} roughness={0.2} 
          />
        </mesh>

        {/* Electrical Conduits - Hide in HVAC/SECURITY/FIRE mode */}
        {!['HVAC', 'SECURITY', 'FIRE'].includes(viewMode) && (
          <mesh position={[-1, 1.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 9.5, 8]} />
            <meshBasicMaterial ref={addGhostMat} color={viewMode === 'ENERGY' ? "#ffff00" : (selected ? "#ffaa00" : "#fb923c")} />
          </mesh>
        )}
        
        {/* Servers - Color by energy in ENERGY mode, Hide in HVAC/SECURITY/FIRE mode */}
        {!['HVAC', 'SECURITY', 'FIRE'].includes(viewMode) && (
          <group>
            <mesh position={[-3, 0.6, -3]}>
              <boxGeometry args={[1.2, 1.2, 0.8]} />
              <meshStandardMaterial 
                ref={addGhostMat} 
                color={viewMode === 'ENERGY' ? energyColor : "#e2e8f0"} 
                emissive={viewMode === 'ENERGY' ? energyColor : "#000000"} 
                emissiveIntensity={viewMode === 'ENERGY' ? 2.5 : 0} 
                metalness={0.9} roughness={0.1} 
              />
            </mesh>
            <mesh position={[-2.35, 0.8, -3]}>
               <boxGeometry args={[0.05, 0.1, 0.6]} />
               <meshStandardMaterial 
                 ref={addGhostMat} 
                 color={selected ? "#00ff00" : "#22c55e"} 
                 emissive={selected ? "#00ff00" : "#22c55e"} 
                 emissiveIntensity={2} 
               />
            </mesh>
          </group>
        )}

        {/* Security Cameras (CCTV) */}
        {[-4.5, 4.5].map(x => 
          [-4.5, 4.5].map(z => (
            <mesh key={`cam-${x}-${z}`} position={[x, 2.0, z]} rotation={[Math.PI / 4, x > 0 ? -Math.PI/4 : Math.PI/4, 0]}>
              <boxGeometry args={[0.2, 0.1, 0.3]} />
              <meshStandardMaterial 
                ref={addGhostMat} 
                color={isSecurityMode ? "#ff00ff" : "#333333"} 
                emissive={isSecurityMode ? "#ff00ff" : "#000000"} 
                emissiveIntensity={isSecurityMode ? 2 : 0} 
              />
            </mesh>
          ))
        )}

        {/* Smoke Detectors */}
        {[[-2, -2], [2, 2], [-2, 2], [2, -2]].map((pos, idx) => (
          <mesh key={`smoke-${idx}`} position={[pos[0], 2.1, pos[1]]}>
            <cylinderGeometry args={[0.15, 0.15, 0.05, 16]} />
            <meshStandardMaterial 
              ref={addAlertMat} 
              color={isFireMode || isFireAlarm ? "#ff0000" : "#ffffff"} 
              emissive={isFireAlarm ? "#ff0000" : "#000000"} 
              emissiveIntensity={isFireAlarm ? 3 : 0} 
            />
          </mesh>
        ))}

        {/* Evacuation Routes (Glowing paths to center shaft) */}
        {(isFireMode || isFireAlarm) && (
          <group position={[0, 0.11, 0]}>
            <mesh position={[-2.5, 0, 0]}>
              <boxGeometry args={[4, 0.02, 0.5]} />
              <meshBasicMaterial ref={addAlertMat} color="#00ff00" transparent opacity={0.6} />
            </mesh>
            <mesh position={[2.5, 0, 0]}>
              <boxGeometry args={[4, 0.02, 0.5]} />
              <meshBasicMaterial ref={addAlertMat} color="#00ff00" transparent opacity={0.6} />
            </mesh>
            <mesh position={[0, 0, -2.5]}>
              <boxGeometry args={[0.5, 0.02, 4]} />
              <meshBasicMaterial ref={addAlertMat} color="#00ff00" transparent opacity={0.6} />
            </mesh>
            <mesh position={[0, 0, 2.5]}>
              <boxGeometry args={[0.5, 0.02, 4]} />
              <meshBasicMaterial ref={addAlertMat} color="#00ff00" transparent opacity={0.6} />
            </mesh>
          </group>
        )}

        {/* Glass Facade - Optimized for Performance */}
        {viewMode === 'NORMAL' && (
          <mesh position={[0, 1.1, 0]}>
            <boxGeometry args={[10.2, 2.2, 10.2]} />
            <meshPhysicalMaterial 
              ref={addAlertMat}
              color="#aaddff"
              emissive="#002244"
              emissiveIntensity={0.2}
              metalness={0.8}
              roughness={0.1}
              envMapIntensity={2.0}
              transparent
              opacity={0.15}
              // Removed expensive transmission/ior/clearcoat to guarantee 60 FPS
            />
          </mesh>
        )}
      </group>
      
      {/* Label for selected floor */}
      {selected && (
        <Html position={[8, 1, 8]} center zIndexRange={[100, 0]}>
          <div className="bg-black/80 text-cyan-400 px-4 py-2 rounded-lg border border-cyan-500/50 backdrop-blur-md whitespace-nowrap shadow-[0_0_15px_rgba(0,255,255,0.3)] pointer-events-none">
            <div className="font-bold">{floorData.name}</div>
            <div className="text-xs text-yellow-400">MEP Active | {floorData.id}</div>
          </div>
        </Html>
      )}

      {/* Occupancy / People Simulation */}
      <People floorData={floorData} isIsolated={isIsolated} selected={selected} />
    </group>
  );
}

const dummy = new THREE.Object3D();
const People = ({ floorData, isIsolated, selected }) => {
  const meshRef = useRef();
  const viewMode = useTwinStore(state => state.viewMode);
  
  const isFireAlarm = floorData.zones[0]?.sensors?.fireSafety?.isAlarmActive;
  const isFireMode = viewMode === 'FIRE';
  const count = 25; // 25 people per floor
  
  const agents = React.useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 8,
      z: (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 0.5,
      vz: (Math.random() - 0.5) * 0.5,
    }));
  }, [count]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    if ((isIsolated && !selected) || viewMode === 'HVAC' || viewMode === 'ENERGY') {
      meshRef.current.visible = false;
      return;
    }
    meshRef.current.visible = true;

    agents.forEach((agent, i) => {
      // Fire Evacuation Logic
      if (isFireAlarm || isFireMode) {
        // Move towards central shaft (x=0, z=0) which is the evacuation route
        const dx = 0 - agent.x;
        const dz = 0 - agent.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist > 0.8) {
          agent.vx = (dx / dist) * 1.5;
          agent.vz = (dz / dist) * 1.5;
        } else {
          agent.vx = 0; agent.vz = 0; // Reached exit
        }
      } else {
        // Random wandering
        if (Math.random() < 0.05) {
          agent.vx += (Math.random() - 0.5) * 1.0;
          agent.vz += (Math.random() - 0.5) * 1.0;
        }
        
        // Clamp speed
        const speed = Math.sqrt(agent.vx*agent.vx + agent.vz*agent.vz);
        if (speed > 0.4) {
          agent.vx = (agent.vx / speed) * 0.4;
          agent.vz = (agent.vz / speed) * 0.4;
        }
      }
      
      // Boundary collision
      if (agent.x < -4.5 || agent.x > 4.5) agent.vx *= -1;
      if (agent.z < -4.5 || agent.z > 4.5) agent.vz *= -1;
      
      agent.x += agent.vx * delta;
      agent.z += agent.vz * delta;

      // Y position is relative to the floor group, so y=0.15 is on top of slab
      dummy.position.set(agent.x, 0.25, agent.z);
      // Bobbing animation for walking
      if (agent.vx !== 0 || agent.vz !== 0) {
        dummy.position.y += Math.sin(state.clock.elapsedTime * 15 + i) * 0.05;
      }
      
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <cylinderGeometry args={[0.06, 0.06, 0.3, 8]} />
      <meshStandardMaterial 
        color={isFireAlarm ? "#ff0000" : "#00aaff"} 
        emissive={isFireAlarm ? "#ff0000" : "#0044ff"}
        emissiveIntensity={isFireAlarm ? 2 : 0.8}
        roughness={0.2}
      />
    </instancedMesh>
  );
};

const ElevatorSystem = () => {
  const elevators = useTwinStore((state) => state.building.elevators);
  const floorCount = useTwinStore((state) => state.building.floors.length);
  const selectedFloorId = useTwinStore((state) => state.selectedFloorId);
  const isIsolated = selectedFloorId !== null;

  // Render 3 elevators arranged in a triangle or line inside the core shaft
  const positions = [
    [-1, 0, 0], // E1
    [1, 0, -1], // E2
    [1, 0, 1]   // E3
  ];

  return (
    <group>
      {elevators.map((elv, i) => {
        // Calculate Y position based on currentFloor
        const yPos = elv.currentFloor * 2.2 + 1.1; 
        const isMoving = elv.status !== 'IDLE';
        
        return (
          <mesh key={elv.id} position={[positions[i][0], yPos, positions[i][2]]}>
            <boxGeometry args={[1.2, 2.0, 1.2]} />
            <meshStandardMaterial 
              color={isMoving ? "#00aaff" : "#9ca3af"} 
              emissive={isMoving ? "#00aaff" : "#000000"}
              emissiveIntensity={isMoving ? 1 : 0}
              metalness={0.8} 
              roughness={0.2}
              transparent 
              opacity={isIsolated ? 0.2 : 1.0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

const Building = () => {
  const building = useTwinStore((state) => state.building);
  const selectedFloorId = useTwinStore((state) => state.selectedFloorId);
  const setSelectedFloorId = useTwinStore((state) => state.setSelectedFloorId);
  
  const floorCount = building.floors.length;
  const isIsolated = selectedFloorId !== null;

  return (
    <group>
      {/* Core elevator shaft */}
      <mesh position={[0, (floorCount * 2.2) / 2, 0]}>
        <boxGeometry args={[4, floorCount * 2.2 + 2, 4]} />
        <meshStandardMaterial 
          color="#1e293b" metalness={0.6} roughness={0.3} 
          transparent opacity={isIsolated ? 0.05 : 0.4}
        />
      </mesh>
      
      <ElevatorSystem />
      
      {/* Floors */}
      {building.floors.map((floor, i) => (
        <Floor 
          key={floor.id} 
          floorData={floor}
          position={[0, i * 2.2 + 1.1, 0]} 
          selected={selectedFloorId === floor.id}
          isIsolated={isIsolated}
          onClick={(id) => setSelectedFloorId(id === selectedFloorId ? null : id)}
        />
      ))}
    </group>
  );
}

// Camera Rig to animate camera based on selected floor
const CameraRig = ({ controlsRef }) => {
  const selectedFloorId = useTwinStore((state) => state.selectedFloorId);
  const building = useTwinStore((state) => state.building);
  const presentationMode = useTwinStore((state) => state.presentationMode);

  useFrame((state, delta) => {
    if (!controlsRef.current) return;

    if (selectedFloorId) {
      const floorIndex = building.floors.findIndex(f => f.id === selectedFloorId);
      const targetY = floorIndex * 2.2 + 1.1;

      // Move camera closer to the selected floor
      state.camera.position.lerp(new THREE.Vector3(15, targetY + 8, 15), delta * 3);
      controlsRef.current.target.lerp(new THREE.Vector3(0, targetY, 0), delta * 3);
    } else if (presentationMode) {
      // Auto-rotate ONLY in presentation mode
      const time = state.clock.getElapsedTime();
      const radius = 35;
      const speed = 0.1;
      const x = Math.sin(time * speed) * radius;
      const z = Math.cos(time * speed) * radius;
      state.camera.position.lerp(new THREE.Vector3(x, 20, z), delta * 2);
      controlsRef.current.target.lerp(new THREE.Vector3(0, 15, 0), delta * 2);
    }
    // If not in presentation mode and no floor is selected, do NOTHING!
    // This allows OrbitControls to move freely without fighting the lerp, fixing all jitter/locking.
  });

  return null;
}

const PresentationDirector = () => {
  const presentationMode = useTwinStore(state => state.presentationMode);
  const building = useTwinStore(state => state.building);
  const setSelectedFloorId = useTwinStore(state => state.setSelectedFloorId);
  const setViewMode = useTwinStore(state => state.setViewMode);
  const triggerScenario = useTwinStore(state => state.triggerScenario);

  useEffect(() => {
    if (!presentationMode) {
      // Cleanup if exited
      setSelectedFloorId(null);
      setViewMode('NORMAL');
      triggerScenario(null);
      return;
    }

    let step = 0;
    const interval = setInterval(() => {
      step = (step + 1) % 7;
      
      switch (step) {
        case 0:
          setSelectedFloorId(null);
          setViewMode('NORMAL');
          triggerScenario(null);
          break;
        case 1:
          setSelectedFloorId(building.floors[0].id); // Floor 1
          break;
        case 2:
          setViewMode('ENERGY');
          break;
        case 3:
          setViewMode('HVAC');
          break;
        case 4:
          setSelectedFloorId(null); // Full building
          break;
        case 5:
          triggerScenario('HVAC_FAILURE'); // Dramatic event
          break;
        case 6:
          setViewMode('ENERGY'); // Look at the chaos
          break;
      }
    }, 6000); // Change every 6 seconds

    return () => clearInterval(interval);
  }, [presentationMode, building.floors, setSelectedFloorId, setViewMode, triggerScenario]);

  return null;
}

const RoofChiller = () => {
  const floorCount = useTwinStore((state) => state.building?.floors.length || 0);
  const viewMode = useTwinStore((state) => state.viewMode);
  const isIsolated = useTwinStore((state) => state.selectedFloorId !== null);
  
  if (isIsolated || !floorCount) return null;
  
  const roofY = floorCount * 2.2 + 0.5;
  const isHVAC = viewMode === 'HVAC';
  
  return (
    <group position={[0, roofY, 0]}>
      {[-2, 2].map((x, i) => (
        <group key={`chiller-${i}`} position={[x, 0, 0]}>
          {/* Main unit */}
          <mesh position={[0, 1, 0]}>
            <boxGeometry args={[2.5, 1.5, 3]} />
            <meshStandardMaterial color={isHVAC ? "#00ffff" : "#64748b"} emissive={isHVAC ? "#00aaff" : "#000000"} emissiveIntensity={isHVAC ? 0.5 : 0} metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Fans */}
          <mesh position={[0, 1.76, -0.7]} rotation={[Math.PI/2, 0, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 0.1, 16]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
          <mesh position={[0, 1.76, 0.7]} rotation={[Math.PI/2, 0, 0]}>
            <cylinderGeometry args={[0.5, 0.5, 0.1, 16]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
        </group>
      ))}
      
      {/* Primary descending pipes connecting to shaft */}
      {isHVAC && (
        <mesh position={[0, -0.5, -2.5]}>
          <cylinderGeometry args={[0.4, 0.4, 2, 16]} />
          <meshStandardMaterial color="#00ffff" emissive="#00aaff" emissiveIntensity={3} metalness={0.8} roughness={0.2} />
        </mesh>
      )}
    </group>
  );
};

const CityContext = () => {
  // Generate random building blocks for the urban environment
  const buildings = React.useMemo(() => {
    const blocks = [];
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 150;
      const z = (Math.random() - 0.5) * 150;
      // Don't spawn buildings too close to the center
      if (Math.abs(x) < 20 && Math.abs(z) < 20) continue;
      
      const height = Math.random() * 15 + 5;
      const width = Math.random() * 6 + 4;
      const depth = Math.random() * 6 + 4;
      blocks.push({ x, z, width, height, depth });
    }
    return blocks;
  }, []);

  return (
    <group>
      {/* Roads */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#050510" roughness={0.9} />
      </mesh>
      
      {/* Central Plaza Base */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[30, 0.2, 30]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.8} />
      </mesh>

      {/* Neighboring Buildings */}
      {buildings.map((b, i) => (
        <mesh key={i} position={[b.x, b.height / 2, b.z]}>
          <boxGeometry args={[b.width, b.height, b.depth]} />
          <meshStandardMaterial 
            color="#0f172a" 
            metalness={0.8} 
            roughness={0.2}
            emissive="#020617"
            emissiveIntensity={0.5}
          />
        </mesh>
      ))}
    </group>
  );
};

const EnvironmentLighting = () => {
  const timeOfDay = useTwinStore(state => state.building?.timeOfDay) || 12;
  
  const isDay = timeOfDay > 6 && timeOfDay < 18;
  const sunAngle = ((timeOfDay - 6) / 12) * Math.PI; // 0 at 6am, PI at 6pm
  
  const sunX = Math.cos(sunAngle) * 30;
  const sunY = Math.sin(sunAngle) * 30;
  const sunIntensity = isDay ? Math.max(0, Math.sin(sunAngle)) * 3.0 : 0;
  const ambientIntensity = isDay ? 0.5 + Math.sin(sunAngle) * 1.0 : 0.2;
  
  // Sky color lerp based on time
  const skyColor = new THREE.Color();
  if (isDay) {
    skyColor.lerpColors(new THREE.Color("#ff8844"), new THREE.Color("#88ccff"), Math.sin(sunAngle)); // Sunrise/Sunset to Noon
  } else {
    skyColor.set("#020410"); // Night
  }

  return (
    <>
      <color attach="background" args={[skyColor.getStyle()]} />
      <ambientLight intensity={ambientIntensity} />
      <directionalLight position={[sunX, sunY, 15]} intensity={sunIntensity} color="#ffffff" />
      <pointLight position={[-10, 5, -10]} intensity={isDay ? 0.5 : 1.5} color={isDay ? "#ffffff" : "#00aaff"} />
      <hemisphereLight skyColor={skyColor.getStyle()} groundColor={isDay ? "#0044ff" : "#000510"} intensity={isDay ? 0.5 : 0.1} />
    </>
  );
};

const Scene = () => {
  const controlsRef = useRef();

  return (
    <div className="w-full h-full cursor-grab active:cursor-grabbing">
      <Canvas camera={{ position: [25, 20, 25], fov: 45 }}>
        <EnvironmentLighting />
        
        <Environment preset="city" />
        
        <CityContext />
        <Building />
        <RoofChiller />
        <CameraRig controlsRef={controlsRef} />
        <PresentationDirector />
        
        {/* Soft Shadow Base - frames={1} is CRITICAL for performance to prevent re-rendering shadows every frame */}
        <ContactShadows position={[0, -0.01, 0]} opacity={0.5} scale={50} blur={2.5} far={10} color="#00ffff" frames={1} resolution={512} />
        
        <Grid 
          infiniteGrid 
          fadeDistance={100} 
          sectionColor="#0066ff" 
          cellColor="#001133" 
          position={[0, -0.05, 0]} 
        />
        
        <EffectComposer disableNormalPass>
          <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.9} height={300} intensity={2.0} mipmapBlur />
        </EffectComposer>
        
        <OrbitControls 
          ref={controlsRef}
          enablePan={true} 
          enableZoom={true} 
          enableRotate={true}
          maxPolarAngle={Math.PI / 2 - 0.05}
          target={[0, 15, 0]}
        />
      </Canvas>
    </div>
  );
};

export default Scene;
