// The welcome at the top of Home: a round badge with the owner's initial and
// «صباح الخير / مساء الخير، <name> 👋». Always on, nothing to set (owner's
// decision, 2026-11-20: the greeting by time of day is enough).

/** «صباح الخير» before noon, «مساء الخير» after — on the phone's own clock. */
export function greeting(now = new Date()): string {
  return now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير';
}

/** The first letter shown in the badge; «؟» when there is no name yet. */
export function initialOf(name: string): string {
  const t = name.trim();
  return t ? Array.from(t)[0] : '؟';
}
