import React, { useRef, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html, Environment, ContactShadows, MeshReflectorMaterial } from '@react-three/drei';
import { EffectComposer, Bloom, N8AO, Vignette, ChromaticAberration, HueSaturation } from '@react-three/postprocessing';
import * as THREE from 'three';
import useTwinStore from '../store/useTwinStore';
import Drone from './Drone';
import WeatherSystem from './WeatherSystem';
import UndergroundParking from './UndergroundParking';
import { BuildingEdgeOverlay, GlowingEdges } from './GlowingEdges';
import HeatmapOverlay from './HeatmapOverlay';
import ParticleFlow from './ParticleFlow';
import CityTraffic from './CityTraffic';
import StreetLights from './StreetLights';

// ═══════════════════════════════════════════════════════════════
//  FLOOR — Enhanced with PBR glass, neon edges, interior detail
// ═══════════════════════════════════════════════════════════════
const Floor = ({ position, floorData, selected, isIsolated, onClick }) => {
  const meshRef = useRef();
  const viewMode = useTwinStore(state => state.viewMode);
  
  const alerts = floorData.rooms?.[0]?.alerts || [];
  const hasCritical = alerts.some(a => a.severity === 'CRITICAL');
  const hasWarning = alerts.some(a => a.severity === 'WARNING');

  const ghostMatRefs = useRef([]);
  const alertMatRefs = useRef([]);
  
  const itLoad = floorData.rooms?.[0]?.sensors?.itLoad?.currentValue || 0;
  const energyColor = itLoad > 60 ? "#ff2200" : (itLoad > 30 ? "#ffaa00" : "#00ff00");
  const hvacEff = floorData.rooms?.[0]?.assets?.hvac?.health || 0;
  
  const isSecurityMode = viewMode === 'SECURITY';
  const isFireMode = viewMode === 'FIRE';
  const isFireAlarm = floorData.rooms?.[0]?.sensors?.fireSafety?.isAlarmActive;
  const isHVAC = viewMode === 'HVAC';

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
    
    // Check if this floor has an AI anomaly
    const aiInsights = useTwinStore.getState().aiInsights || [];
    const hasAIAnomaly = aiInsights.some(insight => {
      // insight.target.object is like "urn:ngsi-ld:IoTDevice:Env-101"
      const targetId = insight.target?.object || '';
      return floorData.rooms?.some(room => room.devices?.some(d => d.id === targetId));
    });

    if (isFireAlarm || hasCritical) {
      pulseOpacity = (Math.sin(time * 8) + 1) / 2;
      pulseColor = new THREE.Color("#ff0000");
    } else if (hasAIAnomaly) {
      pulseOpacity = (Math.sin(time * 4) + 1) / 2;
      pulseColor = new THREE.Color("#ff00ff"); // AI Anomaly color
    } else if (hasWarning) {
      pulseOpacity = (Math.sin(time * 2) + 1) / 2;
      pulseColor = new THREE.Color("#ff8800");
    }

    // Opacity Animation (Ghost mode)
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

    // Alert pulsing
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
             mat.emissiveIntensity = 1 + pulseOpacity * 4.0;
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
    addGhostMat(mat);
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
        {/* ── Floor Slab ─────────────────────────────── */}
        <mesh position={[0, 0, 0]} receiveShadow>
          <boxGeometry args={[10, 0.25, 10]} />
          <meshPhysicalMaterial 
            ref={addAlertMat}
            color={selected ? "#00e5ff" : "#e2e8f0"}
            metalness={0.15} roughness={0.7}
            transparent opacity={isHVAC ? 0.15 : 1.0}
            wireframe={isHVAC}
          />
        </mesh>
        
        {/* ── Floor Edge Trim (ArcGIS neon line per slab) ── */}
        <mesh position={[0, 0.13, 0]}>
          <boxGeometry args={[10.1, 0.02, 10.1]} />
          <meshBasicMaterial 
            ref={addGhostMat}
            color={selected ? "#00ffff" : "#334155"} 
            transparent 
            opacity={selected ? 0.9 : 0.3}
            toneMapped={false}
          />
        </mesh>
        
        {/* ── Structural Columns (sleeker design) ─── */}
        {[-4.5, -1.5, 1.5, 4.5].map(x => 
          [-4.5, 4.5].map(z => (
            <mesh key={`col-${x}-${z}`} position={[x, 1.1, z]}>
              <boxGeometry args={[0.2, 2.2, 0.2]} />
              <meshStandardMaterial ref={addGhostMat} color="#64748b" metalness={0.6} roughness={0.3} transparent opacity={isHVAC ? 0.1 : 1} />
            </mesh>
          ))
        )}

        {/* ── HVAC Main Ducts ────────────────────── */}
        <mesh position={[0, 2.0, 2]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.22, 0.22, 9, 16]} />
          <meshStandardMaterial 
            ref={addGhostMat} 
            color={isHVAC ? "#00ffff" : "#94a3b8"} 
            emissive={isHVAC ? "#00aaff" : "#000000"}
            emissiveIntensity={isHVAC ? 3 : 0}
            metalness={0.8} roughness={0.2} 
          />
        </mesh>
        <mesh position={[2, 2.0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 9, 16]} />
          <meshStandardMaterial 
            ref={addGhostMat} 
            color={isHVAC ? "#00ffff" : "#94a3b8"} 
            emissive={isHVAC ? "#00aaff" : "#000000"}
            emissiveIntensity={isHVAC ? 3 : 0}
            metalness={0.8} roughness={0.2} 
          />
        </mesh>
        
        {/* ── HVAC Branch Pipes ──────────────────── */}
        {isHVAC && (
          <group>
            {[-3, 0, 3].map(offset => (
              <mesh key={`branch-${offset}`} position={[offset, 1.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.08, 0.08, 8, 8]} />
                <meshStandardMaterial 
                  color="#00ddff" 
                  emissive="#0088ff"
                  emissiveIntensity={2}
                  metalness={0.8} roughness={0.2}
                  transparent opacity={0.7}
                />
              </mesh>
            ))}
          </group>
        )}

        {/* ── Electrical Conduits ─────────────────── */}
        {!['HVAC', 'SECURITY', 'FIRE'].includes(viewMode) && (
          <mesh position={[-1, 1.9, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 9.5, 8]} />
            <meshBasicMaterial ref={addGhostMat} color={viewMode === 'ENERGY' ? "#ffff00" : (selected ? "#ffaa00" : "#fb923c")} />
          </mesh>
        )}
        
        {/* ── Server Racks (Enhanced) ──────────────── */}
        {!['HVAC', 'SECURITY', 'FIRE'].includes(viewMode) && (
          <group>
            {/* Server rack 1 */}
            <mesh position={[-3, 0.65, -3]}>
              <boxGeometry args={[1.2, 1.3, 0.8]} />
              <meshStandardMaterial 
                ref={addGhostMat} 
                color={viewMode === 'ENERGY' ? energyColor : "#1e293b"} 
                emissive={viewMode === 'ENERGY' ? energyColor : "#000000"} 
                emissiveIntensity={viewMode === 'ENERGY' ? 2.5 : 0} 
                metalness={0.9} roughness={0.1} 
              />
            </mesh>
            {/* Server LED strip */}
            <mesh position={[-2.35, 0.8, -3]}>
               <boxGeometry args={[0.04, 0.8, 0.6]} />
               <meshStandardMaterial 
                 ref={addGhostMat} 
                 color={selected ? "#00ff00" : "#22c55e"} 
                 emissive={selected ? "#00ff00" : "#22c55e"} 
                 emissiveIntensity={2.5} 
               />
            </mesh>
            {/* Server rack 2 */}
            <mesh position={[-3, 0.65, -1.8]}>
              <boxGeometry args={[1.2, 1.3, 0.8]} />
              <meshStandardMaterial 
                ref={addGhostMat} 
                color={viewMode === 'ENERGY' ? energyColor : "#0f172a"} 
                emissive={viewMode === 'ENERGY' ? energyColor : "#000000"} 
                emissiveIntensity={viewMode === 'ENERGY' ? 2 : 0} 
                metalness={0.9} roughness={0.1} 
              />
            </mesh>
          </group>
        )}
        
        {/* ── Interior Details (desks, visible when selected) ─── */}
        {selected && !['HVAC', 'FIRE'].includes(viewMode) && (
          <group>
            {/* Desk row 1 */}
            {[1, 2.5, 4].map(x => (
              <group key={`desk-${x}`}>
                <mesh position={[x, 0.5, -2]}>
                  <boxGeometry args={[1, 0.05, 0.6]} />
                  <meshStandardMaterial color="#64748b" metalness={0.3} roughness={0.6} />
                </mesh>
                {/* Monitor */}
                <mesh position={[x, 0.7, -2.15]}>
                  <boxGeometry args={[0.5, 0.35, 0.02]} />
                  <meshStandardMaterial color="#0f172a" emissive="#1e40af" emissiveIntensity={0.5} />
                </mesh>
              </group>
            ))}
            {/* Desk row 2 */}
            {[1, 2.5, 4].map(x => (
              <group key={`desk2-${x}`}>
                <mesh position={[x, 0.5, 2]}>
                  <boxGeometry args={[1, 0.05, 0.6]} />
                  <meshStandardMaterial color="#64748b" metalness={0.3} roughness={0.6} />
                </mesh>
                <mesh position={[x, 0.7, 2.15]}>
                  <boxGeometry args={[0.5, 0.35, 0.02]} />
                  <meshStandardMaterial color="#0f172a" emissive="#1e40af" emissiveIntensity={0.5} />
                </mesh>
              </group>
            ))}
          </group>
        )}

        {/* ── Security Cameras ─────────────────────── */}
        {[-4.5, 4.5].map(x => 
          [-4.5, 4.5].map(z => (
            <group key={`cam-${x}-${z}`} position={[x, 2.0, z]}>
              <mesh rotation={[Math.PI / 4, x > 0 ? -Math.PI/4 : Math.PI/4, 0]}>
                <boxGeometry args={[0.2, 0.1, 0.3]} />
                <meshStandardMaterial 
                  ref={addGhostMat} 
                  color={isSecurityMode ? "#ff00ff" : "#333333"} 
                  emissive={isSecurityMode ? "#ff00ff" : "#000000"} 
                  emissiveIntensity={isSecurityMode ? 2.5 : 0} 
                />
              </mesh>
              {/* Camera FOV indicator in Security mode */}
              {isSecurityMode && (
                <mesh position={[x > 0 ? -1 : 1, -0.5, z > 0 ? -1 : 1]}>
                  <coneGeometry args={[1.5, 2, 4, 1, true]} />
                  <meshBasicMaterial color="#ff00ff" transparent opacity={0.05} side={THREE.DoubleSide} depthWrite={false} />
                </mesh>
              )}
            </group>
          ))
        )}

        {/* ── Smoke Detectors ──────────────────────── */}
        {[[-2, -2], [2, 2], [-2, 2], [2, -2]].map((pos, idx) => (
          <mesh key={`smoke-${idx}`} position={[pos[0], 2.1, pos[1]]}>
            <cylinderGeometry args={[0.15, 0.15, 0.05, 16]} />
            <meshStandardMaterial 
              ref={addAlertMat} 
              color={isFireMode || isFireAlarm ? "#ff0000" : "#ffffff"} 
              emissive={isFireAlarm ? "#ff0000" : "#000000"} 
              emissiveIntensity={isFireAlarm ? 4 : 0} 
            />
          </mesh>
        ))}

        {/* ── Evacuation Routes ────────────────────── */}
        {(isFireMode || isFireAlarm) && (
          <group position={[0, 0.14, 0]}>
            {[[-2.5, 0], [2.5, 0]].map(([x, z], i) => (
              <mesh key={`evac-h-${i}`} position={[x, 0, z]}>
                <boxGeometry args={[4, 0.02, 0.5]} />
                <meshBasicMaterial ref={addAlertMat} color="#00ff00" transparent opacity={0.6} />
              </mesh>
            ))}
            {[[0, -2.5], [0, 2.5]].map(([x, z], i) => (
              <mesh key={`evac-v-${i}`} position={[x, 0, z]}>
                <boxGeometry args={[0.5, 0.02, 4]} />
                <meshBasicMaterial ref={addAlertMat} color="#00ff00" transparent opacity={0.6} />
              </mesh>
            ))}
            {/* EXIT signs */}
            {[[4.8, 1.5, 0], [-4.8, 1.5, 0], [0, 1.5, 4.8], [0, 1.5, -4.8]].map(([x, y, z], i) => (
              <mesh key={`exit-${i}`} position={[x, y, z]}>
                <boxGeometry args={[0.6, 0.3, 0.05]} />
                <meshBasicMaterial color="#00ff00" emissive="#00ff00" toneMapped={false} />
              </mesh>
            ))}
          </group>
        )}

        {/* ── Glass Facade (Enhanced PBR) ──────────── */}
        {viewMode === 'NORMAL' && (
          <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
            <boxGeometry args={[10.2, 2.2, 10.2]} />
            <meshPhysicalMaterial 
              ref={addAlertMat}
              color="#88ccff"
              emissive="#001133"
              emissiveIntensity={0.2}
              metalness={0.95}
              roughness={0.02}
              envMapIntensity={3}
              transparent
              opacity={0.12}
              clearcoat={1}
              clearcoatRoughness={0}
              ior={1.5}
              reflectivity={1}
            />
          </mesh>
        )}

        {/* ── Window Mullion Grid (visible on selected floors) ─── */}
        {(selected || viewMode === 'NORMAL') && !isHVAC && (
          <group>
            {/* Horizontal mullions */}
            {[0.5, 1.1, 1.7].map(y => (
              <mesh key={`mullion-h-${y}`} position={[0, y, 5.11]}>
                <boxGeometry args={[10.2, 0.03, 0.02]} />
                <meshStandardMaterial ref={addGhostMat} color="#334155" metalness={0.8} roughness={0.3} transparent opacity={0.6} />
              </mesh>
            ))}
            {/* Vertical mullions on front face */}
            {[-4, -2, 0, 2, 4].map(x => (
              <mesh key={`mullion-v-${x}`} position={[x, 1.1, 5.11]}>
                <boxGeometry args={[0.03, 2.2, 0.02]} />
                <meshStandardMaterial ref={addGhostMat} color="#334155" metalness={0.8} roughness={0.3} transparent opacity={0.6} />
              </mesh>
            ))}
          </group>
        )}
      </group>
      
      {/* Label for selected floor */}
      {selected && (
        <Html position={[8, 1, 8]} center zIndexRange={[100, 0]}>
          <div className="bg-black/80 text-cyan-400 px-4 py-2 rounded-lg border border-cyan-500/50 backdrop-blur-md whitespace-nowrap shadow-[0_0_15px_rgba(0,255,255,0.3)] pointer-events-none">
            <div className="font-bold">{floorData.name}</div>
            <div className="text-xs text-yellow-400">MEP Active | {floorData.id.slice(0, 8)}</div>
          </div>
        </Html>
      )}

      {/* Neon edge for selected floor */}
      {selected && (
        <GlowingEdges
          position={[0, 1.1, 0]}
          color="#00ffff"
          opacity={0.9}
          pulse
        />
      )}

      {/* Occupancy */}
      <People floorData={floorData} isIsolated={isIsolated} selected={selected} />
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  PEOPLE — Instanced occupants with evacuation pathfinding
// ═══════════════════════════════════════════════════════════════
const dummy = new THREE.Object3D();
const People = ({ floorData, isIsolated, selected }) => {
  const meshRef = useRef();
  const viewMode = useTwinStore(state => state.viewMode);
  
  const isFireAlarm = floorData.rooms?.[0]?.sensors?.fireSafety?.isAlarmActive;
  const isFireMode = viewMode === 'FIRE';
  const count = 25;
  
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
      if (isFireAlarm || isFireMode) {
        const dx = 0 - agent.x;
        const dz = 0 - agent.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        if (dist > 0.8) {
          agent.vx = (dx / dist) * 1.5;
          agent.vz = (dz / dist) * 1.5;
        } else {
          agent.vx = 0; agent.vz = 0;
        }
      } else {
        if (Math.random() < 0.05) {
          agent.vx += (Math.random() - 0.5) * 1.0;
          agent.vz += (Math.random() - 0.5) * 1.0;
        }
        const speed = Math.sqrt(agent.vx*agent.vx + agent.vz*agent.vz);
        if (speed > 0.4) {
          agent.vx = (agent.vx / speed) * 0.4;
          agent.vz = (agent.vz / speed) * 0.4;
        }
      }
      
      if (agent.x < -4.5 || agent.x > 4.5) agent.vx *= -1;
      if (agent.z < -4.5 || agent.z > 4.5) agent.vz *= -1;
      
      agent.x += agent.vx * delta;
      agent.z += agent.vz * delta;

      dummy.position.set(agent.x, 0.25, agent.z);
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

// ═══════════════════════════════════════════════════════════════
//  ELEVATOR SYSTEM
// ═══════════════════════════════════════════════════════════════
const ElevatorSystem = () => {
  const elevators = useTwinStore((state) => state.building.elevators);
  const selectedFloorId = useTwinStore((state) => state.selectedFloorId);
  const isIsolated = selectedFloorId !== null;

  const positions = [
    [-1, 0, 0],
    [1, 0, -1],
    [1, 0, 1]
  ];

  return (
    <group>
      {elevators.map((elv, i) => {
        const yPos = elv.currentFloor * 2.2 + 1.1; 
        const isMoving = elv.status !== 'IDLE';
        
        return (
          <group key={elv.id}>
            <mesh position={[positions[i][0], yPos, positions[i][2]]}>
              <boxGeometry args={[1.2, 2.0, 1.2]} />
              <meshStandardMaterial 
                color={isMoving ? "#00aaff" : "#64748b"} 
                emissive={isMoving ? "#00aaff" : "#000000"}
                emissiveIntensity={isMoving ? 1.5 : 0}
                metalness={0.8} 
                roughness={0.2}
                transparent 
                opacity={isIsolated ? 0.15 : 0.9}
              />
            </mesh>
            {/* Elevator cable */}
            {!isIsolated && (
              <mesh position={[positions[i][0], yPos + 10, positions[i][2]]}>
                <cylinderGeometry args={[0.02, 0.02, 20, 4]} />
                <meshBasicMaterial color="#475569" transparent opacity={0.4} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  BUILDING — Main building assembly
// ═══════════════════════════════════════════════════════════════
const Building = () => {
  const building = useTwinStore((state) => state.building);
  const selectedFloorId = useTwinStore((state) => state.selectedFloorId);
  const setSelectedFloorId = useTwinStore((state) => state.setSelectedFloorId);
  const sabotageMode = useTwinStore((state) => state.sabotageMode);
  const triggerSabotageAction = useTwinStore((state) => state.triggerSabotageAction);
  const viewMode = useTwinStore((state) => state.viewMode);
  
  const floorCount = building.floors.length;
  const isIsolated = selectedFloorId !== null;

  return (
    <group>
      {/* Core elevator shaft */}
      <mesh position={[0, (floorCount * 2.2) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[4, floorCount * 2.2 + 2, 4]} />
        <meshStandardMaterial 
          color="#0f172a" metalness={0.7} roughness={0.2} 
          transparent opacity={isIsolated ? 0.04 : 0.35}
        />
      </mesh>
      
      {/* Shaft internal structure lines */}
      {!isIsolated && (
        <GlowingEdges
          position={[0, (floorCount * 2.2) / 2, 0]}
          width={4.1}
          height={floorCount * 2.2 + 2.1}
          depth={4.1}
          color="#1e40af"
          opacity={0.2}
        />
      )}
      
      <ElevatorSystem />
      
      {/* Building Edge Overlay (ArcGIS style) */}
      <BuildingEdgeOverlay 
        floorCount={floorCount} 
        isIsolated={isIsolated}
        selectedFloorId={selectedFloorId}
        viewMode={viewMode}
      />
      
      {/* Floors */}
      {building.floors.map((floor, i) => (
        <Floor 
          key={floor.id} 
          floorData={floor}
          position={[0, i * 2.2 + 1.1, 0]} 
          selected={selectedFloorId === floor.id}
          isIsolated={isIsolated}
          onClick={(id) => {
            if (sabotageMode) {
              const types = ['FIRE', 'HVAC_LEAK', 'WINDOW_BREAK'];
              const type = types[Math.floor(Math.random() * types.length)];
              triggerSabotageAction(type, id);
            } else {
              setSelectedFloorId(id === selectedFloorId ? null : id);
            }
          }}
        />
      ))}
    </group>
  );
}

// ═══════════════════════════════════════════════════════════════
//  CAMERA RIG — Auto-follow and presentation mode
// ═══════════════════════════════════════════════════════════════
const CameraRig = ({ controlsRef }) => {
  const selectedFloorId = useTwinStore((state) => state.selectedFloorId);
  const building = useTwinStore((state) => state.building);
  const presentationMode = useTwinStore((state) => state.presentationMode);

  useFrame((state, delta) => {
    if (!controlsRef.current) return;

    if (selectedFloorId) {
      const floorIndex = building.floors.findIndex(f => f.id === selectedFloorId);
      const targetY = floorIndex * 2.2 + 1.1;
      state.camera.position.lerp(new THREE.Vector3(15, targetY + 8, 15), delta * 3);
      controlsRef.current.target.lerp(new THREE.Vector3(0, targetY, 0), delta * 3);
    } else if (presentationMode) {
      const time = state.clock.getElapsedTime();
      const radius = 35;
      const speed = 0.1;
      const x = Math.sin(time * speed) * radius;
      const z = Math.cos(time * speed) * radius;
      state.camera.position.lerp(new THREE.Vector3(x, 20, z), delta * 2);
      controlsRef.current.target.lerp(new THREE.Vector3(0, 15, 0), delta * 2);
    }
  });

  return null;
}

// ═══════════════════════════════════════════════════════════════
//  PRESENTATION DIRECTOR
// ═══════════════════════════════════════════════════════════════
const PresentationDirector = () => {
  const presentationMode = useTwinStore(state => state.presentationMode);
  const building = useTwinStore(state => state.building);
  const setSelectedFloorId = useTwinStore(state => state.setSelectedFloorId);
  const setViewMode = useTwinStore(state => state.setViewMode);
  const triggerScenario = useTwinStore(state => state.triggerScenario);

  const floorsRef = useRef(building?.floors || []);
  useEffect(() => {
    if (building?.floors?.length > 0) {
      floorsRef.current = building.floors;
    }
  }, [building]);

  useEffect(() => {
    if (!presentationMode) return;

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
          if (floorsRef.current.length > 0) setSelectedFloorId(floorsRef.current[0].id);
          break;
        case 2: setViewMode('ENERGY'); break;
        case 3: setViewMode('HVAC'); break;
        case 4: setSelectedFloorId(null); break;
        case 5: triggerScenario('HVAC_FAILURE'); break;
        case 6: setViewMode('ENERGY'); break;
      }
    }, 6000);

    return () => {
      clearInterval(interval);
      setSelectedFloorId(null);
      setViewMode('NORMAL');
      triggerScenario(null);
    };
  }, [presentationMode, setSelectedFloorId, setViewMode, triggerScenario]);

  return null;
}

// ═══════════════════════════════════════════════════════════════
//  ROOF CHILLER — Enhanced with helipad, antennas, solar
// ═══════════════════════════════════════════════════════════════
const RoofChiller = () => {
  const floorCount = useTwinStore((state) => state.building?.floors.length || 0);
  const viewMode = useTwinStore((state) => state.viewMode);
  const isIsolated = useTwinStore((state) => state.selectedFloorId !== null);
  
  if (isIsolated || !floorCount) return null;
  
  const roofY = floorCount * 2.2 + 0.5;
  const isHVAC = viewMode === 'HVAC';
  
  return (
    <group position={[0, roofY, 0]}>
      {/* Roof slab */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[10.2, 0.3, 10.2]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} />
      </mesh>
      
      {/* Chiller Units */}
      {[-2, 2].map((x, i) => (
        <group key={`chiller-${i}`} position={[x, 0, -2]}>
          <mesh position={[0, 1, 0]}>
            <boxGeometry args={[2.5, 1.5, 3]} />
            <meshStandardMaterial color={isHVAC ? "#00ffff" : "#475569"} emissive={isHVAC ? "#00aaff" : "#000000"} emissiveIntensity={isHVAC ? 1 : 0} metalness={0.6} roughness={0.4} />
          </mesh>
          {/* Fan grills */}
          {[-0.7, 0.7].map((z, fi) => (
            <mesh key={`fan-${fi}`} position={[0, 1.76, z]} rotation={[Math.PI/2, 0, 0]}>
              <cylinderGeometry args={[0.5, 0.5, 0.1, 16]} />
              <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
            </mesh>
          ))}
        </group>
      ))}
      
      {/* Helipad */}
      <group position={[0, 0.16, 2.5]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[2.5, 32]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} />
        </mesh>
        {/* H marking */}
        <mesh position={[-0.4, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.2, 2]} />
          <meshBasicMaterial color="#fbbf24" toneMapped={false} />
        </mesh>
        <mesh position={[0.4, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.2, 2]} />
          <meshBasicMaterial color="#fbbf24" toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[1, 0.2]} />
          <meshBasicMaterial color="#fbbf24" toneMapped={false} />
        </mesh>
        {/* Landing circle */}
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.2, 2.3, 32]} />
          <meshBasicMaterial color="#fbbf24" transparent opacity={0.8} toneMapped={false} />
        </mesh>
      </group>
      
      {/* Communication Antennas */}
      <group position={[4, 0, 4]}>
        <mesh position={[0, 2, 0]}>
          <cylinderGeometry args={[0.05, 0.05, 4, 4]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.9} roughness={0.1} />
        </mesh>
        {/* Antenna dishes */}
        {[1, 2, 3].map(y => (
          <mesh key={`dish-${y}`} position={[0.2, y, 0]} rotation={[0, 0, -Math.PI / 4]}>
            <boxGeometry args={[0.4, 0.05, 0.3]} />
            <meshStandardMaterial color="#64748b" />
          </mesh>
        ))}
        {/* Blinking red light */}
        <mesh position={[0, 4.1, 0]}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color="#ff0000" toneMapped={false} />
        </mesh>
      </group>
      
      {/* Solar Panels */}
      <group position={[-4, 0.3, 3]}>
        {[0, 1.2, 2.4].map((z, i) => (
          <mesh key={`solar-${i}`} position={[0, 0.3, z - 1]} rotation={[-Math.PI / 6, 0, 0]}>
            <boxGeometry args={[2, 0.05, 1]} />
            <meshPhysicalMaterial 
              color="#1e3a5f" 
              metalness={0.8} 
              roughness={0.1}
              clearcoat={1}
              clearcoatRoughness={0.1}
            />
          </mesh>
        ))}
      </group>
      
      {/* Descending HVAC pipe */}
      {isHVAC && (
        <mesh position={[0, -0.5, -2.5]}>
          <cylinderGeometry args={[0.4, 0.4, 2, 16]} />
          <meshStandardMaterial color="#00ffff" emissive="#00aaff" emissiveIntensity={3} metalness={0.8} roughness={0.2} />
        </mesh>
      )}
    </group>
  );
};

// ═══════════════════════════════════════════════════════════════
//  CITY CONTEXT — Diverse urban environment
// ═══════════════════════════════════════════════════════════════
const CityContext = () => {
  const timeOfDay = useTwinStore(state => state.building?.timeOfDay) || 12;
  const isNight = timeOfDay < 6 || timeOfDay > 18;
  
  const buildings = React.useMemo(() => {
    const blocks = [];
    const buildingTypes = [
      { minH: 3, maxH: 8, color: '#0f172a', emissive: '#020617' },     // Low residential
      { minH: 8, maxH: 20, color: '#1e1b4b', emissive: '#0c0a2e' },    // Mid-rise office
      { minH: 15, maxH: 35, color: '#0c4a6e', emissive: '#082f49' },    // High-rise glass
      { minH: 5, maxH: 12, color: '#1c1917', emissive: '#0c0a09' },     // Commercial
    ];
    
    for (let i = 0; i < 55; i++) {
      const x = (Math.random() - 0.5) * 180;
      const z = (Math.random() - 0.5) * 180;
      if (Math.abs(x) < 18 && Math.abs(z) < 18) continue;
      
      const type = buildingTypes[Math.floor(Math.random() * buildingTypes.length)];
      const height = type.minH + Math.random() * (type.maxH - type.minH);
      const width = 3 + Math.random() * 8;
      const depth = 3 + Math.random() * 8;
      
      blocks.push({ x, z, width, height, depth, ...type });
    }
    return blocks;
  }, []);

  // Trees
  const trees = React.useMemo(() => {
    const t = [];
    for (let i = 0; i < 80; i++) {
      const x = (Math.random() - 0.5) * 160;
      const z = (Math.random() - 0.5) * 160;
      if (Math.abs(x) < 16 && Math.abs(z) < 16) continue;
      // Place trees near roads (every ~20 units)
      const nearRoad = (Math.abs(x) % 20 < 4) || (Math.abs(z) % 20 < 4);
      if (!nearRoad && Math.random() > 0.3) continue;
      
      t.push({ x, z, height: 2 + Math.random() * 3, radius: 1 + Math.random() * 1.5 });
    }
    return t;
  }, []);

  return (
    <group>
      {/* Ground Plane */}
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[300, 300]} />
        <MeshReflectorMaterial
          blur={[100, 50]}
          resolution={512}
          mixBlur={1}
          mixStrength={5}
          roughness={0.8}
          color="#080812"
          metalness={0.2}
        />
      </mesh>
      
      {/* Central Plaza */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[30, 0.15, 30]} />
        <meshStandardMaterial color="#111827" roughness={0.8} metalness={0.1} />
      </mesh>
      
      {/* Roads — Main Grid */}
      {[-60, -40, -20, 20, 40, 60].map(pos => (
        <React.Fragment key={`road-${pos}`}>
          {/* Horizontal road */}
          <mesh position={[0, 0.01, pos]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[300, 8]} />
            <meshStandardMaterial color="#0a0a15" roughness={0.85} />
          </mesh>
          {/* Road center line */}
          <mesh position={[0, 0.02, pos]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[300, 0.15]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.3} />
          </mesh>
          {/* Vertical road */}
          <mesh position={[pos, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[8, 300]} />
            <meshStandardMaterial color="#0a0a15" roughness={0.85} />
          </mesh>
          <mesh position={[pos, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.15, 300]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.3} />
          </mesh>
        </React.Fragment>
      ))}
      
      {/* Sidewalks next to main building */}
      {[[-15.5, 0], [15.5, 0], [0, -15.5], [0, 15.5]].map(([x, z], i) => (
        <mesh key={`sidewalk-${i}`} position={[x, 0.05, z]} receiveShadow>
          <boxGeometry args={[x === 0 ? 30 : 1, 0.1, z === 0 ? 30 : 1]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} />
        </mesh>
      ))}

      {/* Neighboring Buildings */}
      {buildings.map((b, i) => (
        <group key={i}>
          <mesh position={[b.x, b.height / 2, b.z]} castShadow receiveShadow>
            <boxGeometry args={[b.width, b.height, b.depth]} />
            <meshPhysicalMaterial 
              color={b.color} 
              metalness={0.9} 
              roughness={0.15}
              emissive={isNight ? b.emissive : '#000000'}
              emissiveIntensity={isNight ? 1 : 0}
              clearcoat={1.0}
              clearcoatRoughness={0.1}
              envMapIntensity={2.0}
            />
          </mesh>
          {/* Window lights at night */}
          {isNight && b.height > 10 && (
            <mesh position={[b.x, b.height / 2, b.z + b.depth / 2 + 0.01]}>
              <planeGeometry args={[b.width * 0.9, b.height * 0.9]} />
              <meshBasicMaterial 
                color="#fcd34d" 
                transparent 
                opacity={0.08 + Math.random() * 0.05}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
      ))}

      {/* Trees */}
      {trees.map((tree, i) => (
        <group key={`tree-${i}`} position={[tree.x, 0, tree.z]}>
          {/* Trunk */}
          <mesh position={[0, tree.height * 0.3, 0]}>
            <cylinderGeometry args={[0.1, 0.15, tree.height * 0.6, 6]} />
            <meshStandardMaterial color="#3f2d20" roughness={0.9} />
          </mesh>
          {/* Canopy */}
          <mesh position={[0, tree.height * 0.7, 0]}>
            <sphereGeometry args={[tree.radius, 8, 8]} />
            <meshStandardMaterial 
              color={isNight ? "#0a2e1a" : "#166534"} 
              roughness={0.9}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// ═══════════════════════════════════════════════════════════════
//  ENVIRONMENT LIGHTING — Day/Night cycle with weather
// ═══════════════════════════════════════════════════════════════
const EnvironmentLighting = () => {
  const timeOfDay = useTwinStore(state => state.building?.timeOfDay) || 12;
  const weather = useTwinStore(state => state.weather);
  
  const isDay = timeOfDay > 6 && timeOfDay < 18;
  const sunAngle = ((timeOfDay - 6) / 12) * Math.PI;
  const isRaining = weather?.isRaining;
  
  const sunX = Math.cos(sunAngle) * 30;
  const sunY = Math.sin(sunAngle) * 30;
  
  let sunIntensity = isDay ? Math.max(0, Math.sin(sunAngle)) * 3.0 : 0;
  let ambientIntensity = isDay ? 0.5 + Math.sin(sunAngle) * 1.0 : 0.15;
  
  const skyColor = new THREE.Color();
  if (isDay) {
    skyColor.lerpColors(new THREE.Color("#ff8844"), new THREE.Color("#88ccff"), Math.sin(sunAngle));
  } else {
    skyColor.set("#010208");
  }

  if (isRaining) {
    skyColor.lerp(new THREE.Color("#2a3b4c"), 0.8);
    sunIntensity *= 0.2;
    ambientIntensity = 0.4;
  }

  return (
    <>
      <color attach="background" args={[skyColor.getStyle()]} />
      {isRaining ? <fog attach="fog" args={[skyColor.getStyle(), 20, 150]} /> : null}
      {!isDay && !isRaining && <fog attach="fog" args={['#010208', 80, 250]} />}
      <ambientLight intensity={ambientIntensity} />
      
      <directionalLight 
        position={[sunX, sunY, 15]} 
        intensity={sunIntensity} 
        color="#ffffff" 
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.1}
        shadow-camera-far={100}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      
      <pointLight position={[-10, 5, -10]} intensity={isDay && !isRaining ? 0.5 : 1.5} color={isDay && !isRaining ? "#ffffff" : "#00aaff"} />
      <hemisphereLight skyColor={skyColor.getStyle()} groundColor={isDay ? "#0044ff" : "#000510"} intensity={isDay ? 0.5 : 0.08} />
    </>
  );
};

// ═══════════════════════════════════════════════════════════════
//  SCENE — Main 3D canvas
// ═══════════════════════════════════════════════════════════════
const Scene = () => {
  const controlsRef = useRef();

  return (
    <div className="w-full h-full cursor-grab active:cursor-grabbing">
      <Canvas shadows camera={{ position: [30, 22, 30], fov: 42 }} gl={{ antialias: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }} dpr={[1, 1.5]}>
        <EnvironmentLighting />
        
        <Environment preset="city" background={false} />
        
        <CityContext />
        <UndergroundParking />
        <Building />
        <RoofChiller />
        <HeatmapOverlay />
        <ParticleFlow />
        <CityTraffic />
        <StreetLights />
        <Drone />
        <WeatherSystem />
        <CameraRig controlsRef={controlsRef} />
        <PresentationDirector />
        
        <ContactShadows position={[0, -0.01, 0]} opacity={0.5} scale={50} blur={2.5} far={10} color="#00ffff" frames={1} resolution={512} />
        
        <Grid 
          infiniteGrid 
          fadeDistance={120} 
          sectionColor="#0066ff" 
          cellColor="#000d22" 
          position={[0, -0.05, 0]} 
          sectionSize={10}
          cellSize={2}
        />
        
        <EffectComposer disableNormalPass multisampling={4}>
          <N8AO aoRadius={3} intensity={1.5} />
          <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} height={300} intensity={2.0} mipmapBlur />
          <ChromaticAberration 
            offset={[0.0015, 0.0015]} 
            radialModulation={true} 
            modulationOffset={0.5} 
          />
          <HueSaturation hue={0} saturation={0.25} />
          <Vignette eskil={false} offset={0.1} darkness={1.2} />
        </EffectComposer>
        
        <OrbitControls 
          ref={controlsRef}
          enablePan={true} 
          enableZoom={true} 
          enableRotate={true}
          maxPolarAngle={Math.PI / 2 - 0.05}
          minDistance={5}
          maxDistance={150}
          target={[0, 15, 0]}
        />
      </Canvas>
    </div>
  );
};

export default Scene;
