// One host for the whole app; screens re-render when the plugin list changes.
// Én vert for hele appen; skjermene tegnes på nytt når pluginlisten endres.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PluginHost, blobLoader, localStore } from './pluginHost';
import { capabilities } from './capabilities';

interface Ctx { host: PluginHost; ready: boolean; changed: () => void }
const HostCtx = createContext<Ctx | null>(null);

export function HostProvider({ children }: { children: ReactNode }) {
  const host = useMemo(() => new PluginHost(localStore, blobLoader, capabilities), []);
  const [ready, setReady] = useState(false);
  const [, setTick] = useState(0);
  const changed = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => { host.loadAll().then(() => setReady(true)); }, [host]);
  return <HostCtx.Provider value={{ host, ready, changed }}>{children}</HostCtx.Provider>;
}
export const useHost = () => {
  const c = useContext(HostCtx);
  if (!c) throw new Error('useHost outside HostProvider');
  return c;
};
