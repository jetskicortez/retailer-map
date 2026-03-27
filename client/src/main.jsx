import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import SurveyMap from './SurveyMap.jsx';
import './index.css';

function Root() {
  const isSurvey =
    window.location.pathname === '/survey' ||
    new URLSearchParams(window.location.search).get('mode') === 'survey';
  return isSurvey ? <SurveyMap /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
