import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { forgetDriveBackup } from '../data/driveBackup';
import * as api from './api';
import {
  getToken, setToken, clearToken, getPhone, setPhone, getDriveAllowed, setDriveAllowed,
  getPosAllowed, setPosAllowed, getPosStaffAllowed, setPosStaffAllowed, getStaff, setStaff, getPosNotesAllowed, setPosNotesAllowed,
  type StoredStaff,
} from './storage';
import { ensureLocalOwner } from '../data/owner';
import { isOwnerPhone } from '../config';
import { openLive } from './live';

/** Fired when the Watcher sends a sync request (SyncConsentPrompt listens). */
export const SYNC_REQUEST_EVENT = 'daftar:sync-request';
/** Fired when a chat message arrives or is read (ChatPage + the tab badge listen). */
export const CHAT_EVENT = 'daftar:chat';

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
  /** POS notes are switched on for this shop (developer, Watcher). */
  posNotesAllowed: boolean;
  /** The shopkeeper's answer to the server-sync request (owner only; null
   *  until the server has said). 'pending' = ask him. */
  syncConsent: 'none' | 'pending' | 'approved' | 'rejected' | null;
  /** Record his answer on the server; resolves once it is stored there. */
  answerSyncConsent: (approve: boolean) => Promise<void>;
  /** Re-read what this account may do (pull-to-refresh calls it). */
  refreshAccess: () => Promise<void>;
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
  const [posNotesAllowed, setPosNotesAllowedState] = useState<boolean>(getPosNotesAllowed);
  const [syncConsent, setSyncConsent] = useState<AuthState['syncConsent']>(null);
  const rememberNotes = (on: boolean) => {
    setPosNotesAllowed(on);
    setPosNotesAllowedState(on);
  };

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
    const next = { ...res.staff, store_name: res.store_name, manager_pin: res.manager_pin ?? null };
    setStaff(next);
    setStaffState(next);
    rememberNotes(res.notes_enabled === true);
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
    setPosNotesAllowedState(false);
    setSyncConsent(null);
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
  // What the account is allowed is re-read: at sign-in / launch, whenever the
  // app comes back to the screen, every minute while it is open, and on demand
  // (pull-to-refresh). So a change made from the Watcher or by the shop owner —
  // a sync request to approve, a permission, notes switched on — shows at once
  // instead of on the next launch.
  const staffRef = useRef(staff);
  staffRef.current = staff;
  const refreshAccess = useCallback(async (): Promise<void> => {
    if (!getToken()) return;
    if (staffRef.current) {
      try {
        const res = await api.staffMe();
        const next = { ...res.staff, store_name: res.store_name, manager_pin: res.manager_pin ?? null };
        setStaff(next);
        setStaffState(next);
        rememberNotes(res.notes_enabled === true);
      } catch (err) {
        if (err instanceof api.ApiError && (err.status === 401 || err.status === 403)) logout();
      }
      return;
    }
    try {
      const res = await api.me();
      rememberPhone(res.user.phone);
      setDriveAllowed(res.user.drive_backup === true);
      setDriveAllowedState(res.user.drive_backup === true);
      setPosAllowed(res.user.pos_enabled === true);
      setPosAllowedState(res.user.pos_enabled === true);
      setPosStaffAllowed(res.user.pos_staff_enabled === true);
      setPosStaffAllowedState(res.user.pos_staff_enabled === true);
      rememberNotes(res.user.pos_notes_enabled === true);
      setSyncConsent(res.user.sync_consent ?? null);
    } catch { /* offline: the last answer stands */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logout]);

  // The live line: a sync request or an access change from the Watcher, and
  // a new chat message, arrive at once (timers below are the fallback). The
  // owner listens on his channel, a staff member on theirs (chat only).
  const isStaff = staff !== null;
  useEffect(() => {
    if (!authed) return undefined;
    return openLive((event) => {
      if (event === 'chat') { window.dispatchEvent(new Event(CHAT_EVENT)); return; }
      void refreshAccess().then(() => {
        if (event === 'sync-request') window.dispatchEvent(new Event(SYNC_REQUEST_EVENT));
      });
    }, isStaff ? async () => (await api.staffLiveTicket()).ticket : undefined);
  }, [authed, isStaff, refreshAccess]);

  useEffect(() => {
    if (!authed) return undefined;
    void refreshAccess();
    const visible = () => document.visibilityState === 'visible';
    const onVisible = () => { if (visible()) void refreshAccess(); };
    document.addEventListener('visibilitychange', onVisible);
    const minute = setInterval(() => { if (visible()) void refreshAccess(); }, 60_000);
    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(minute); };
  }, [authed, refreshAccess]);

  const answerSyncConsent = useCallback(async (approve: boolean) => {
    const res = await api.answerSyncConsent(approve);
    setSyncConsent(res.sync_consent as AuthState['syncConsent']);
  }, []);

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
        posNotesAllowed: authed && posNotesAllowed,
        syncConsent: authed && !staff ? syncConsent : null,
        answerSyncConsent, refreshAccess,
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
