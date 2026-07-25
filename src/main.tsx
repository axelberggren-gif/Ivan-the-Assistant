import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

// PWA service worker (ADR-0004). `registerType: 'autoUpdate'` in vite.config
// means this registration also reloads the page once a new worker takes
// control, so an installed Ivan never runs an old bundle against newly
// revalidated data. A no-op in dev and when the browser has no SW support.
registerSW({ immediate: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
