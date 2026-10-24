import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { defineCustomElements } from 'jeep-sqlite/loader';
import App from './App';
import { initAppScale } from './lib/appScale';
import { applyAppearance, initialAppearance } from './theme/appearance';

// The saved display size and the colour/night look go on <html> before the
// first paint, so the app does not open at one size or colour and jump.
initAppScale();
{
  const { accent, night } = initialAppearance();
  applyAppearance(accent, night);
}

// On the web, @capacitor-community/sqlite runs SQLite as WebAssembly (sql.js)
// through the <jeep-sqlite> web component. Register that component here; the
// actual web-store init happens lazily on first DB use (src/data/db.ts).
// On a real device the native SQLite is used and none of this matters.
if (Capacitor.getPlatform() === 'web') {
  defineCustomElements(window);
}

// Render immediately — the database initializes lazily, so a DB problem surfaces
// in the UI instead of leaving a blank screen.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
