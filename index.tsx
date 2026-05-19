import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import BigScreenDashboard from './components/BigScreenDashboard';

const isBigScreen =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('screen') === 'tv';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {isBigScreen ? <BigScreenDashboard /> : <App />}
  </React.StrictMode>
);