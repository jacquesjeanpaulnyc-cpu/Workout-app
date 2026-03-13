const today = () => new Date().toISOString().split('T')[0];

export function getSettings() {
  const defaults = {
    name: 'Athlete',
    calorieTarget: 2200,
    proteinTarget: 180,
    waterTarget: 140,
    currentWeek: 1,
    split: 3,
  };
  try {
    const saved = localStorage.getItem('ph_settings');
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  localStorage.setItem('ph_settings', JSON.stringify(settings));
}

export function getPhase(week) {
  if (week <= 4) return 1;
  if (week <= 8) return 2;
  return 3;
}

export function getPhaseColor(phase) {
  if (phase === 1) return '#E74C3C';
  if (phase === 2) return '#E67E22';
  return '#27AE60';
}

export function getPhaseLabel(phase) {
  if (phase === 1) return 'Phase 1';
  if (phase === 2) return 'Phase 2';
  return 'Phase 3';
}

// Workout completion
export function getWorkoutCompletion(date) {
  try {
    const saved = localStorage.getItem(`ph_workout_${date}`);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

export function saveWorkoutCompletion(date, data) {
  localStorage.setItem(`ph_workout_${date}`, JSON.stringify(data));
}

// Meals
export function getMeals(date) {
  try {
    const saved = localStorage.getItem(`ph_meals_${date || today()}`);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveMeals(meals, date) {
  localStorage.setItem(`ph_meals_${date || today()}`, JSON.stringify(meals));
}

// Water
export function getWater(date) {
  try {
    const saved = localStorage.getItem(`ph_water_${date || today()}`);
    return saved ? parseInt(saved, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function saveWater(oz, date) {
  localStorage.setItem(`ph_water_${date || today()}`, String(oz));
}

// Streak
export function getStreak() {
  const settings = getSettings();
  let streak = 0;
  const d = new Date();
  // Check from yesterday backwards
  d.setDate(d.getDate() - 1);
  while (true) {
    const dateStr = d.toISOString().split('T')[0];
    const completion = getWorkoutCompletion(dateStr);
    const meals = getMeals(dateStr);
    const water = getWater(dateStr);
    const hasWorkout = Object.values(completion).some((dayData) =>
      typeof dayData === 'object'
        ? Object.values(dayData).some(Boolean)
        : dayData
    );
    const hasFood = meals.length > 0;
    const hasWater = water > 0;
    if (hasWorkout || hasFood || hasWater) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  // Check today too
  const todayStr = today();
  const todayCompletion = getWorkoutCompletion(todayStr);
  const todayMeals = getMeals(todayStr);
  const todayWater = getWater(todayStr);
  const todayActive =
    Object.values(todayCompletion).some((dayData) =>
      typeof dayData === 'object'
        ? Object.values(dayData).some(Boolean)
        : dayData
    ) ||
    todayMeals.length > 0 ||
    todayWater > 0;
  if (todayActive) streak++;
  return streak;
}

export { today };
