import React, { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import useTwinStore from '../store/useTwinStore';

const Drone = () => {
  const groupRef = useRef();
  const rotorRefs = [useRef(), useRef(), useRef(), useRef()];
  const spotLightRef = useRef();
  const [lightTarget] = useState(() => new THREE.Object3D());
  const activeScenario = useTwinStore(state => state.activeScenario);
  
  // Create a stable target vector for smooth lookAt interpolation
  const targetLookAt = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const currentLookAt = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  useFrame((state, delta) => {
    const time = state.clock.getElapsedTime();
    
    // Spin rotors
    rotorRefs.forEach((ref, idx) => {
      if (ref.current) {
        ref.current.rotation.y += delta * (15 + (idx % 2 === 0 ? 1 : -1) * 5); 
      }
    });

    if (!groupRef.current) return;

    let targetPos;
    let lightColor = "#00aaff";
    let lightIntensity = 5;
    let isBreach = activeScenario === 'SECURITY_BREACH';

    if (isBreach) {
      // Fly to Floor 15 (Index 14 -> Y: 14 * 2.2 + 1.1 = 31.9)
      const targetY = 31.9;
      // Hover outside the window
      targetPos = new THREE.Vector3(12, targetY, 12);
      targetLookAt.set(0, targetY, 0); // Look at the floor
      lightColor = "#ff0000"; // Red alert
      lightIntensity = 20;
      
      // Add slight hover wobble
      targetPos.y += Math.sin(time * 4) * 0.5;
    } else {
      // Normal Patrol Route (Above building, circling)
      const radius = 25;
      const speed = 0.2;
      const patrolY = 38 + Math.sin(time * 0.5) * 2; // Bobbing up and down slightly above roof (35)
      
      targetPos = new THREE.Vector3(
        Math.cos(time * speed) * radius,
        patrolY,
        Math.sin(time * speed) * radius
      );
      
      // Look slightly down at the center of the building
      targetLookAt.set(0, 20, 0); 
    }

    // Smooth position interpolation
    groupRef.current.position.lerp(targetPos, delta * 2);
    
    // Smooth lookAt interpolation
    currentLookAt.lerp(targetLookAt, delta * 3);
    groupRef.current.lookAt(currentLookAt);

    // Update spotlight
    if (spotLightRef.current) {
      spotLightRef.current.color.set(lightColor);
      spotLightRef.current.intensity = THREE.MathUtils.lerp(spotLightRef.current.intensity, lightIntensity, delta * 5);
      // Ensure the light targets the lookAt point
      lightTarget.position.copy(currentLookAt);
    }
  });

  const isBreach = activeScenario === 'SECURITY_BREACH';

  return (
    <group ref={groupRef}>
      <primitive object={lightTarget} />
      {/* Drone Body */}
      <mesh>
        <boxGeometry args={[1.5, 0.4, 1.5]} />
        <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.2} />
      </mesh>
      
      {/* Drone Camera / Eye */}
      <mesh position={[0, -0.2, 0.7]}>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshStandardMaterial 
          color={isBreach ? "#ff0000" : "#00ffff"} 
          emissive={isBreach ? "#ff0000" : "#00aaff"} 
          emissiveIntensity={2} 
        />
      </mesh>

      {/* Arms & Rotors */}
      {[
        [-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]
      ].map((pos, idx) => (
        <group key={idx} position={[pos[0], 0, pos[1]]}>
          {/* Arm */}
          <mesh position={[-pos[0]*0.4, 0, -pos[1]*0.4]}>
            <cylinderGeometry args={[0.05, 0.05, 1]} />
            <meshStandardMaterial color="#334155" />
          </mesh>
          {/* Rotor Motor */}
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.2]} />
            <meshStandardMaterial color="#0f172a" />
          </mesh>
          {/* Propeller */}
          <mesh ref={rotorRefs[idx]} position={[0, 0.3, 0]}>
            <boxGeometry args={[1.2, 0.02, 0.1]} />
            <meshStandardMaterial color="#94a3b8" transparent opacity={0.6} />
          </mesh>
        </group>
      ))}

      {/* Search Light */}
      <spotLight 
        ref={spotLightRef}
        position={[0, -0.2, 0.7]} 
        angle={0.4} 
        penumbra={0.5} 
        distance={60}
        castShadow
        target={lightTarget}
      />
    </group>
  );
};

export default Drone;
