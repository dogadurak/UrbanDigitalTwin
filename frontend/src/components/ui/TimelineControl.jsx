import React from 'react';
import useTwinStore from '../../store/useTwinStore';
import { Play, Pause, SkipBack, Clock } from 'lucide-react';

const TimelineControl = () => {
  const historyBuffer = useTwinStore(state => state.historyBuffer);
  const isHistoricalMode = useTwinStore(state => state.isHistoricalMode);
  const historicalIndex = useTwinStore(state => state.historicalIndex);
  const setHistoricalState = useTwinStore(state => state.setHistoricalState);

  const maxIndex = historyBuffer.length - 1;
  const currentIndex = isHistoricalMode ? historicalIndex : maxIndex;

  const handleSliderChange = (e) => {
    const val = parseInt(e.target.value);
    if (val >= maxIndex) {
      setHistoricalState(false, val);
    } else {
      setHistoricalState(true, val);
    }
  };

  const handleLiveClick = () => {
    setHistoricalState(false, maxIndex);
  };

  if (historyBuffer.length < 2) return null;

  // Format time of the current snapshot
  const currentSnapshot = isHistoricalMode ? historyBuffer[historicalIndex] : historyBuffer[maxIndex];
  const virtualTime = currentSnapshot?.timeOfDay || 0;
  
  const formatTime = (timeFloat) => {
    const hrs = Math.floor(timeFloat);
    const mins = Math.floor((timeFloat - hrs) * 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-slate-900/80 backdrop-blur-md border border-slate-700 p-4 rounded-2xl flex flex-col items-center gap-2 shadow-2xl z-50 w-[500px] transition-all duration-300">
      <div className="flex w-full justify-between items-center text-xs text-slate-400 font-semibold uppercase tracking-wider">
        <span className="flex items-center gap-1">
          <SkipBack size={14} /> T-{(maxIndex - currentIndex)}s
        </span>
        
        {isHistoricalMode ? (
          <span className="text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded border border-yellow-400/30 flex items-center gap-1 animate-pulse">
            <Pause size={14} /> HISTORICAL PLAYBACK
          </span>
        ) : (
          <span className="text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded border border-cyan-400/30 flex items-center gap-1">
            <Play size={14} /> LIVE SIMULATION
          </span>
        )}
        
        <span className="flex items-center gap-1 text-slate-200 bg-slate-800 px-2 py-0.5 rounded">
          <Clock size={14} className="text-blue-400" /> {formatTime(virtualTime)}
        </span>
      </div>

      <div className="w-full flex items-center gap-4">
        <input 
          type="range" 
          min="0" 
          max={maxIndex} 
          value={currentIndex}
          onChange={handleSliderChange}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />
        {isHistoricalMode && (
          <button 
            onClick={handleLiveClick}
            className="text-xs bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1 rounded transition-colors whitespace-nowrap"
          >
            Go Live
          </button>
        )}
      </div>
    </div>
  );
};

export default TimelineControl;
