import { IonIcon, IonModal } from '@ionic/react';
import { trashOutline } from 'ionicons/icons';

// A centred «are you sure?» card for destructive acts (owner, 2026-11-21):
// a red mark, the question, what is kept and what goes, then two clear
// buttons — red to delete, green to keep. Keep is the safe default: it is
// what the back button and a tap outside do.

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DangerConfirm: React.FC<Props> = ({
  open, title, message, confirmText = 'حذف', cancelText = 'إبقاء', onConfirm, onCancel,
}) => (
  <IonModal isOpen={open} onDidDismiss={onCancel} className="danger-modal">
    <div className="danger" role="alertdialog" aria-labelledby="danger-title" aria-describedby="danger-msg">
      <div className="danger__mark" aria-hidden="true"><IonIcon icon={trashOutline} /></div>
      <h2 id="danger-title">{title}</h2>
      <p id="danger-msg">{message}</p>
      <div className="danger__btns">
        <button type="button" className="danger__keep" onClick={onCancel}>{cancelText}</button>
        <button type="button" className="danger__go" onClick={onConfirm}>{confirmText}</button>
      </div>
    </div>
  </IonModal>
);

export default DangerConfirm;
