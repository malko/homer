import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SetupPage, LoginPage, ChangePasswordPage } from './pages/Auth';
import { ProjectsPage } from './pages/Projects';
import { TerminalPage } from './pages/TerminalPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { status, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading...
      </div>
    );
  }

  if (!status?.authenticated) {
    return <Navigate to="/login" replace />;
  }

  if (status.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { status, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading...
      </div>
    );
  }

  if (!status?.authenticated) {
    return <>{children}</>;
  }

  if (status.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <Navigate to="/" replace />;
}

function InitialRoute() {
  const { status, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading...
      </div>
    );
  }

  if (status?.authenticated) {
    return <Navigate to="/projects" replace />;
  }

  if (status?.needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { status } = useAuth();

  return (
    <Routes>
      <Route path="/" element={<InitialRoute />} />
      <Route
        path="/login"
        element={
          <AuthRoute>
            <LoginPage />
          </AuthRoute>
        }
      />
      <Route
        path="/setup"
        element={
          status?.needsSetup ? (
            <SetupPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/change-password"
        element={
          status?.mustChangePassword ? (
            <ChangePasswordPage />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/terminal"
        element={
          <ProtectedRoute>
            <TerminalPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <ProjectsPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
