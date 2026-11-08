"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { auth, getToken, setToken, clearToken } from "@/lib/api";

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  passwordInitialized: boolean;
  loginWithPassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  passwordInitialized: true,
  loginWithPassword: async () => {},
  logout: async () => {},
  refreshAuth: async () => {},
});

export function AuthProvider({
  children,
  initialAuthenticated = false,
  initialPasswordInitialized = true,
  initialToken = "",
}: {
  children: React.ReactNode;
  initialAuthenticated?: boolean;
  initialPasswordInitialized?: boolean;
  initialToken?: string;
}) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(initialAuthenticated);
  const [passwordInitialized, setPasswordInitialized] = useState<boolean>(initialPasswordInitialized);
  const [isLoading, setIsLoading] = useState<boolean>(!initialAuthenticated);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await auth.status();
      setPasswordInitialized(res.password_initialized);
      setIsAuthenticated(res.authenticated);
      if (!res.authenticated) {
        clearToken();
      }
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialAuthenticated && initialToken) {
      setToken(initialToken);
      setIsAuthenticated(true);
      setIsLoading(false);
    } else if (getToken()) {
      refreshAuth();
    } else {
      auth
        .status()
        .then((res) => {
          setPasswordInitialized(res.password_initialized);
          setIsAuthenticated(res.authenticated);
        })
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }
  }, [initialAuthenticated, initialToken, refreshAuth]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setIsAuthenticated(false);
      setIsLoading(false);
    };
    window.addEventListener("miniclassisland:unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("miniclassisland:unauthorized", handleUnauthorized);
    };
  }, []);

  const handleLogin = useCallback(async (password: string) => {
    const res = await auth.loginWithPassword(password);
    if (res.access_token) {
      setToken(res.access_token);
    }
    setPasswordInitialized(true);
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(async () => {
    await auth.logout();
    setIsAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        passwordInitialized,
        loginWithPassword: handleLogin,
        logout: handleLogout,
        refreshAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
