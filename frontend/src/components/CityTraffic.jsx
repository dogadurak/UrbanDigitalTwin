import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useTwinStore from '../store/useTwinStore';

const dummy = new THREE.Object3D();

/**
 * City Traffic System — animated vehicles on roads.
 * Cars flow along road networks with simple path following.
 */
const CityTraffic = () => {
  const meshRef = useRef();
  const headlightRef = useRef();
  const timeOfDay = useTwinStore(state => state.building?.timeOfDay) || 12;
  const isNight = timeOfDay < 6 || timeOfDay > 18;
  
  const carCount = 60;
  
  const cars = useMemo(() => {
    return Array.from({ length: carCount }, (_, i) => {
      // Define road lanes
      const isHorizontal = i % 2 === 0;
      const lane = Math.floor(i / 4) * 20 - 60;
      const direction = i % 4 < 2 ? 1 : -1;
      const offset = (i % 2) * 2 - 1; // lane offset
      
      return {
        isHorizontal,
        lane: lane + offset * 2,
        pos: (Math.random() - 0.5) * 200,
        speed: (8 + Math.random() * 12) * direction,
        width: 1.2 + Math.random() * 0.8,
        height: 0.5 + Math.random() * 0.3,
        length: 2.5 + Math.random() * 1.5,
        colorIdx: Math.floor(Math.random() * 5),
      };
    });
  }, [carCount]);

  const carColors = useMemo(() => [
    '#1e293b', '#334155', '#0f172a', '#0c4a6e', '#1e1b4b'
  ], []);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    cars.forEach((car, i) => {
      // Move along road
      car.pos += car.speed * delta;
      
      // Wrap around
      if (car.pos > 100) car.pos = -100;
      if (car.pos < -100) car.pos = 100;
      
      if (car.isHorizontal) {
        dummy.position.set(car.pos, 0.35, car.lane);
        dummy.rotation.set(0, car.speed > 0 ? 0 : Math.PI, 0);
      } else {
        dummy.position.set(car.lane, 0.35, car.pos);
        dummy.rotation.set(0, car.speed > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      }
      
      dummy.scale.set(car.width, car.height, car.length);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;

    // Headlights (only at night)
    if (headlightRef.current && isNight) {
      cars.forEach((car, i) => {
        if (i >= 30) return; // Only show 30 headlights for performance
        
        if (car.isHorizontal) {
          dummy.position.set(car.pos + (car.speed > 0 ? car.length : -car.length), 0.4, car.lane);
        } else {
          dummy.position.set(car.lane, 0.4, car.pos + (car.speed > 0 ? car.length : -car.length));
        }
        dummy.scale.setScalar(0.15);
        dummy.updateMatrix();
        headlightRef.current.setMatrixAt(i, dummy.matrix);
      });
      headlightRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Car bodies */}
      <instancedMesh ref={meshRef} args={[null, null, carCount]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial 
          color="#1e293b"
          metalness={0.9}
          roughness={0.1}
        />
      </instancedMesh>
      
      {/* Headlights at night */}
      {isNight && (
        <instancedMesh ref={headlightRef} args={[null, null, 30]}>
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial 
            color="#ffffcc" 
            toneMapped={false}
          />
        </instancedMesh>
      )}
    </group>
  );
};

export default CityTraffic;
