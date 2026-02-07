import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import FloatingControls from './components/FloatingControls';
import './index.css';

// Simple hash-based routing for main app vs floating controls
const isFloatingWindow = window.location.hash === '#/floating';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isFloatingWindow ? <FloatingControls /> : <App />}
  </React.StrictMode>
);
