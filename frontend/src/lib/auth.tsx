"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

import { api, tokenStore } from "./api";
import type { Me, Permission } from "./types";

export type Credentials = { company_code: string; employee_code: string; password: string };

type AuthState = {
  ready: boolean; // đã đọc token từ localStorage
  token: string | null;
  me: Me | undefined;
  loadingMe: boolean;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => void;
  /** Quyền LMS của người đang đăng nhập (theo vai trò; quản trị hệ thống có mọi quyền). */
  can: (code: Permission) => boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  // undefined trên server / lúc hydrate -> chưa biết đã đăng nhập hay chưa
  const stored = useSyncExternalStore(tokenStore.subscribe, tokenStore.get, () => undefined);
  const ready = stored !== undefined;
  const token = stored ?? null;

  const meQuery = useQuery({
    queryKey: ["me", token],
    queryFn: async () => (await api.get<Me>("/auth/me")).data,
    enabled: !!token,
    staleTime: 5 * 60_000,
  });

  const login = useCallback(
    async (credentials: Credentials) => {
      const { data } = await api.post<{ access_token: string }>("/auth/login", credentials);
      queryClient.clear();
      tokenStore.set(data.access_token);
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthState>(() => {
    const me = meQuery.data;
    const perms = new Set(me?.permissions ?? []);
    return {
      ready,
      token,
      me,
      loadingMe: !!token && meQuery.isPending,
      login,
      logout,
      can: (code) => !!me && perms.has(code),
    };
  }, [ready, token, meQuery.data, meQuery.isPending, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth phải nằm trong AuthProvider");
  return ctx;
}
