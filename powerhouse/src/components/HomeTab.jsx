import { useMemo } from 'react';
import ProgressBar from './ProgressBar';
import {
  getSettings,
  getPhase,
  getPhaseColor,
  getPhaseLabel,
  getMeals,
  getWater,
  getWorkoutCompletion,
  getStreak,
  today,
} from '../data/storage';
import { threeDay, fiveDay } from '../data/workouts';

export default function HomeTab() {
  const settings = getSettings();
  const phase = getPhase(settings.currentWeek);
  const color = getPhaseColor(phase);
  const dateStr = today();

  const program = settings.split === 5 ? fiveDay : threeDay;
  const phaseData = program[phase];
  const todayDow = new Date().getDay(); // 0=Sun
  // Map day of week to workout day (Mon=Day1, etc)
  const workoutDayIndex = todayDow >= 1 && todayDow <= (settings.split === 5 ? 5 : 3)
    ? todayDow - 1
    : null;
  const todayWorkout = workoutDayIndex !== null ? phaseData.days[workoutDayIndex] : null;

  const meals = getMeals(dateStr);
  const totalCals = meals.reduce((s, m) => s + (m.calories || 0), 0);
  const totalProtein = meals.reduce((s, m) => s + (m.protein || 0), 0);
  const water = getWater(dateStr);
  const streak = getStreak();

  const completion = getWorkoutCompletion(dateStr);
  const dayKey = todayWorkout ? `day_${workoutDayIndex}` : null;
  const dayCompletion = dayKey && completion[dayKey] ? completion[dayKey] : {};
  const exercisesDone = todayWorkout
    ? todayWorkout.exercises.filter((_, i) => dayCompletion[i]).length
    : 0;
  const exercisesTotal = todayWorkout ? todayWorkout.exercises.length : 0;

  return (
    <div className="p-4 pb-24">
      <div className="mb-4">
        <h1 className="text-xl font-bold mb-1">
          Hey, {settings.name}
        </h1>
        <p className="text-gray-light text-xs">
          Week {settings.currentWeek} · {getPhaseLabel(phase)}
        </p>
      </div>

      {/* Streak */}
      <div
        className="rounded-xl p-4 mb-4"
        style={{ backgroundColor: '#111111', borderLeft: `3px solid ${color}` }}
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">🔥</span>
          <div>
            <div className="text-2xl font-bold">{streak}</div>
            <div className="text-xs text-gray-light">Day Streak</div>
          </div>
        </div>
      </div>

      {/* Today's workout */}
      <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: '#111111' }}>
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-sm font-bold">Today's Workout</h2>
          {todayWorkout && (
            <span className="text-xs" style={{ color }}>
              {exercisesDone}/{exercisesTotal}
            </span>
          )}
        </div>
        {todayWorkout ? (
          <>
            <p className="text-xs text-gray-light mb-2">{todayWorkout.name}</p>
            <div className="w-full h-2 rounded-full bg-gray-dark overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${exercisesTotal > 0 ? (exercisesDone / exercisesTotal) * 100 : 0}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-light">Rest day — recover and refuel</p>
        )}
      </div>

      {/* Nutrition */}
      <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: '#111111' }}>
        <h2 className="text-sm font-bold mb-3">Nutrition</h2>
        <ProgressBar
          value={totalCals}
          max={settings.calorieTarget}
          color={color}
          label="Calories"
          unit=" cal"
        />
        <ProgressBar
          value={totalProtein}
          max={settings.proteinTarget}
          color={color}
          label="Protein"
          unit="g"
        />
      </div>

      {/* Water */}
      <div className="rounded-xl p-4" style={{ backgroundColor: '#111111' }}>
        <h2 className="text-sm font-bold mb-3">Hydration</h2>
        <ProgressBar
          value={water}
          max={settings.waterTarget}
          color="#3B82F6"
          label="Water"
          unit=" oz"
        />
      </div>
    </div>
  );
}
