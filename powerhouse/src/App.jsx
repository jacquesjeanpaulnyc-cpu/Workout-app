import { useState } from 'react';
import HomeTab from './components/HomeTab';
import WorkoutTab from './components/WorkoutTab';
import FoodTab from './components/FoodTab';
import WaterTab from './components/WaterTab';
import SettingsPage from './components/SettingsPage';
import { getSettings, getPhase, getPhaseColor } from './data/storage';
import './index.css';

const tabs = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'workout',
    label: 'Workout',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6.5 6.5h-3a1 1 0 00-1 1v9a1 1 0 001 1h3" />
        <path d="M17.5 6.5h3a1 1 0 011 1v9a1 1 0 01-1 1h-3" />
        <rect x="6.5" y="4" width="4" height="16" rx="1" />
        <rect x="13.5" y="4" width="4" height="16" rx="1" />
        <line x1="10.5" y1="12" x2="13.5" y2="12" />
      </svg>
    ),
  },
  {
    id: 'food',
    label: 'Food',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8h1a4 4 0 010 8h-1" />
        <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    ),
  },
  {
    id: 'water',
    label: 'Water',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />
      </svg>
    ),
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [showSettings, setShowSettings] = useState(false);
  const [key, setKey] = useState(0);

  const settings = getSettings();
  const phase = getPhase(settings.currentWeek);
  const color = getPhaseColor(phase);

  function handleCloseSettings() {
    setShowSettings(false);
    setKey((k) => k + 1);
  }

  return (
    <div className="max-w-[480px] mx-auto min-h-screen bg-bg relative" key={key}>
      {/* Header */}
      <div className="flex justify-between items-center p-4 sticky top-0 bg-bg z-40">
        <h1 className="text-lg font-bold tracking-wider" style={{ color }}>
          POWERHOUSE
        </h1>
        <button
          onClick={() => setShowSettings(true)}
          className="text-gray-light hover:text-white transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Tab content */}
      <div className="min-h-[calc(100vh-120px)]">
        {activeTab === 'home' && <HomeTab />}
        {activeTab === 'workout' && <WorkoutTab />}
        {activeTab === 'food' && <FoodTab />}
        {activeTab === 'water' && <WaterTab />}
      </div>

      {/* Bottom navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div
          className="max-w-[480px] mx-auto flex border-t border-gray-dark"
          style={{ backgroundColor: '#0D0D0D' }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 flex flex-col items-center py-3 gap-1 transition-all"
              style={{ color: activeTab === tab.id ? color : '#555' }}
            >
              {tab.icon}
              <span className="text-[10px]">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Settings overlay */}
      {showSettings && <SettingsPage onClose={handleCloseSettings} />}
    </div>
  );
}
