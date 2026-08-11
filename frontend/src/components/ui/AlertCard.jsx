import React from 'react';
import { AlertCircle, ShieldAlert, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

const AlertCard = ({ title, description, time, type = "info" }) => {
  let bgColor = "bg-blue-500/10 border-blue-500/30 text-blue-400";
  let Icon = Zap;
  
  if (type === "warning") {
    bgColor = "bg-yellow-500/10 border-yellow-500/30 text-yellow-400";
    Icon = AlertCircle;
  } else if (type === "danger") {
    bgColor = "bg-red-500/10 border-red-500/30 text-red-400";
    Icon = ShieldAlert;
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-3 border rounded-lg ${bgColor} flex flex-col gap-1`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wide">
          <Icon size={14} />
          {title}
        </div>
        {time && <span className="text-[10px] opacity-70 font-mono">{time}</span>}
      </div>
      <div className="text-xs opacity-90">
        {description}
      </div>
    </motion.div>
  );
};

export default AlertCard;
