import { IonButton, IonIcon } from '@ionic/react';
import { ICONS, ICON_LABELS, type IconName } from './icons';

/** A button that shows only an icon. It always carries its name — a screen
 *  reader announces it, and a mouse hover shows it — so «icon only» never means
 *  «unlabelled». */
const IconButton: React.FC<{
  name: IconName;
  onClick?: () => void;
  routerLink?: string;
  active?: boolean;
  disabled?: boolean;
  /** Overrides the default name (e.g. «إضافة منتج لليوم»). */
  label?: string;
  slot?: string;
  fill?: 'clear' | 'solid' | 'outline';
  style?: React.CSSProperties;
}> = ({ name, label, active, fill, ...rest }) => {
  const text = label ?? ICON_LABELS[name];
  return (
    <IonButton
      {...rest}
      fill={fill ?? (active === undefined ? undefined : active ? 'solid' : 'clear')}
      aria-label={text}
      title={text}
      routerDirection={rest.routerLink ? 'root' : undefined}
    >
      <IonIcon slot="icon-only" icon={ICONS[name]} />
    </IonButton>
  );
};

export default IconButton;
