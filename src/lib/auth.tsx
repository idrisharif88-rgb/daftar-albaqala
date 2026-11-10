import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { forgetDriveBackup } from '../data/driveBackup';
import * as api from './api';
import {
  getToken, setToken, clearToken, getPhone, setPhone, getDriveAllowed, setDriveAllowed,
  getPosAllowed, setPosAllowed, getPosStaffAllowed, setPosStaffAllowed, getStaff, setStaff,
  type StoredStaff,
} from './storage';
import { ensureLocalOwner } from '../data/owner';
import { isOwnerPhone } from '../config';

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
  /** The app owner's own account — unlocks owner-only tools. */
  isOwner: boolean;
  /** Google Drive backup granted to this account by the owner. */
  driveBackupAllowed: boolean;
  /** The point-of-sale section was switched on for this account (Watcher). */
  posAllowed: boolean;
  /** Staff accounts were switched on for this OWNER's shop (Watcher). */
  posStaffAllowed: boolean;
  /** Set when a STAFF member is signed in (not the owner): who, and what they
   *  may do. Null for the owner. */
  staff: StoredStaff | null;
  login: (phone: string, password: string) => Promise<void>;
  staffLogin: (phone: string, password: string) => Promise<void>;
  register: (phone: string, password: string, storeName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Seeded from storage so a refresh keeps the session. We don't yet decode the
  // token for the user object; it fills in on the next login/register.
  const [user, setUser] = useState<User | null>(null);
  const [authed, setAuthed] = useState<boolean>(() => getToken() !== null);
  const [phone, setPhoneState] = useState<string | null>(getPhone);
  const [driveAllowed, setDriveAllowedState] = useState<boolean>(getDriveAllowed);
  const [posAllowed, setPosAllowedState] = useState<boolean>(getPosAllowed);
  const [posStaffAllowed, setPosStaffAllowedState] = useState<boolean>(getPosStaffAllowed);
  const [staff, setStaffState] = useState<StoredStaff | null>(getStaff);

  const rememberPhone = (value: string) => {
    setPhone(value);
    setPhoneState(value);
  };

  const login = useCallback(async (phone: string, password: string) => {
    const res = await api.login(phone, password);
    setToken(res.token);
    rememberPhone(res.user.phone);
    setUser(res.user);
    // Wipe any previous grocer's local data on a user switch BEFORE we flip to
    // authenticated, so AutoSync pulls the new user into a clean store.
    await ensureLocalOwner(res.user.id);
    setAuthed(true);
  }, []);

  // A staff member of someone's shop. Their local store is keyed by their OWN
  // id, so a phone handed from the owner to a cashier (or between two cashiers)
  // starts clean and pulls that shop's POS data.
  const staffLogin = useCallback(async (phone: string, password: string) => {
    const res = await api.staffLogin(phone, password);
    setToken(res.token);
    const next = { ...res.staff, store_name: res.store_name };
    setStaff(next);
    setStaffState(next);
    await ensureLocalOwner(`staff:${res.staff.id}`);
    setAuthed(true);
  }, []);

  const register = useCallback(
    async (phone: string, password: string, storeName: string) => {
      const res = await api.register(phone, password, storeName);
      setToken(res.token);
      rememberPhone(res.user.phone);
      setUser(res.user);
      await ensureLocalOwner(res.user.id);
      setAuthed(true);
    },
    []
  );

  const logout = useCallback(() => {
    void forgetDriveBackup(); // the next person here must not back up into this one's Drive
    clearToken();
    setPhoneState(null);
    setDriveAllowed(false);
    setDriveAllowedState(false);
    setPosAllowed(false);
    setPosAllowedState(false);
    setPosStaffAllowedState(false);
    setStaffState(null);
    setUser(null);
    setAuthed(false);
  }, []);

  // Ask the server who this is on every launch: the phone (for a session signed
  // in before it was stored) and what the owner has granted the account, which
  // he can change from the Watcher at any time. Offline, the last answer stands.
  //
  // A STAFF session asks /auth/staff/me instead: what they may do can change at
  // any time. A refusal (401: disabled / new password; 403: the shop's staff
  // accounts switched off, or the shop suspended) signs them out — the server
  // refuses everything they would do anyway.
  useEffect(() => {
    if (!authed) return;
    if (staff) {
      api.staffMe().then((res) => {
        const next = { ...res.staff, store_name: res.store_name };
        setStaff(next);
        setStaffState(next);
      }).catch((err: unknown) => {
        if (err instanceof api.ApiError && (err.status === 401 || err.status === 403)) logout();
      });
      return;
    }
    api.me().then((res) => {
      rememberPhone(res.user.phone);
      setDriveAllowed(res.user.drive_backup === true);
      setDriveAllowedState(res.user.drive_backup === true);
      setPosAllowed(res.user.pos_enabled === true);
      setPosAllowedState(res.user.pos_enabled === true);
      setPosStaffAllowed(res.user.pos_staff_enabled === true);
      setPosStaffAllowedState(res.user.pos_staff_enabled === true);
    }).catch(() => undefined);
    // Only on sign-in / launch: `staff` changes when /auth/staff/me answers,
    // and re-asking then would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  return (
    <AuthContext.Provider
      value={{
        user, isAuthenticated: authed,
        // A staff member is never the owner, whatever phone was stored before.
        isOwner: authed && !staff && isOwnerPhone(phone),
        driveBackupAllowed: authed && !staff && driveAllowed,
        // Staff exist only to use the POS; the server gates it per request.
        posAllowed: authed && (staff !== null || posAllowed),
        posStaffAllowed: authed && !staff && posStaffAllowed,
        staff: authed ? staff : null,
        login, staffLogin, register, logout,
      }}
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
