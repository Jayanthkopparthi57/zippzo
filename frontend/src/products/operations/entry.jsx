import React from 'react'
import ReactDOM from 'react-dom/client'
import '../../index.css'
import StoreApp from '../../apps/StoreApp.jsx'
import { ToastProvider } from '../../components/ui/Toast.jsx'

// WMS product entry for the warehouse web console and floor app.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <StoreApp />
    </ToastProvider>
  </React.StrictMode>,
)
