import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { adminLogin, getToken, setToken, setUnauthorizedHandler } from './api';

interface AuthState {
  authed: boolean;
  login: (phone: string, password: string, code: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => !!getToken());

  const logout = () => {
    setToken(null);
    setAuthed(false);
  };

  // An expired admin token (12h) sends the owner back to the login screen.
  useEffect(() => setUnauthorizedHandler(logout), []);

  const login = async (phone: string, password: string, code: string) => {
    const { token } = await adminLogin(phone, password, code);
    setToken(token);
    setAuthed(true);
  };

  return <AuthContext.Provider value={{ authed, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
