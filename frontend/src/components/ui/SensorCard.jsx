import React from 'react';

const SensorCard = ({ icon: Icon, label, value, unit, valueColor = "text-white" }) => {
  return (
    <div>
      <div className="flex items-center gap-2 text-gray-400 mb-1">
        {Icon && <Icon size={16} />}
        <span className="text-xs uppercase">{label}</span>
      </div>
      <div className={`text-2xl font-mono ${valueColor}`}>
        {value}
        <span className="text-sm text-gray-500 ml-1">{unit}</span>
      </div>
    </div>
  );
};

export default SensorCard;
