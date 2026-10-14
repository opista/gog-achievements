import ReactDOM from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import { App } from './App';
import { getDesktopApi } from './api';
import './styles.css';

const element = document.getElementById('root');
if (!element) throw new Error('The application root is missing.');
const root = ReactDOM.createRoot(element);
void getDesktopApi()
  .then((api) => {
    const theme = new URLSearchParams(location.search).get('theme');
    if (
      api.isDemo &&
      !navigator.userAgent.includes('Electron') &&
      (theme === 'light' || theme === 'dark')
    )
      document.documentElement.dataset.demoTheme = theme;
    root.render(<App api={api} />);
  })
  .catch((error: unknown) =>
    root.render(
      <main className="bridge-error">
        <h1>GOG Achievements</h1>
        <p role="alert">
          {error instanceof Error ? error.message : 'The desktop bridge is unavailable.'}
        </p>
        <a href="?demo=1">Open browser demo with sample data</a>
      </main>,
    ),
  );
