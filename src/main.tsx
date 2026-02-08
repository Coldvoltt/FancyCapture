import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FloatingControls from './components/FloatingControls';
import CameraBubble from './components/CameraBubble';
import './index.css';

// Simple hash-based routing for main app vs floating windows
const hash = window.location.hash;
const isFloatingWindow = hash === '#/floating';
const isCameraBubble = hash === '#/camera-bubble';

function Root() {
  if (isCameraBubble) return <CameraBubble />;
  if (isFloatingWindow) return <FloatingControls />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
