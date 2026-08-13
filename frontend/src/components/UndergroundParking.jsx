import React, { useMemo } from 'react';
import * as THREE from 'three';

const UndergroundParking = () => {
  // Static parking spots
  const spots = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 16; i++) {
      const x = -10 + (i % 8) * 3;
      const z = i < 8 ? -8 : 8;
      // Some spots have EVs (glowing blue chargers)
      const hasEV = Math.random() > 0.4;
      arr.push({ x, z, hasEV, occupied: Math.random() > 0.4 });
    }
    return arr;
  }, []);

  return (
    <group position={[0, -0.1, 0]}>
      {/* Underground structure - wireframe/transparent */}
      <mesh position={[0, -3, 0]}>
        <boxGeometry args={[30, 6, 30]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.6} depthWrite={false} />
      </mesh>
      
      {/* Floor of the parking */}
      <mesh position={[0, -6, 0]}>
        <boxGeometry args={[30, 0.2, 30]} />
        <meshStandardMaterial color="#020617" />
      </mesh>
      
      {/* Columns */}
      {[-10, 0, 10].map((x, i) => 
        [-10, 0, 10].map((z, j) => (
          <mesh key={`col-${i}-${j}`} position={[x, -3, z]}>
            <cylinderGeometry args={[0.5, 0.5, 6]} />
            <meshStandardMaterial color="#1e293b" />
          </mesh>
        ))
      )}

      {/* Parking Spots and Cars */}
      {spots.map((spot, i) => (
        <group key={`spot-${i}`} position={[spot.x, -5.9, spot.z]}>
          {/* Parking Lines */}
          <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0.01, 0]}>
            <planeGeometry args={[2.5, 4]} />
            <meshBasicMaterial color="#334155" wireframe />
          </mesh>
          
          {/* EV Charger */}
          {spot.hasEV && (
            <mesh position={[0, 0.5, spot.z > 0 ? 2 : -2]}>
              <boxGeometry args={[0.4, 1, 0.4]} />
              <meshStandardMaterial 
                color={spot.occupied ? "#00ffff" : "#0044ff"} 
                emissive={spot.occupied ? "#00ffff" : "#000000"}
                emissiveIntensity={spot.occupied ? 2 : 0}
              />
            </mesh>
          )}

          {/* Car */}
          {spot.occupied && (
            <mesh position={[0, 0.4, 0]}>
              <boxGeometry args={[1.8, 0.8, 3.5]} />
              <meshStandardMaterial color={spot.hasEV ? "#0f172a" : "#1e293b"} metalness={0.8} roughness={0.2} />
              
              {/* Charging Cable Glow (If EV and Occupied) */}
              {spot.hasEV && (
                <mesh position={[0, 0.5, spot.z > 0 ? 1.5 : -1.5]} rotation={[Math.PI/4, 0, 0]}>
                  <cylinderGeometry args={[0.02, 0.02, 1.0]} />
                  <meshBasicMaterial color="#00ffff" />
                </mesh>
              )}
            </mesh>
          )}
          
          {/* Indicator Light (Ceiling) */}
          <mesh position={[0, 5.7, 0]}>
            <sphereGeometry args={[0.15]} />
            <meshBasicMaterial color={spot.occupied ? "#ff0000" : "#00ff00"} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

export default UndergroundParking;
