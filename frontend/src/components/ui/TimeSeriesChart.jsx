import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const TimeSeriesChart = ({ data, lines, height = 160 }) => {
  return (
    <div style={{ height: `${height}px`, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
          <XAxis dataKey="time" stroke="#ffffff50" fontSize={10} tickMargin={5} minTickGap={20} />
          <YAxis yAxisId="left" stroke="#ffffff50" fontSize={10} width={30} domain={['dataMin - 5', 'dataMax + 5']} />
          <Tooltip 
            contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', borderColor: 'rgba(0,255,255,0.3)', borderRadius: '8px' }}
            itemStyle={{ color: '#fff', fontSize: '12px' }}
            labelStyle={{ color: '#00ffff', fontSize: '12px' }}
          />
          {lines.map((line, idx) => (
            <Line 
              key={idx}
              yAxisId="left" 
              type="monotone" 
              dataKey={line.dataKey} 
              name={line.name} 
              stroke={line.color || "#00ffff"} 
              strokeWidth={2} 
              dot={false} 
              isAnimationActive={false} 
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TimeSeriesChart;
