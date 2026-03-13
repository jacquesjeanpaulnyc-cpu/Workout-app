import { useState, useCallback } from 'react';
import {
  getSettings,
  saveSettings,
  getPhase,
  getPhaseColor,
  getPhaseLabel,
  getWorkoutCompletion,
  saveWorkoutCompletion,
  today,
} from '../data/storage';
import { threeDay, fiveDay } from '../data/workouts';

export default function WorkoutTab() {
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  const settings = getSettings();
  const phase = getPhase(settings.currentWeek);
  const color = getPhaseColor(phase);
  const program = settings.split === 5 ? fiveDay : threeDay;
  const phaseData = program[phase];
  const dateStr = today();

  const [selectedDay, setSelectedDay] = useState(0);
  const dayData = phaseData.days[selectedDay];
  const completion = getWorkoutCompletion(dateStr);
  const dayKey = `day_${selectedDay}`;
  const dayCompletion = completion[dayKey] || {};

  function toggleExercise(idx) {
    const updated = { ...completion };
    if (!updated[dayKey]) updated[dayKey] = {};
    updated[dayKey][idx] = !updated[dayKey][idx];
    saveWorkoutCompletion(dateStr, updated);
    refresh();
  }

  function handleSplitChange(newSplit) {
    saveSettings({ ...settings, split: newSplit });
    setSelectedDay(0);
    refresh();
  }

  const doneCount = dayData.exercises.filter((_, i) => dayCompletion[i]).length;

  return (
    <div className="p-4 pb-24">
      {/* Split toggle */}
      <div className="flex gap-2 mb-4">
        {[3, 5].map((s) => (
          <button
            key={s}
            onClick={() => handleSplitChange(s)}
            className="flex-1 py-2 rounded-lg text-xs font-bold transition-all"
            style={{
              backgroundColor: settings.split === s ? color : '#111111',
              color: settings.split === s ? '#fff' : '#888',
            }}
          >
            {s}-Day
          </button>
        ))}
      </div>

      {/* Phase info */}
      <div className="text-center mb-4">
        <span
          className="text-xs font-bold px-3 py-1 rounded-full"
          style={{ backgroundColor: color + '22', color }}
        >
          {getPhaseLabel(phase)} · {phaseData.weeks}
        </span>
      </div>

      {/* Day selector */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {phaseData.days.map((d, i) => (
          <button
            key={i}
            onClick={() => setSelectedDay(i)}
            className="flex-shrink-0 px-3 py-2 rounded-lg text-xs transition-all"
            style={{
              backgroundColor: selectedDay === i ? color : '#111111',
              color: selectedDay === i ? '#fff' : '#888',
            }}
          >
            Day {i + 1}
          </button>
        ))}
      </div>

      {/* Day header */}
      <div className="rounded-xl p-4 mb-3" style={{ backgroundColor: '#111111' }}>
        <h2 className="text-sm font-bold mb-1">{dayData.name}</h2>
        <div className="flex justify-between text-xs text-gray-light">
          <span>{dayData.rest}</span>
          <span style={{ color }}>
            {doneCount}/{dayData.exercises.length} done
          </span>
        </div>
      </div>

      {/* Exercises */}
      <div className="space-y-2">
        {dayData.exercises.map((ex, i) => {
          const done = !!dayCompletion[i];
          return (
            <button
              key={i}
              onClick={() => toggleExercise(i)}
              className="w-full text-left rounded-xl p-4 flex items-center gap-3 transition-all active:scale-[0.98]"
              style={{
                backgroundColor: '#111111',
                opacity: done ? 0.6 : 1,
                borderLeft: done ? `3px solid ${color}` : '3px solid transparent',
              }}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-all"
                style={{
                  borderColor: done ? color : '#333',
                  backgroundColor: done ? color : 'transparent',
                }}
              >
                {done && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className="text-sm font-medium"
                  style={{ textDecoration: done ? 'line-through' : 'none' }}
                >
                  {ex.name}
                </div>
                <div className="text-xs text-gray-light">{ex.sets}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
