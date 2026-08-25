import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api, getToken, setToken } from "./api";
import { guessTimezone } from "./date";
import type { AuthResponse, User } from "./types";

interface AuthValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => void;
  updateUser: (patch: Partial<Pick<User, "display_name" | "timezone" | "week_start">>) =>
    Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on boot: a stored token is only a claim until /me agrees.
  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/api/auth/me")
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => setToken(null))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 anywhere in the app unwinds to the sign-in screen.
  useEffect(() => {
    const onSignedOut = () => setUser(null);
    window.addEventListener("habit:signed-out", onSignedOut);
    return () => window.removeEventListener("habit:signed-out", onSignedOut);
  }, []);

  const adopt = useCallback((response: AuthResponse) => {
    setToken(response.access_token);
    setUser(response.user);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      adopt(
        await api.post<AuthResponse>(
          "/api/auth/login",
          { email, password },
          false,
        ),
      );
    },
    [adopt],
  );

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      adopt(
        await api.post<AuthResponse>(
          "/api/auth/register",
          {
            email,
            password,
            display_name: displayName,
            timezone: guessTimezone(),
          },
          false,
        ),
      );
    },
    [adopt],
  );

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback(
    async (patch: Partial<Pick<User, "display_name" | "timezone" | "week_start">>) => {
      setUser(await api.patch<User>("/api/auth/me", patch));
    },
    [],
  );

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, updateUser }),
    [user, loading, signIn, signUp, signOut, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
