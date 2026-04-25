import React from 'react'
import { createRoot } from 'react-dom/client'
import './mockApi'    // Auto-install mock window.akabiz nếu không chạy trong Electron
import App from './App'
import './index.css'

const root = createRoot(document.getElementById('root')!)
root.render(<React.StrictMode><App /></React.StrictMode>)
