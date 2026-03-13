import { useState, useCallback } from 'react';
import ProgressBar from './ProgressBar';
import {
  getSettings,
  getMeals,
  saveMeals,
  getPhase,
  getPhaseColor,
  today,
} from '../data/storage';

export default function FoodTab() {
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  const settings = getSettings();
  const phase = getPhase(settings.currentWeek);
  const color = getPhaseColor(phase);
  const dateStr = today();
  const meals = getMeals(dateStr);

  const totalCals = meals.reduce((s, m) => s + (m.calories || 0), 0);
  const totalProtein = meals.reduce((s, m) => s + (m.protein || 0), 0);

  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');

  function addMeal(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const meal = {
      id: Date.now(),
      name: name.trim(),
      calories: parseInt(calories, 10) || 0,
      protein: parseInt(protein, 10) || 0,
    };
    const updated = [...meals, meal];
    saveMeals(updated, dateStr);
    setName('');
    setCalories('');
    setProtein('');
    refresh();
  }

  function removeMeal(id) {
    const updated = meals.filter((m) => m.id !== id);
    saveMeals(updated, dateStr);
    refresh();
  }

  return (
    <div className="p-4 pb-24">
      {/* Totals */}
      <div className="rounded-xl p-4 mb-4" style={{ backgroundColor: '#111111' }}>
        <h2 className="text-sm font-bold mb-3">Daily Totals</h2>
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

      {/* Add meal form */}
      <form
        onSubmit={addMeal}
        className="rounded-xl p-4 mb-4 space-y-3"
        style={{ backgroundColor: '#111111' }}
      >
        <h2 className="text-sm font-bold">Log Meal</h2>
        <input
          type="text"
          placeholder="Meal name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-bg rounded-lg px-3 py-2 text-sm text-white border border-gray-dark focus:outline-none focus:border-gray-light"
        />
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Calories"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            className="flex-1 bg-bg rounded-lg px-3 py-2 text-sm text-white border border-gray-dark focus:outline-none focus:border-gray-light"
          />
          <input
            type="number"
            placeholder="Protein (g)"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            className="flex-1 bg-bg rounded-lg px-3 py-2 text-sm text-white border border-gray-dark focus:outline-none focus:border-gray-light"
          />
        </div>
        <button
          type="submit"
          className="w-full py-2 rounded-lg text-sm font-bold transition-all active:scale-[0.98]"
          style={{ backgroundColor: color }}
        >
          Add Meal
        </button>
      </form>

      {/* Meal list */}
      <div className="space-y-2">
        {meals.map((m) => (
          <div
            key={m.id}
            className="rounded-xl p-3 flex items-center justify-between"
            style={{ backgroundColor: '#111111' }}
          >
            <div>
              <div className="text-sm font-medium">{m.name}</div>
              <div className="text-xs text-gray-light">
                {m.calories} cal · {m.protein}g protein
              </div>
            </div>
            <button
              onClick={() => removeMeal(m.id)}
              className="text-gray-light hover:text-red text-lg px-2"
            >
              ×
            </button>
          </div>
        ))}
        {meals.length === 0 && (
          <p className="text-center text-xs text-gray-light py-8">
            No meals logged today
          </p>
        )}
      </div>
    </div>
  );
}
