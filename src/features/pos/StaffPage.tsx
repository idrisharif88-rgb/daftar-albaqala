import { useCallback, useRef, useState } from 'react';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonButton, IonList, IonItem,
  IonLabel, IonText, IonSpinner, IonModal, IonInput, IonInputPasswordToggle, IonNote, IonIcon,
  IonFab, IonFabButton, IonCheckbox, IonSelect, IonSelectOption, IonBadge, IonListHeader, IonToggle,
  useIonViewWillEnter, useIonToast, useIonRouter,
} from '@ionic/react';
import PosFooter from './PosFooter';
import { ICONS, ICON_LABELS } from './icons';
import {
  PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS, ROLE_PRESETS, STAFF_ROLES, isPermission, isStaffRole,
  usePosPermissions, type Permission, type StaffRole,
} from './permissions';
import { useAuth } from '../../lib/auth';
import { ApiError, addStaff, listStaff, updateStaff, type StaffMember } from '../../lib/api';
import { phoneInput } from '../../lib/digits';

// «الموظفون» — the shop's staff. Shown to the owner once the developer has
// switched staff accounts on for his shop, and to a member holding
// «إدارة الموظفين». ONLINE ONLY: a login is created on the server, and there is
// nothing to keep offline about it.
//
// A role is a PRESET: picking one ticks its permissions, and each tick can then
// be changed. The server enforces all of it — including that a member who
// manages staff can hand out only what they hold, and cannot change themselves
// or anyone holding more. The form mirrors those rules so it does not offer
// what would be refused.

/** The server's English refusals, said in Arabic. */
function arabicError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'حدث خطأ غير متوقع';
  if (err.status === 0) return 'لا يوجد اتصال بالإنترنت.';
  const m = err.message;
  if (m.includes('phone already in use')) return 'هذا الرقم مستخدم لحساب آخر.';
  if (m.includes('phone must be')) return 'رقم الهاتف غير صحيح.';
  if (m.includes('password must be')) return 'كلمة المرور من 6 أحرف على الأقل.';
  if (m.includes('name is required')) return 'الاسم مطلوب.';
  if (m.includes('cannot grant')) return 'لا يمكنك منح صلاحية لا تملكها.';
  if (m.includes('cannot change your own')) return 'لا يمكنك تعديل حسابك بنفسك.';
  if (m.includes('cannot change a member')) return 'هذا الموظف يملك صلاحيات لا تملكها.';
  if (m.includes('not enabled')) return 'حسابات الموظفين غير مفعّلة لهذا المتجر.';
  if (err.status === 402) return 'المزامنة مع الخادم متوقفة لهذا الحساب.';
  return m;
}

const StaffPage: React.FC = () => {
  const { staff: me } = useAuth();
  const can = usePosPermissions();
  const [list, setList] = useState<StaffMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const modal = useRef<HTMLIonModalElement>(null);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<StaffRole>('cashier');
  const [perms, setPerms] = useState<Set<Permission>>(new Set(ROLE_PRESETS.cashier));
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [presentToast] = useIonToast();
  const router = useIonRouter();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setList((await listStaff()).staff);
    } catch (err) {
      setLoadError(arabicError(err));
    }
  }, []);
  useIonViewWillEnter(() => { void load(); });

  /** What this person may hand out: everything for the owner, their own set for a member. */
  const grantable = (p: Permission) => can(p);
  /** May this person change that member at all? (the server's rules, mirrored) */
  const editable = (m: StaffMember) =>
    !me || (m.id !== me.id && m.permissions.filter(isPermission).every(grantable));

  const open = (m: StaffMember | null) => {
    setEditing(m);
    setName(m?.name ?? '');
    setPhone(m?.phone ?? '');
    setPassword('');
    const r: StaffRole = m && isStaffRole(m.role) ? m.role : 'cashier';
    setRole(r);
    setPerms(new Set(m ? m.permissions.filter(isPermission) : ROLE_PRESETS[r].filter(grantable)));
    setDisabled(m?.disabled ?? false);
    setError(null);
    void modal.current?.present();
  };

  const pickRole = (r: StaffRole) => {
    setRole(r);
    setPerms(new Set(ROLE_PRESETS[r].filter(grantable)));
  };
  const toggle = (p: Permission, on: boolean) => {
    setPerms((cur) => {
      const next = new Set(cur);
      if (on) next.add(p); else next.delete(p);
      return next;
    });
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError('الاسم مطلوب.'); return; }
    if (!editing && !phone.trim()) { setError('رقم الهاتف مطلوب.'); return; }
    if (!editing && password.length < 6) { setError('كلمة المرور من 6 أحرف على الأقل.'); return; }
    if (editing && password && password.length < 6) { setError('كلمة المرور من 6 أحرف على الأقل.'); return; }
    const permissions = PERMISSIONS.filter((p) => perms.has(p));
    setSaving(true);
    try {
      if (editing) {
        await updateStaff(editing.id, {
          name: name.trim(), role, permissions,
          ...(password ? { password } : {}),
          ...(disabled !== editing.disabled ? { disabled } : {}),
        });
      } else {
        await addStaff({ name: name.trim(), phone: phone.trim(), role, password, permissions });
      }
      await modal.current?.dismiss();
      await presentToast({ message: editing ? 'تم الحفظ' : 'تمت إضافة الموظف', duration: 1500, color: 'success' });
      await load();
    } catch (err) {
      setError(arabicError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <IonPage>
      <IonHeader><IonToolbar><IonTitle>الموظفون</IonTitle></IonToolbar></IonHeader>
      <IonContent>
        {loadError ? (
          <IonText color="danger"><p className="ion-text-center ion-padding">{loadError}</p></IonText>
        ) : list === null ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : list.length === 0 ? (
          <IonText color="medium">
            <p className="ion-text-center ion-padding">لا يوجد موظفون بعد. اضغط ➕ لإضافة أول موظف.</p>
          </IonText>
        ) : (
          <IonList>
            {list.map((m) => (
              <IonItem key={m.id} button={editable(m)} detail={editable(m)} onClick={() => { if (editable(m)) open(m); }}>
                <IonLabel>
                  <h2 style={{ fontWeight: 700 }}>{m.name}</h2>
                  <p>
                    {isStaffRole(m.role) ? ROLE_LABELS[m.role] : m.role} · <span dir="ltr">{m.phone}</span>
                  </p>
                </IonLabel>
                {m.disabled && <IonBadge slot="end" color="medium">موقوف</IonBadge>}
                {/* The owner's report on this member — owner only. */}
                {!me && (
                  <IonButton
                    slot="end" fill="clear" aria-label={ICON_LABELS.report}
                    onClick={(e) => { e.stopPropagation(); router.push(`/pos/staff/${m.id}/report`); }}
                  >
                    <IonIcon slot="icon-only" icon={ICONS.report} />
                  </IonButton>
                )}
              </IonItem>
            ))}
          </IonList>
        )}

        <IonFab slot="fixed" vertical="bottom" horizontal="start">
          <IonFabButton aria-label="إضافة موظف" onClick={() => open(null)}>
            <IonIcon icon={ICONS.add} />
          </IonFabButton>
        </IonFab>

        <IonModal ref={modal}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>{editing ? 'تعديل موظف' : 'موظف جديد'}</IonTitle>
              <IonButtons slot="end">
                <IonButton onClick={() => modal.current?.dismiss()}>إلغاء</IonButton>
              </IonButtons>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">الاسم</IonLabel>
              <IonInput value={name} maxlength={100} onIonInput={(e) => setName(e.detail.value ?? '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">رقم الهاتف (للدخول)</IonLabel>
              <IonInput
                type="tel" inputmode="tel" value={phone} disabled={!!editing} placeholder="7XXXXXXXX"
                onIonInput={(e) => setPhone(phoneInput(e.detail.value ?? ''))}
              />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">{editing ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور'}</IonLabel>
              <IonInput type="password" value={password} maxlength={128} onIonInput={(e) => setPassword(e.detail.value ?? '')}>
                <IonInputPasswordToggle slot="end" />
              </IonInput>
            </IonItem>
            <IonItem>
              <IonSelect
                label="الدور" value={role} interface="popover"
                onIonChange={(e) => { if (isStaffRole(e.detail.value)) pickRole(e.detail.value); }}
              >
                {STAFF_ROLES.map((r) => (
                  <IonSelectOption key={r} value={r}>{ROLE_LABELS[r]}</IonSelectOption>
                ))}
              </IonSelect>
            </IonItem>

            <IonListHeader><IonLabel>الصلاحيات</IonLabel></IonListHeader>
            {PERMISSIONS.map((p) => (
              <IonItem key={p} lines="none">
                <IonCheckbox
                  checked={perms.has(p)} disabled={!grantable(p)} labelPlacement="end" justify="start"
                  onIonChange={(e) => toggle(p, e.detail.checked)}
                >
                  {PERMISSION_LABELS[p]}
                </IonCheckbox>
              </IonItem>
            ))}

            {editing && (
              <IonItem lines="none" className="ion-margin-top">
                <IonToggle checked={disabled} color="danger" onIonChange={(e) => setDisabled(e.detail.checked)}>
                  إيقاف هذا الموظف
                </IonToggle>
              </IonItem>
            )}

            {error && <IonNote color="danger" className="ion-padding-start"><IonText>{error}</IonText></IonNote>}

            <IonButton expand="block" onClick={() => { void save(); }} disabled={saving} className="ion-margin-top">
              {saving ? <IonSpinner name="crescent" /> : 'حفظ'}
            </IonButton>
            {editing && (
              <IonText color="medium">
                <p style={{ fontSize: '.85rem' }}>
                  تغيير الصلاحيات يسري فوراً. تغيير كلمة المرور أو الإيقاف يُخرج الموظف من حسابه.
                </p>
              </IonText>
            )}
          </IonContent>
        </IonModal>
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

export default StaffPage;
