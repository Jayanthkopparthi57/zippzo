import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider, useAuth } from './context/AuthContext'
import AuthGate from './apps/AuthGate'
import DsConsoleApp from './ds-console/App.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'
import './styles/darkstore.css'

function DarkStoreRoot() {
  const { user, logout } = useAuth();
  return <DsConsoleApp user={user} logout={logout} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider appKey="darkstore">
        <AuthGate appKey="darkstore">
          <DarkStoreRoot />
        </AuthGate>
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>,
)
