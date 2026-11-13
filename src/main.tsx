import '@fontsource/barlow/latin-400.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/app.css';
import { render } from 'preact';
import { App } from './app/App';
import { startThemeSync } from './app/store';
import { errorMessage } from './lib/errors';
import { notify } from './ui/toast';

startThemeSync();

// Surface anything unexpected instead of failing silently.
addEventListener('unhandledrejection', (event) => {
  notify(`Unexpected error: ${errorMessage(event.reason)}`, 'error');
});

const root = document.getElementById('app');
if (root) render(<App />, root);
