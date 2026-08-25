import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useTwinStore from '../store/useTwinStore';

/**
 * 3D Heatmap Overlay for Energy visualization mode.
 * Each floor gets a colored plane showing energy intensity.
 * Green = low energy, Yellow = medium, Red = high.
 */
const HeatmapOverlay = () => {
  const building = useTwinStore(state => state.building);
  const viewMode = useTwinStore(state => state.viewMode);
  const selectedFloorId = useTwinStore(state => state.selectedFloorId);
  
  if (viewMode !== 'ENERGY' || !building) return null;
  const isIsolated = selectedFloorId !== null;

  return (
    <group>
      {building.floors.map((floor, i) => {
        const itLoad = floor.rooms?.[0]?.sensors?.itLoad?.currentValue || 0;
        // Normalize to 0-1 range (0-80 kW assumed max)
        const normalized = Math.min(1, Math.max(0, itLoad / 80));
        
        if (isIsolated && floor.id !== selectedFloorId) return null;
        
        return (
          <HeatmapFloorPlane
            key={floor.id}
            position={[0, i * 2.2 + 1.15, 0]}
            intensity={normalized}
          />
        );
      })}
      
      {/* Vertical heat bars on sides */}
      {!isIsolated && building.floors.map((floor, i) => {
        const itLoad = floor.rooms?.[0]?.sensors?.itLoad?.currentValue || 0;
        const normalized = Math.min(1, Math.max(0, itLoad / 80));
        
        return (
          <HeatBar 
            key={`bar-${floor.id}`}
            position={[-5.5, i * 2.2 + 1.1, 0]}
            height={2.0}
            intensity={normalized}
          />
        );
      })}
    </group>
  );
};

const HeatmapFloorPlane = ({ position, intensity }) => {
  const meshRef = useRef();
  
  const color = useMemo(() => {
    const c = new THREE.Color();
    if (intensity < 0.33) {
      c.lerpColors(new THREE.Color('#00ff44'), new THREE.Color('#aaff00'), intensity / 0.33);
    } else if (intensity < 0.66) {
      c.lerpColors(new THREE.Color('#aaff00'), new THREE.Color('#ffaa00'), (intensity - 0.33) / 0.33);
    } else {
      c.lerpColors(new THREE.Color('#ffaa00'), new THREE.Color('#ff2200'), (intensity - 0.66) / 0.34);
    }
    return c;
  }, [intensity]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const pulse = (Math.sin(state.clock.elapsedTime * 1.5 + intensity * 10) + 1) / 2;
    meshRef.current.material.opacity = 0.15 + pulse * 0.25 * intensity;
  });

  return (
    <mesh ref={meshRef} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[10, 10]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.3}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
};

const HeatBar = ({ position, height, intensity }) => {
  const color = useMemo(() => {
    const c = new THREE.Color();
    if (intensity < 0.5) {
      c.lerpColors(new THREE.Color('#00ff44'), new THREE.Color('#ffaa00'), intensity * 2);
    } else {
      c.lerpColors(new THREE.Color('#ffaa00'), new THREE.Color('#ff2200'), (intensity - 0.5) * 2);
    }
    return c;
  }, [intensity]);

  return (
    <mesh position={position}>
      <boxGeometry args={[0.15, height * intensity + 0.1, 0.15]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.7}
        toneMapped={false}
      />
    </mesh>
  );
};

export default HeatmapOverlay;
