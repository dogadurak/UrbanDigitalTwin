import React, { useEffect, useRef } from 'react';

/**
 * GaugeChart — SVG-based radial gauge indicator.
 * Shows a value within a min/max range with animated needle and gradient arc.
 */
const GaugeChart = ({ 
  value, 
  min = 0, 
  max = 100, 
  label = '', 
  unit = '',
  size = 120,
  thresholds = { warning: 60, danger: 80 },
  colorScheme = 'cyan' // cyan, green, red, yellow
}) => {
  const normalized = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const angle = -120 + normalized * 240; // -120 to +120 degrees
  
  const cx = size / 2;
  const cy = size / 2 + 5;
  const radius = size / 2 - 15;
  
  // Generate arc path
  const getArcPath = (startAngle, endAngle, r) => {
    const startRad = (startAngle - 90) * Math.PI / 180;
    const endRad = (endAngle - 90) * Math.PI / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  // Determine value color
  const getValueColor = () => {
    const pct = normalized * 100;
    if (pct >= thresholds.danger) return '#ef4444';
    if (pct >= thresholds.warning) return '#f59e0b';
    
    switch (colorScheme) {
      case 'green': return '#22c55e';
      case 'red': return '#ef4444';
      case 'yellow': return '#f59e0b';
      default: return '#00e5ff';
    }
  };

  const needleRad = (angle - 90) * Math.PI / 180;
  const needleLength = radius - 8;
  const needleX = cx + needleLength * Math.cos(needleRad);
  const needleY = cy + needleLength * Math.sin(needleRad);

  // Tick marks
  const ticks = [];
  for (let i = 0; i <= 8; i++) {
    const tickAngle = -120 + i * 30;
    const tickRad = (tickAngle - 90) * Math.PI / 180;
    const innerR = radius - 5;
    const outerR = radius + 2;
    ticks.push({
      x1: cx + innerR * Math.cos(tickRad),
      y1: cy + innerR * Math.sin(tickRad),
      x2: cx + outerR * Math.cos(tickRad),
      y2: cy + outerR * Math.sin(tickRad),
      isMajor: i % 2 === 0,
    });
  }

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.75} viewBox={`0 0 ${size} ${size * 0.8}`}>
        {/* Background arc */}
        <path
          d={getArcPath(-120, 120, radius)}
          fill="none"
          stroke="#1e293b"
          strokeWidth="6"
          strokeLinecap="round"
        />
        
        {/* Value arc */}
        <path
          d={getArcPath(-120, angle, radius)}
          fill="none"
          stroke={getValueColor()}
          strokeWidth="6"
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 4px ${getValueColor()}80)`,
            transition: 'all 0.5s ease-out',
          }}
        />
        
        {/* Tick marks */}
        {ticks.map((tick, i) => (
          <line
            key={i}
            x1={tick.x1} y1={tick.y1}
            x2={tick.x2} y2={tick.y2}
            stroke={tick.isMajor ? '#64748b' : '#334155'}
            strokeWidth={tick.isMajor ? 1.5 : 0.8}
          />
        ))}
        
        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={needleX} y2={needleY}
          stroke={getValueColor()}
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            transition: 'all 0.5s ease-out',
            filter: `drop-shadow(0 0 3px ${getValueColor()})`,
          }}
        />
        
        {/* Center dot */}
        <circle cx={cx} cy={cy} r="3" fill={getValueColor()} />
        <circle cx={cx} cy={cy} r="1.5" fill="#000" />
        
        {/* Value text */}
        <text x={cx} y={cy + 16} textAnchor="middle" fill="#ffffff" fontSize="14" fontFamily="monospace" fontWeight="bold">
          {typeof value === 'number' ? value.toFixed(1) : value}
        </text>
        <text x={cx} y={cy + 26} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">
          {unit}
        </text>
      </svg>
      
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-gray-500 mt-1">{label}</span>
      )}
    </div>
  );
};

export default GaugeChart;
