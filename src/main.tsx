import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Blog from './Blog';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname==='/entrar'||window.location.pathname==='/app'||['empresa','ambiente','recovery'].some(key=>new URLSearchParams(window.location.search).has(key))?<App/>:<Blog/>}</React.StrictMode>);
