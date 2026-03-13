const threeDay = {
  1: {
    name: 'Phase 1',
    weeks: 'Weeks 1–4',
    days: [
      {
        name: 'Day 1 — Lower Strength',
        rest: '90s rest',
        exercises: [
          { name: 'Back Squat', sets: '4×5' },
          { name: 'Romanian Deadlift', sets: '4×6' },
          { name: 'Walking Lunges', sets: '3×10 each' },
          { name: 'Glute Bridge', sets: '3×12' },
          { name: 'Hanging Knee Raise', sets: '3×12' },
          { name: 'Incline Treadmill Walk', sets: '15 min' },
        ],
      },
      {
        name: 'Day 2 — Upper Strength',
        rest: '90s rest',
        exercises: [
          { name: 'Bench Press', sets: '4×5' },
          { name: 'Barbell Row', sets: '4×6' },
          { name: 'Overhead Press', sets: '3×8' },
          { name: 'Pull-Ups', sets: '3×8' },
          { name: 'Plank', sets: '3×45sec' },
          { name: 'Farmers Carry', sets: '3×40yd' },
        ],
      },
      {
        name: 'Day 3 — Full Body & Conditioning',
        rest: '2 min rest',
        exercises: [
          { name: 'Deadlift', sets: '4×5' },
          { name: 'Hip Thrust', sets: '4×10' },
          { name: 'DB Incline Press', sets: '3×10' },
          { name: 'Cable Row', sets: '3×10' },
          { name: 'Ab Wheel Rollout', sets: '3×10' },
          { name: 'Assault Bike', sets: '6×20s on 40s off' },
        ],
      },
    ],
  },
  2: {
    name: 'Phase 2',
    weeks: 'Weeks 5–8',
    days: [
      {
        name: 'Day 1 — Lower Strength',
        rest: '90s rest',
        exercises: [
          { name: 'Back Squat', sets: '5×5' },
          { name: 'Romanian Deadlift', sets: '4×6' },
          { name: 'Bulgarian Split Squat', sets: '3×10 each' },
          { name: 'Glute-Ham Raise', sets: '3×8' },
          { name: 'Hanging Leg Raise', sets: '3×12' },
          { name: 'Incline Treadmill Walk', sets: '20 min' },
        ],
      },
      {
        name: 'Day 2 — Upper Strength',
        rest: '90s rest',
        exercises: [
          { name: 'Bench Press', sets: '5×5' },
          { name: 'Barbell Row', sets: '4×6' },
          { name: 'Overhead Press', sets: '4×8' },
          { name: 'Weighted Pull-Ups', sets: '4×6' },
          { name: 'Pallof Press', sets: '3×12 each' },
          { name: 'Farmers Carry', sets: '3×50yd' },
        ],
      },
      {
        name: 'Day 3 — Full Body & Conditioning',
        rest: '2 min rest',
        exercises: [
          { name: 'Deadlift', sets: '5×4' },
          { name: 'Hip Thrust', sets: '4×10' },
          { name: 'DB Floor Press', sets: '3×10' },
          { name: 'Chest-Supported Row', sets: '3×10' },
          { name: 'Ab Wheel Rollout', sets: '3×12' },
          { name: 'Rowing Intervals', sets: '6×250m 90s rest' },
        ],
      },
    ],
  },
  3: {
    name: 'Phase 3',
    weeks: 'Weeks 9–12',
    days: [
      {
        name: 'Day 1 — Lower Strength',
        rest: '2–3 min rest',
        exercises: [
          { name: 'Back Squat', sets: '4×3 heavy + 1×8 back-off' },
          { name: 'Romanian Deadlift', sets: '4×5' },
          { name: 'Bulgarian Split Squat', sets: '3×8 each' },
          { name: 'Nordic Hamstring Curl', sets: '3×6' },
          { name: 'Hanging Leg Raise', sets: '3×15' },
          { name: 'Incline Treadmill Walk', sets: '20 min' },
        ],
      },
      {
        name: 'Day 2 — Upper Strength',
        rest: '2–3 min rest',
        exercises: [
          { name: 'Bench Press', sets: '4×3 heavy + 1×8 back-off' },
          { name: 'Barbell Row', sets: '5×5' },
          { name: 'Overhead Press', sets: '4×5' },
          { name: 'Weighted Pull-Ups', sets: '4×5' },
          { name: 'Cable Woodchop', sets: '3×12 each' },
          { name: 'KB Overhead Carry', sets: '3×40yd' },
        ],
      },
      {
        name: 'Day 3 — Full Body & Conditioning',
        rest: '2–3 min rest',
        exercises: [
          { name: 'Deadlift', sets: '4×3 heavy + 1×6 back-off' },
          { name: 'Hip Thrust', sets: '4×8 heavy' },
          { name: 'Weighted Dips', sets: '3×8' },
          { name: 'Lat Pulldown', sets: '3×10' },
          { name: 'Rollout to Pike', sets: '3×10' },
          { name: 'Assault Bike', sets: '8×20s on 40s off' },
        ],
      },
    ],
  },
};

const fiveDay = {
  1: {
    name: 'Phase 1',
    weeks: 'Weeks 1–4',
    days: [
      {
        name: 'Day 1 — Lower A (Squat)',
        rest: '90s rest',
        exercises: [
          { name: 'Back Squat', sets: '4×5' },
          { name: 'Romanian Deadlift', sets: '3×8' },
          { name: 'Leg Press', sets: '3×12' },
          { name: 'Hanging Knee Raise', sets: '3×12' },
          { name: 'Plank', sets: '3×45sec' },
          { name: 'Incline Treadmill Walk', sets: '15 min' },
        ],
      },
      {
        name: 'Day 2 — Upper A (Push)',
        rest: '90s rest',
        exercises: [
          { name: 'Bench Press', sets: '4×5' },
          { name: 'Overhead Press', sets: '4×6' },
          { name: 'Incline DB Press', sets: '3×10' },
          { name: 'Dips', sets: '3×10' },
          { name: 'Ab Wheel Rollout', sets: '3×10' },
          { name: 'Farmers Carry', sets: '3×40yd' },
        ],
      },
      {
        name: 'Day 3 — Conditioning & Core',
        rest: '60s rest',
        exercises: [
          { name: 'Assault Bike', sets: '6×20s on 40s off' },
          { name: 'KB Swing', sets: '4×15' },
          { name: 'Pallof Press', sets: '3×12 each' },
          { name: 'Hanging Leg Raise', sets: '3×12' },
          { name: 'Plank', sets: '3×45sec' },
          { name: 'Incline Treadmill Walk', sets: '20 min' },
        ],
      },
      {
        name: 'Day 4 — Lower B (Hinge)',
        rest: '2 min rest',
        exercises: [
          { name: 'Deadlift', sets: '4×5' },
          { name: 'Hip Thrust', sets: '4×10' },
          { name: 'Walking Lunges', sets: '3×10 each' },
          { name: 'Glute-Ham Raise', sets: '3×8' },
          { name: 'Cable Pull-Through', sets: '3×12' },
          { name: 'Ab Wheel Rollout', sets: '3×8' },
        ],
      },
      {
        name: 'Day 5 — Upper B (Pull)',
        rest: '90s rest',
        exercises: [
          { name: 'Weighted Pull-Ups', sets: '4×6' },
          { name: 'Barbell Row', sets: '4×6' },
          { name: 'Chest-Supported Row', sets: '3×10' },
          { name: 'Face Pull', sets: '3×15' },
          { name: 'Suitcase Carry', sets: '3×40yd each' },
          { name: 'Rowing Intervals', sets: '5×250m 90s rest' },
        ],
      },
    ],
  },
  2: {
    name: 'Phase 2',
    weeks: 'Weeks 5–8',
    days: [
      {
        name: 'Day 1 — Lower A (Squat)',
        rest: '90s rest',
        exercises: [
          { name: 'Back Squat', sets: '5×5' },
          { name: 'Romanian Deadlift', sets: '4×6' },
          { name: 'Goblet Squat', sets: '3×12' },
          { name: 'Glute Bridge', sets: '3×20' },
          { name: 'Hanging Leg Raise', sets: '3×12' },
          { name: 'Incline Treadmill Walk', sets: '20 min' },
        ],
      },
      {
        name: 'Day 2 — Upper A (Push)',
        rest: '75s rest',
        exercises: [
          { name: 'Bench Press', sets: '5×5' },
          { name: 'Overhead Press', sets: '4×6' },
          { name: 'Incline DB Press & Cable Row', sets: '3×10 each' },
          { name: 'Weighted Dip', sets: '3×8' },
          { name: 'Pallof Press', sets: '3×15 each' },
          { name: 'Farmers Carry', sets: '3×50yd' },
        ],
      },
      {
        name: 'Day 3 — Conditioning & Core',
        rest: '90s rest',
        exercises: [
          { name: 'Rowing Intervals', sets: '6×250m 90s rest' },
          { name: 'KB Complex', sets: '5 rounds: 6 swings, 6 goblet squat, 6 press' },
          { name: 'Ab Wheel Rollout', sets: '3×12' },
          { name: 'Cable Woodchop', sets: '3×12 each' },
          { name: 'Hanging Leg Raise', sets: '3×15' },
        ],
      },
      {
        name: 'Day 4 — Lower B (Hinge)',
        rest: '2 min rest',
        exercises: [
          { name: 'Deadlift', sets: '5×4' },
          { name: 'Hip Thrust', sets: '4×10 heavier' },
          { name: 'Bulgarian Split Squat', sets: '3×10 each' },
          { name: 'Nordic Hamstring Curl', sets: '3×6' },
          { name: 'Ab Wheel Rollout', sets: '3×12' },
          { name: 'Stair Climber', sets: '6×45s on 60s off' },
        ],
      },
      {
        name: 'Day 5 — Upper B (Pull)',
        rest: '90s rest',
        exercises: [
          { name: 'Weighted Pull-Ups', sets: '4×5' },
          { name: 'Barbell Row', sets: '4×6' },
          { name: 'Lat Pulldown', sets: '3×10' },
          { name: 'Face Pull', sets: '3×15' },
          { name: 'KB Overhead Carry', sets: '3×40yd each' },
          { name: 'Assault Bike', sets: '6×20s on 40s off' },
        ],
      },
    ],
  },
  3: {
    name: 'Phase 3',
    weeks: 'Weeks 9–12',
    days: [
      {
        name: 'Day 1 — Lower A (Squat)',
        rest: '2–3 min rest',
        exercises: [
          { name: 'Back Squat', sets: '4×3 heavy + 1×8 back-off' },
          { name: 'Romanian Deadlift', sets: '4×5' },
          { name: 'Bulgarian Split Squat', sets: '3×8 each' },
          { name: 'Nordic Curl', sets: '3×6' },
          { name: 'Weighted Leg Raise', sets: '3×12' },
          { name: 'Incline Treadmill Walk', sets: '20 min' },
        ],
      },
      {
        name: 'Day 2 — Upper A (Push)',
        rest: '2–3 min rest',
        exercises: [
          { name: 'Bench Press', sets: '4×3 heavy + 1×8 back-off' },
          { name: 'Overhead Press', sets: '4×5' },
          { name: 'Incline DB Press', sets: '3×8' },
          { name: 'Weighted Dip', sets: '3×8' },
          { name: 'Cable Rotation', sets: '3×12 each' },
          { name: 'Heavy Farmers Carry', sets: '4×50yd' },
        ],
      },
      {
        name: 'Day 3 — Conditioning & Core',
        rest: '90s rest',
        exercises: [
          { name: 'Assault Bike', sets: '8×20s on 40s off' },
          { name: 'DB Complex', sets: '4 rounds: 6 RDL, 6 row, 6 hang clean, 6 press' },
          { name: 'Rollout to Pike', sets: '3×10' },
          { name: 'Pallof Iso Hold', sets: '3×20sec each' },
          { name: 'Battle Ropes', sets: '6×30s on 30s off' },
        ],
      },
      {
        name: 'Day 4 — Lower B (Hinge)',
        rest: '2–3 min rest',
        exercises: [
          { name: 'Deadlift', sets: '4×3 heavy + 1×6 back-off' },
          { name: 'Hip Thrust', sets: '4×8 heavy' },
          { name: 'Single-Leg RDL', sets: '3×10 each' },
          { name: 'Leg Press (high foot)', sets: '3×12' },
          { name: 'Ab Wheel Rollout', sets: '3×12' },
          { name: 'Stair Climber', sets: '8×45s on 45s off' },
        ],
      },
      {
        name: 'Day 5 — Upper B (Pull)',
        rest: '2 min rest',
        exercises: [
          { name: 'Weighted Pull-Ups', sets: '4×4 max load' },
          { name: 'Barbell Row', sets: '5×5' },
          { name: 'Chest-Supported Row', sets: '3×8' },
          { name: 'Face Pull', sets: '3×15' },
          { name: 'Suitcase Carry', sets: '4×50yd each' },
          { name: 'Rowing Intervals', sets: '8×250m 90s rest' },
        ],
      },
    ],
  },
};

export { threeDay, fiveDay };
