import { useState, useCallback } from 'react';
import ProgressBar from './ProgressBar';
import { getSettings, getWater, saveWater, getPhase, getPhaseColor, today } from '../data/storage';

export default function WaterTab() {
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  const settings = getSettings();
  const phase = getPhase(settings.currentWeek);
  const color = getPhaseColor(phase);
  const dateStr = today();
  const water = getWater(dateStr);

  const pct = Math.min((water / settings.waterTarget) * 100, 100);

  function addWater(oz) {
    saveWater(water + oz, dateStr);
    refresh();
  }

  function resetWater() {
    saveWater(0, dateStr);
    refresh();
  }

  return (
    <div className="p-4 pb-24">
      {/* Big circle progress */}
      <div className="flex flex-col items-center mb-6">
        <div className="relative w-48 h-48 mb-4">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
            <circle
              cx="100"
              cy="100"
              r="85"
              fill="none"
              stroke="#333"
              strokeWidth="12"
            />
            <circle
              cx="100"
              cy="100"
              r="85"
              fill="none"
              stroke="#3B82F6"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 85}`}
              strokeDashoffset={`${2 * Math.PI * 85 * (1 - pct / 100)}`}
              className="transition-all duration-500"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold">{water}</span>
            <span className="text-xs text-gray-light">/ {settings.waterTarget} oz</span>
          </div>
        </div>
        <p className="text-xs text-gray-light">
          {pct >= 100 ? 'Target reached! 💧' : `${Math.round(pct)}% of daily goal`}
        </p>
      </div>

      {/* Quick add buttons */}
      <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: '#111111' }}>
        <h2 className="text-sm font-bold mb-3">Quick Add</h2>
        <div className="grid grid-cols-3 gap-3">
          {[8, 16, 32].map((oz) => (
            <button
              key={oz}
              onClick={() => addWater(oz)}
              className="py-4 rounded-xl text-sm font-bold transition-all active:scale-[0.95]"
              style={{ backgroundColor: '#0D0D0D', border: '1px solid #333' }}
            >
              +{oz}oz
            </button>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: '#111111' }}>
        <ProgressBar
          value={water}
          max={settings.waterTarget}
          color="#3B82F6"
          label="Water Intake"
          unit=" oz"
        />
      </div>

      {/* Reset */}
      <button
        onClick={resetWater}
        className="w-full py-2 rounded-lg text-xs text-gray-light border border-gray-dark transition-all active:scale-[0.98]"
      >
        Reset Today's Water
      </button>
    </div>
  );
}
