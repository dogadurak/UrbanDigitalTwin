import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle, Info, X, Flame, Shield } from 'lucide-react';

/**
 * ToastProvider — Global toast notification system.
 * Provides glassmorphism toast notifications with auto-dismiss and progress bar.
 */

// Toast store (simple pub-sub outside React)
let toastListeners = [];
let toastId = 0;

export const showToast = ({ type = 'info', title, message, duration = 5000 }) => {
  const toast = { id: ++toastId, type, title, message, duration, createdAt: Date.now() };
  toastListeners.forEach(listener => listener(toast));
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const listener = (toast) => {
      setToasts(prev => [...prev.slice(-4), toast]); // Max 5 toasts
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter(l => l !== listener);
    };
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <div className="fixed top-20 right-6 z-[200] flex flex-col gap-2 pointer-events-none w-96">
      <AnimatePresence>
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
};

const ToastItem = ({ toast, onDismiss }) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - toast.createdAt;
      const remaining = Math.max(0, 100 - (elapsed / toast.duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        onDismiss(toast.id);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [toast, onDismiss]);

  const config = getToastConfig(toast.type);

  return (
    <motion.div
      initial={{ x: 100, opacity: 0, scale: 0.9 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 100, opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', damping: 20, stiffness: 300 }}
      className={`pointer-events-auto bg-black/80 backdrop-blur-xl border ${config.borderColor} rounded-xl overflow-hidden shadow-2xl`}
      style={{ boxShadow: `0 0 20px ${config.glowColor}` }}
    >
      <div className="p-3 flex items-start gap-3">
        <div className={`p-1.5 rounded-lg ${config.iconBg}`}>
          <config.Icon size={16} className={config.iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-bold uppercase tracking-wider ${config.titleColor}`}>
            {toast.title}
          </div>
          <div className="text-xs text-gray-300 mt-0.5 leading-relaxed">
            {toast.message}
          </div>
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="p-1 hover:bg-white/10 rounded transition-colors text-gray-500 hover:text-white"
        >
          <X size={12} />
        </button>
      </div>
      
      {/* Progress bar */}
      <div className="h-0.5 bg-white/5">
        <div
          className={`h-full ${config.progressColor} transition-all ease-linear`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </motion.div>
  );
};

const getToastConfig = (type) => {
  switch (type) {
    case 'danger':
    case 'critical':
      return {
        Icon: Flame,
        borderColor: 'border-red-500/30',
        glowColor: 'rgba(239,68,68,0.15)',
        iconBg: 'bg-red-500/20',
        iconColor: 'text-red-400',
        titleColor: 'text-red-400',
        progressColor: 'bg-red-500',
      };
    case 'warning':
      return {
        Icon: AlertTriangle,
        borderColor: 'border-yellow-500/30',
        glowColor: 'rgba(245,158,11,0.15)',
        iconBg: 'bg-yellow-500/20',
        iconColor: 'text-yellow-400',
        titleColor: 'text-yellow-400',
        progressColor: 'bg-yellow-500',
      };
    case 'success':
      return {
        Icon: CheckCircle,
        borderColor: 'border-green-500/30',
        glowColor: 'rgba(34,197,94,0.15)',
        iconBg: 'bg-green-500/20',
        iconColor: 'text-green-400',
        titleColor: 'text-green-400',
        progressColor: 'bg-green-500',
      };
    case 'security':
      return {
        Icon: Shield,
        borderColor: 'border-purple-500/30',
        glowColor: 'rgba(168,85,247,0.15)',
        iconBg: 'bg-purple-500/20',
        iconColor: 'text-purple-400',
        titleColor: 'text-purple-400',
        progressColor: 'bg-purple-500',
      };
    default:
      return {
        Icon: Info,
        borderColor: 'border-cyan-500/30',
        glowColor: 'rgba(0,229,255,0.15)',
        iconBg: 'bg-cyan-500/20',
        iconColor: 'text-cyan-400',
        titleColor: 'text-cyan-400',
        progressColor: 'bg-cyan-500',
      };
  }
};

export default ToastContainer;
