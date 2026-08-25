import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useTwinStore from '../store/useTwinStore';

const dummy = new THREE.Object3D();

/**
 * HVAC Particle Flow — animated particles flowing through pipes.
 * Only visible in HVAC mode.
 * Simulates air/coolant flow from roof chiller down through shaft into each floor.
 */
const ParticleFlow = () => {
  const viewMode = useTwinStore(state => state.viewMode);
  const building = useTwinStore(state => state.building);
  const selectedFloorId = useTwinStore(state => state.selectedFloorId);
  
  if (viewMode !== 'HVAC' || !building) return null;
  const isIsolated = selectedFloorId !== null;
  if (isIsolated) return null;
  
  const floorCount = building.floors.length;
  
  return (
    <group>
      {/* Main shaft flow - vertical */}
      <VerticalFlow 
        count={200}
        startY={floorCount * 2.2 + 2}
        endY={1}
        radius={1.5}
        color="#00ffff"
      />
      
      {/* Horizontal flows per floor */}
      {building.floors.map((floor, i) => {
        const hvacOnline = floor.rooms?.[0]?.assets?.hvac?.status === 'ONLINE';
        if (!hvacOnline) return null;
        
        return (
          <HorizontalFlow
            key={floor.id}
            y={i * 2.2 + 2.0}
            count={40}
            color="#00ddff"
          />
        );
      })}
    </group>
  );
};

const VerticalFlow = ({ count, startY, endY, radius, color }) => {
  const meshRef = useRef();
  
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      angle: Math.random() * Math.PI * 2,
      r: Math.random() * radius * 0.4,
      y: startY - Math.random() * (startY - endY),
      speed: 3 + Math.random() * 4,
    }));
  }, [count, startY, endY, radius]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    particles.forEach((p, i) => {
      // Flow downward
      p.y -= p.speed * delta;
      if (p.y < endY) {
        p.y = startY;
        p.angle = Math.random() * Math.PI * 2;
        p.r = Math.random() * radius * 0.4;
      }
      
      // Spiral motion
      const spiralSpeed = 0.5;
      const x = Math.cos(p.angle + state.clock.elapsedTime * spiralSpeed) * p.r;
      const z = Math.sin(p.angle + state.clock.elapsedTime * spiralSpeed) * p.r;
      
      dummy.position.set(x, p.y, z);
      dummy.scale.setScalar(0.08 + Math.sin(state.clock.elapsedTime * 3 + i) * 0.03);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial 
        color={color} 
        transparent 
        opacity={0.6} 
        toneMapped={false}
        depthWrite={false}
      />
    </instancedMesh>
  );
};

const HorizontalFlow = ({ y, count, color }) => {
  const meshRef = useRef();
  
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 9,
      z: (Math.random() - 0.5) * 9,
      dirX: Math.random() > 0.5 ? 1 : -1,
      dirZ: Math.random() > 0.5 ? 1 : -1,
      speed: 1 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
    }));
  }, [count]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    particles.forEach((p, i) => {
      // Flow outward from center to edges
      p.x += p.dirX * p.speed * delta;
      p.z += p.dirZ * p.speed * delta;
      
      // Reset when reaching edge
      if (Math.abs(p.x) > 4.5) {
        p.x = (Math.random() - 0.5) * 2;
        p.dirX = Math.random() > 0.5 ? 1 : -1;
      }
      if (Math.abs(p.z) > 4.5) {
        p.z = (Math.random() - 0.5) * 2;
        p.dirZ = Math.random() > 0.5 ? 1 : -1;
      }
      
      dummy.position.set(p.x, y + Math.sin(state.clock.elapsedTime * 2 + p.phase) * 0.1, p.z);
      dummy.scale.setScalar(0.06);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial 
        color={color} 
        transparent 
        opacity={0.4} 
        toneMapped={false}
        depthWrite={false}
      />
    </instancedMesh>
  );
};

export default ParticleFlow;
