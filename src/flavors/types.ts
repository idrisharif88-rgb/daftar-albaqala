import type { ContactRole, RoleDef } from '../data/roles';
import type { Accent } from '../theme/appearance';

// One build of the app — its name, its words, the kinds of contact it keeps.
//
// Both builds share every screen, the database and the server; a flavor holds
// only what makes them different. It is chosen at BUILD time (`VITE_FLAVOR`),
// never at runtime, so a grocer's phone can never be switched into the
// contractor's vocabulary by a setting.
export type FlavorId = 'grocery' | 'contractor';

export interface Flavor {
  id: FlavorId;
  /** The app's name — splash, lock screen, exit prompt, page title. */
  appName: string;
  /** The line under the name on the opening screen. */
  tagline: string;
  /** The line under the name on the login screen. */
  loginTag: string;
  /** One sentence on the signed-out welcome screen: what the app does. */
  pitch: string;
  /**
   * A self-contained opening scene in `public/`, played instead of the basket,
   * and how long it holds the screen. Android plays the same file natively
   * (NativeSplash.java, switched on by the flavor's `scene_splash` resource).
   */
  scene?: { src: string; ms: number };
  /** The colours Settings cycles through; the first is the default. One entry
   *  = a fixed brand colour, and Settings hides the «لون التطبيق» row. */
  accents: Accent[];
  /** Solid brand colour for documents (the Excel header row). */
  brandColor: string;
  /**
   * The Google Drive backup's file name. Both apps share one Google Cloud
   * project, and Drive's hidden app folder belongs to the PROJECT, not the app —
   * so with one name each app's daily backup overwrote the other's.
   */
  driveBackupFile: string;
  /**
   * Where this app keeps the store and owner name in the synced settings. Each
   * app has its own pair, so one account used in both never signs a
   * contractor's message with the grocery's name (or the other way round).
   */
  nameKeys: { store: string; owner: string };
  /**
   * The contact kinds this build offers and SHOWS, in tab order. Each build
   * has its own role codes, so one account used in both apps keeps two books
   * that never mix: a contact is visible only in the build that owns its role.
   */
  roles: RoleDef[];
  defaultRole: ContactRole;
  /** Roles that get a price list + invoices (a shop the owner buys from). */
  catalogRoles: ContactRole[];
  /** Roles whose single entries go out as a numbered «إشعار حركة». */
  noticeRoles: ContactRole[];
}
