import React, { useState, useEffect, useRef } from 'react';
import { Activity, Zap, Wind, ShieldCheck, CloudRain, Sun, Cloud, DollarSign, Leaf, Clock, Building } from 'lucide-react';
import useTwinStore from '../../store/useTwinStore';

/**
 * AnimatedCounter — smoothly animates number transitions.
 */
const AnimatedValue = ({ value, decimals = 0, prefix = '', suffix = '', className = '' }) => {
  const [displayValue, setDisplayValue] = useState(value);
  const ref = useRef(value);
  
  useEffect(() => {
    const start = ref.current;
    const end = value;
    const duration = 500;
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      const current = start + (end - start) * eased;
      setDisplayValue(current);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        ref.current = end;
      }
    };
    
    requestAnimationFrame(animate);
  }, [value]);

  return (
    <span className={`font-mono ${className}`}>
      {prefix}{displayValue.toFixed(decimals)}{suffix}
    </span>
  );
};

const StatusBadge = ({ status }) => {
  const statusConfig = {
    NORMAL: { color: 'text-green-400', bg: 'bg-green-500/15', border: 'border-green-500/30', dot: 'bg-green-400' },
    WARNING: { color: 'text-yellow-400', bg: 'bg-yellow-500/15', border: 'border-yellow-500/30', dot: 'bg-yellow-400' },
    EMERGENCY: { color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30', dot: 'bg-red-400 animate-pulse' },
  };
  
  const config = statusConfig[status] || statusConfig.NORMAL;
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${config.bg} border ${config.border}`}>
      <div className={`w-2 h-2 rounded-full ${config.dot}`} />
      <span className={`text-xs font-bold tracking-wider ${config.color}`}>{status}</span>
    </div>
  );
};

const TopStatusBar = () => {
  const building = useTwinStore(state => state.building);
  const weather = useTwinStore(state => state.weather);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const virtualTime = building?.timeOfDay || 0;
  const virtualHrs = Math.floor(virtualTime);
  const virtualMins = Math.floor((virtualTime - virtualHrs) * 60);
  const virtualTimeStr = `${virtualHrs.toString().padStart(2, '0')}:${virtualMins.toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center justify-between pointer-events-auto">
      
      {/* Left: Title + Status */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
            <Building size={16} className="text-cyan-400" />
          </div>
          <div>
            <h1 className="text-sm font-light text-white tracking-[0.2em]">
              {building.name?.toUpperCase() || 'URBAN'} <span className="font-bold text-cyan-400">TWIN</span>
            </h1>
            <div className="text-[9px] text-gray-500 tracking-wider">SMART FACILITY DASHBOARD</div>
          </div>
          
          {useTwinStore(state => state.viewLevel) === 'MICRO' && (
            <button
              onClick={() => useTwinStore.getState().setViewLevel('MACRO')}
              className="ml-4 px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 text-cyan-400 text-xs rounded transition-colors"
            >
              ← Back to City
            </button>
          )}
        </div>
        
        <StatusBadge status={building.status} />
      </div>

      {/* Center: Metrics */}
      <div className="flex items-center gap-1 glass-panel px-3 py-2">
        <MetricItem 
          icon={Zap} 
          iconColor="text-yellow-400" 
          label="Power" 
          value={building.powerLoad || 0} 
          decimals={0}
          suffix=" kW"
          valueColor="text-cyan-300"
        />
        <Divider />
        <MetricItem 
          icon={Wind} 
          iconColor="text-green-400" 
          label="HVAC" 
          value={building.hvacEfficiency || 0} 
          decimals={1}
          suffix="%"
          valueColor="text-green-400"
        />
        <Divider />
        <MetricItem 
          icon={ShieldCheck} 
          iconColor={building.activeAlerts > 0 ? "text-red-400" : "text-green-400"} 
          label="Alerts" 
          value={building.activeAlerts} 
          decimals={0}
          valueColor={building.activeAlerts > 0 ? "text-red-400" : "text-green-400"}
        />
        <Divider />
        <MetricItem 
          icon={DollarSign} 
          iconColor="text-emerald-400" 
          label="OPEX" 
          prefix="$"
          value={building.opex || 0} 
          decimals={2}
          suffix="/h"
          valueColor="text-emerald-300"
        />
        <Divider />
        <MetricItem 
          icon={Leaf} 
          iconColor="text-emerald-400" 
          label="CO₂" 
          value={building.co2 || 0} 
          decimals={1}
          suffix=" kg/h"
          valueColor="text-emerald-300"
        />
      </div>

      {/* Right: Weather + Time */}
      <div className="flex items-center gap-3">
        {weather && (
          <div className="flex items-center gap-2 glass-panel px-3 py-2">
            {weather.isRaining ? <CloudRain className="text-blue-400" size={16} /> : <Sun className="text-yellow-400" size={16} />}
            <div className="flex flex-col">
              <span className="text-xs text-gray-300 font-mono">{weather.temperature.toFixed(1)}°C</span>
              <span className="text-[9px] text-gray-500">{weather.condition}</span>
            </div>
          </div>
        )}
        
        <div className="flex flex-col items-end glass-panel px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-blue-400" />
            <span className="text-xs font-mono text-white">{virtualTimeStr}</span>
            <span className="text-[9px] text-gray-500">SIM</span>
          </div>
          <span className="text-[9px] text-gray-600 font-mono">{currentTime.toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
};

const MetricItem = ({ icon: Icon, iconColor, label, value, decimals = 0, prefix = '', suffix = '', valueColor = 'text-white' }) => (
  <div className="flex items-center gap-2 px-2">
    <Icon className={iconColor} size={15} />
    <div className="flex flex-col">
      <span className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</span>
      <AnimatedValue value={value} decimals={decimals} prefix={prefix} suffix={suffix} className={`text-xs ${valueColor}`} />
    </div>
  </div>
);

const Divider = () => <div className="w-px h-8 bg-white/10 mx-1" />;

export default TopStatusBar;
