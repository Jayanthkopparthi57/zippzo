import React from 'react'
import ReactDOM from 'react-dom/client'
import RiderApp from './apps/RiderApp.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <RiderApp />
    </ToastProvider>
  </React.StrictMode>,
)
