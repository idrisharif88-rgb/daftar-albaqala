import React, { createContext, useContext, useState, useCallback } from 'react';
import * as api from './api';
import { getToken, setToken, clearToken } from './storage';
import { ensureLocalOwner } from '../data/owner';

// App-wide auth state. Holds the current session (JWT + user) and exposes
// login / register / logout. The token is persisted via storage.ts so a
// returning user stays signed in.

interface User {
  id: string;
  phone: string;
  store_name: string | null;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, storeName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Seeded from storage so a refresh keeps the session. We don't yet decode the
  // token for the user object; it fills in on the next login/register.
  const [user, setUser] = useState<User | null>(null);
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await api.login(phone, password);
    setToken(res.token);
    setUser(res.user);
    // Wipe any previous grocer's local data on a user switch BEFORE we flip to
    // authenticated, so AutoSync pulls the new user into a clean store.
    await ensureLocalOwner(res.user.id);
    setAuthed(true);
  }, []);

  const register = useCallback(
    async (phone: string, password: string, storeName: string) => {
      const res = await api.register(phone, password, storeName);
      setToken(res.token);
      setUser(res.user);
      await ensureLocalOwner(res.user.id);
      setAuthed(true);
    },
    []
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setAuthed(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: authed, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
