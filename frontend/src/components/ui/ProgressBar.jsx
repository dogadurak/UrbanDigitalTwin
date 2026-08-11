import React from 'react';

const ProgressBar = ({ label, currentValue, maxValue, barColor = "bg-cyan-400", textColor = "text-cyan-300" }) => {
  const percentage = Math.min(100, Math.max(0, (currentValue / maxValue) * 100));
  
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
        <span>{label}</span>
        <span className={textColor}>{currentValue} / {maxValue}</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-1">
        <div className={`${barColor} h-1 rounded-full`} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
};

export default ProgressBar;
