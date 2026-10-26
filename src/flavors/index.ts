import { contractor } from './contractor';
import { grocery } from './grocery';
import type { Flavor } from './types';

export type { Flavor, FlavorId } from './types';

/** Every build — so a contact synced from the OTHER app is still understood
 *  (and kept intact), even though this build never shows it. */
export const ALL_FLAVORS: Flavor[] = [grocery, contractor];

/** This build. `VITE_FLAVOR` is fixed when the app is built; unset = grocery,
 *  so every existing build command keeps producing the app on Play today. */
export const FLAVOR: Flavor =
  ALL_FLAVORS.find((f) => f.id === import.meta.env.VITE_FLAVOR) ?? grocery;
