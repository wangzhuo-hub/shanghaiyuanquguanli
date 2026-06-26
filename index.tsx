import React from 'react';
import ReactDOM from 'react-dom/client';

const App = React.lazy(() => import('./App'));
const BigScreenDashboard = React.lazy(() => import('./components/BigScreenDashboard'));

const isBigScreen =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('screen') === 'tv';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const RootApp = isBigScreen ? BigScreenDashboard : App;

root.render(
  <React.StrictMode>
    <React.Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#64748b',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          Loading...
        </div>
      }
    >
      <RootApp />
    </React.Suspense>
  </React.StrictMode>
);
