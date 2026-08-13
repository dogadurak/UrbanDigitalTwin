import React, { useMemo } from 'react';
import * as THREE from 'three';
import useTwinStore from '../store/useTwinStore';

/**
 * StreetLights — positioned along roads, auto-activate at night.
 * Each lamp has a pole, lamp head, and a point light (at night).
 */
const StreetLights = () => {
  const timeOfDay = useTwinStore(state => state.building?.timeOfDay) || 12;
  const isNight = timeOfDay < 6 || timeOfDay > 19;
  const isDusk = (timeOfDay >= 17 && timeOfDay < 19) || (timeOfDay >= 5 && timeOfDay < 7);
  
  const lightIntensity = isNight ? 3 : (isDusk ? 1.5 : 0);
  const emissiveIntensity = isNight ? 4 : (isDusk ? 2 : 0);
  
  // Generate lamp positions along roads
  const lamps = useMemo(() => {
    const positions = [];
    
    // Along main roads near the building
    for (let x = -60; x <= 60; x += 15) {
      positions.push({ x, z: -15, rotY: 0 });
      positions.push({ x, z: 15, rotY: Math.PI });
    }
    for (let z = -60; z <= 60; z += 15) {
      positions.push({ x: -15, z, rotY: Math.PI / 2 });
      positions.push({ x: 15, z, rotY: -Math.PI / 2 });
    }
    
    // Filter out any too close to building center
    return positions.filter(p => !(Math.abs(p.x) < 12 && Math.abs(p.z) < 12));
  }, []);

  return (
    <group>
      {lamps.map((lamp, i) => (
        <group key={`lamp-${i}`} position={[lamp.x, 0, lamp.z]}>
          {/* Pole */}
          <mesh position={[0, 3, 0]}>
            <cylinderGeometry args={[0.08, 0.12, 6, 6]} />
            <meshStandardMaterial color="#374151" metalness={0.8} roughness={0.3} />
          </mesh>
          
          {/* Arm */}
          <mesh position={[1, 5.8, 0]} rotation={[0, 0, Math.PI / 6]}>
            <cylinderGeometry args={[0.04, 0.04, 2.5, 4]} />
            <meshStandardMaterial color="#374151" metalness={0.8} roughness={0.3} />
          </mesh>
          
          {/* Lamp head */}
          <mesh position={[1.8, 5.9, 0]}>
            <boxGeometry args={[0.8, 0.15, 0.4]} />
            <meshStandardMaterial 
              color={lightIntensity > 0 ? '#ffeedd' : '#6b7280'}
              emissive={lightIntensity > 0 ? '#ffcc88' : '#000000'}
              emissiveIntensity={emissiveIntensity}
              metalness={0.4}
              roughness={0.3}
            />
          </mesh>
          
          {/* Light cone (visible at night) */}
          {lightIntensity > 0 && (
            <>
              <pointLight
                position={[1.8, 5.5, 0]}
                intensity={lightIntensity}
                distance={15}
                color="#ffcc88"
                decay={2}
              />
              {/* Light cone visual */}
              <mesh position={[1.8, 3, 0]}>
                <coneGeometry args={[2, 5, 8, 1, true]} />
                <meshBasicMaterial 
                  color="#ffcc44"
                  transparent
                  opacity={0.03}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
};

export default StreetLights;
