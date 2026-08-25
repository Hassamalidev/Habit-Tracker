import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import { Spinner, ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { ApiError } from "./lib/api";
import { Dashboard } from "./pages/Dashboard";
import { GroupChat } from "./pages/GroupChat";
import { Groups } from "./pages/Groups";
import { HabitDetail } from "./pages/HabitDetail";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Tracker } from "./pages/Tracker";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // A rejected token will never succeed on retry; a cold Render instance will.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

function Routed() {
  const { user, loading } = useAuth();

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Signing you in" />
      </div>
    );

  if (!user) return <Login />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Tracker />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/habit/:habitId" element={<HabitDetail />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/groups/:groupId" element={<GroupChat />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CommandPalette />
    </AppShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Routed />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
