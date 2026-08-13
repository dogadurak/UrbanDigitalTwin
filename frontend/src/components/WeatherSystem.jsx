import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useTwinStore from '../store/useTwinStore';

const WeatherSystem = () => {
  const weather = useTwinStore(state => state.weather);
  const meshRef = useRef();
  
  const count = 3000;
  
  // Initialize rain drops randomly within a volume
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 150;
      const y = Math.random() * 100;
      const z = (Math.random() - 0.5) * 150;
      const speed = 20 + Math.random() * 20;
      temp.push({ x, y, z, speed });
    }
    return temp;
  }, [count]);

  useFrame((state, delta) => {
    if (!weather?.isRaining || !meshRef.current) return;
    
    // Wind factor based on windSpeed
    const windEffect = (weather.windSpeed || 10) * 1.5;

    particles.forEach((particle, i) => {
      // Fall down
      particle.y -= particle.speed * delta;
      
      // Drift sideways
      particle.x -= windEffect * delta;
      
      // Reset if hits ground
      if (particle.y < 0) {
        particle.y = 80 + Math.random() * 20;
        particle.x = (Math.random() - 0.5) * 150 + windEffect;
      }

      dummy.position.set(particle.x, particle.y, particle.z);
      // Lean the raindrops based on wind
      dummy.rotation.z = windEffect * 0.02; 
      dummy.scale.set(1, Math.random() * 2 + 1, 1);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (!weather?.isRaining) return null;

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <planeGeometry args={[0.04, 0.6]} />
      <meshBasicMaterial color="#aaccff" transparent opacity={0.4} depthWrite={false} />
    </instancedMesh>
  );
};

export default WeatherSystem;
