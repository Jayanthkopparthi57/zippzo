import React from 'react'
import ReactDOM from 'react-dom/client'
import StoreApp from './apps/StoreApp.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <StoreApp />
    </ToastProvider>
  </React.StrictMode>,
)
