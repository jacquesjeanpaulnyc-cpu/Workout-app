import { useState } from 'react';
import { getSettings, saveSettings, getPhase, getPhaseColor } from '../data/storage';

export default function SettingsPage({ onClose }) {
  const [settings, setSettings] = useState(getSettings());
  const color = getPhaseColor(getPhase(settings.currentWeek));

  function update(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  function save() {
    saveSettings(settings);
    onClose();
  }

  const fields = [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'calorieTarget', label: 'Calorie Target', type: 'number' },
    { key: 'proteinTarget', label: 'Protein Target (g)', type: 'number' },
    { key: 'waterTarget', label: 'Water Target (oz)', type: 'number' },
    { key: 'currentWeek', label: 'Current Week (1–12)', type: 'number', min: 1, max: 12 },
  ];

  return (
    <div className="fixed inset-0 bg-bg z-50 overflow-y-auto">
      <div className="max-w-[480px] mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-lg font-bold">Settings</h1>
          <button onClick={onClose} className="text-gray-light text-2xl">
            ×
          </button>
        </div>

        <div className="space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="rounded-xl p-4" style={{ backgroundColor: '#111111' }}>
              <label className="text-xs text-gray-light block mb-2">{f.label}</label>
              <input
                type={f.type}
                value={settings[f.key]}
                onChange={(e) =>
                  update(
                    f.key,
                    f.type === 'number' ? parseInt(e.target.value, 10) || 0 : e.target.value
                  )
                }
                min={f.min}
                max={f.max}
                className="w-full bg-bg rounded-lg px-3 py-2 text-sm text-white border border-gray-dark focus:outline-none focus:border-gray-light"
              />
            </div>
          ))}

          {/* Split selector */}
          <div className="rounded-xl p-4" style={{ backgroundColor: '#111111' }}>
            <label className="text-xs text-gray-light block mb-2">Program Split</label>
            <div className="flex gap-2">
              {[3, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => update('split', s)}
                  className="flex-1 py-2 rounded-lg text-sm font-bold transition-all"
                  style={{
                    backgroundColor: settings.split === s ? color : '#0D0D0D',
                    color: settings.split === s ? '#fff' : '#888',
                    border: `1px solid ${settings.split === s ? color : '#333'}`,
                  }}
                >
                  {s}-Day
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={save}
          className="w-full mt-6 py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
          style={{ backgroundColor: color }}
        >
          Save Settings
        </button>
      </div>
    </div>
  );
}
