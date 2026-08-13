import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * ArcGIS-style glowing wireframe edges for each floor.
 * Creates a neon outline effect that makes the building look high-tech.
 */
const GlowingEdges = ({ position, width = 10.2, height = 2.2, depth = 10.2, color = '#00ffff', intensity = 1.0, pulse = false, opacity = 1.0 }) => {
  const lineRef = useRef();
  
  const geometry = useMemo(() => {
    const box = new THREE.BoxGeometry(width, height, depth);
    return new THREE.EdgesGeometry(box);
  }, [width, height, depth]);

  useFrame((state) => {
    if (!lineRef.current) return;
    if (pulse) {
      const t = (Math.sin(state.clock.elapsedTime * 2) + 1) / 2;
      lineRef.current.material.opacity = 0.3 + t * 0.7 * opacity;
    }
  });

  return (
    <lineSegments ref={lineRef} geometry={geometry} position={position}>
      <lineBasicMaterial 
        color={color} 
        transparent 
        opacity={opacity * 0.8} 
        linewidth={1}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
};

/**
 * Full building edge wireframe overlay.
 * One edge-line per floor + building outline.
 */
const BuildingEdgeOverlay = ({ floorCount = 15, isIsolated = false, selectedFloorId = null, viewMode = 'NORMAL' }) => {
  const groupRef = useRef();
  
  // Determine edge color based on view mode
  const getEdgeColor = () => {
    switch (viewMode) {
      case 'ENERGY': return '#ffaa00';
      case 'HVAC': return '#00aaff';
      case 'SECURITY': return '#aa00ff';
      case 'FIRE': return '#ff3300';
      default: return '#00ffff';
    }
  };

  const color = getEdgeColor();

  if (isIsolated) return null;

  return (
    <group ref={groupRef}>
      {/* Floor edge lines */}
      {Array.from({ length: floorCount }, (_, i) => (
        <GlowingEdges
          key={`edge-${i}`}
          position={[0, i * 2.2 + 1.1, 0]}
          color={color}
          opacity={0.4}
        />
      ))}
      
      {/* Building overall bounding wireframe */}
      <GlowingEdges
        position={[0, (floorCount * 2.2) / 2 + 0.5, 0]}
        width={10.6}
        height={floorCount * 2.2 + 1}
        depth={10.6}
        color={color}
        opacity={0.15}
      />

      {/* Ground perimeter glow ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[14, 14.3, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      
      {/* Secondary ring */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[16, 16.15, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
};

export { GlowingEdges, BuildingEdgeOverlay };
export default BuildingEdgeOverlay;
