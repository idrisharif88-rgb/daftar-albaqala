import { useEffect, useState } from 'react';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonBackButton, IonButton,
  IonIcon, IonContent, IonFooter, useIonAlert,
} from '@ionic/react';
import { shareSocialOutline } from 'ionicons/icons';
import {
  loadNotes, storeNotes, saveNote, toggleDone, removeNote, sortedNotes, type Note,
} from '../data/updatesNotebook';
import { ShareCancelledError } from '../lib/shareTarget';
import './UpdatesNotebook.css';

// «دفتر التحديثات» — the owner's notes on what to add or fix, written while he
// uses the app. Copied from «خماسيات»: a note is a title + details; the circle
// marks it done; done notes fold away under «تمّت»; delete needs a second tap;
// the share button picks notes and sends them as text or PDF.

const dateText = (ts: number) =>
  new Date(ts).toLocaleDateString('ar-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });

const CHECK = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
);

interface EditorProps {
  note: Note | null;
  onSave: (n: { id?: string; title: string; text: string }) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
}

function NoteEditor({ note, onSave, onCancel, onDelete }: EditorProps) {
  const [title, setTitle] = useState(note?.title || '');
  const [text, setText] = useState(note?.text || '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="notebook-editor">
      <input
        className="notebook-input" value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="العنوان" dir="auto" autoFocus
      />
      <textarea
        className="notebook-textarea" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="التفاصيل" dir="auto" rows={5}
      />
      <div className="notebook-editor-actions">
        <button type="button" className="notebook-btn primary" onClick={() => onSave({ id: note?.id, title, text })}>حفظ</button>
        <button type="button" className="notebook-btn" onClick={onCancel}>إلغاء</button>
        {note && (
          <button
            type="button"
            className={`notebook-btn ${confirmDelete ? 'danger' : ''}`.trim()}
            onClick={() => (confirmDelete ? onDelete(note.id) : setConfirmDelete(true))}
          >
            {confirmDelete ? 'اضغط للتأكيد' : 'حذف'}
          </button>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  note: Note;
  onToggle: (id: string) => void;
  onEdit: (n: Note) => void;
  picking: boolean;
  picked: boolean;
  onPick: (id: string) => void;
}

// While sharing, the circle and the tap pick a note instead of finishing or editing it.
function NoteRow({ note, onToggle, onEdit, picking, picked, onPick }: RowProps) {
  if (picking) {
    return (
      <li className={`notebook-note picking ${picked ? 'picked' : ''}`.trim()}>
        <button type="button" className="notebook-check pick" onClick={() => onPick(note.id)} aria-pressed={picked} aria-label="اختر">
          {picked && CHECK}
        </button>
        <button type="button" className="notebook-note-body" onClick={() => onPick(note.id)}>
          {note.title && <strong>{note.title}</strong>}
          {note.text && <span className="notebook-note-text">{note.text}</span>}
        </button>
      </li>
    );
  }
  return (
    <li className={`notebook-note ${note.done ? 'done' : ''}`.trim()}>
      <button
        type="button" className="notebook-check" onClick={() => onToggle(note.id)}
        aria-pressed={note.done} aria-label={note.done ? 'أعد فتحها' : 'تمّت'}
      >
        {note.done && CHECK}
      </button>
      <button type="button" className="notebook-note-body" onClick={() => onEdit(note)}>
        {note.title && <strong>{note.title}</strong>}
        {note.text && <span className="notebook-note-text">{note.text}</span>}
        <span className="notebook-note-date">{dateText(note.createdAt)}</span>
      </button>
    </li>
  );
}

const UpdatesNotebook: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = not sharing
  const [busy, setBusy] = useState(false);
  const [presentAlert] = useIonAlert();

  const { open, done } = sortedNotes(notes);
  const all = [...open, ...done];
  const picking = picked !== null;
  const selected = picking ? all.filter((n) => picked.has(n.id)) : [];
  const allPicked = picking && selected.length === all.length;

  // Hardware back closes the editor, then the picking mode, before leaving.
  useEffect(() => {
    if (!editing && !picking) return undefined;
    const onBack = (ev: Event) => {
      (ev as CustomEvent).detail.register(20, () => {
        if (editing) setEditing(null);
        else setPicked(null);
      });
    };
    document.addEventListener('ionBackButton', onBack);
    return () => document.removeEventListener('ionBackButton', onBack);
  }, [editing, picking]);

  const apply = (change: (list: Note[]) => Note[]) => {
    const next = change(loadNotes());
    storeNotes(next);
    setNotes(next);
  };

  const pick = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const pickAll = () => setPicked(allPicked ? new Set() : new Set(all.map((n) => n.id)));

  const share = async (how: 'text' | 'pdf') => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      const { shareNotesText, shareNotesPdf } = await import('../lib/notebookShare');
      await (how === 'text' ? shareNotesText : shareNotesPdf)(selected);
    } catch (err) {
      if (!(err instanceof ShareCancelledError)) {
        presentAlert({
          header: 'تعذّرت المشاركة',
          message: err instanceof Error ? err.message : '',
          buttons: ['حسناً'],
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const rowProps = { onToggle: (id: string) => apply((l) => toggleDone(l, id)), onEdit: setEditing, picking, onPick: pick };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/settings" text="" />
          </IonButtons>
          <IonTitle>دفتر التحديثات</IonTitle>
          {!editing && !picking && all.length > 0 && (
            <IonButtons slot="end">
              <IonButton onClick={() => setPicked(new Set())} aria-label="مشاركة">
                <IonIcon slot="icon-only" icon={shareSocialOutline} />
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        <div className="notebook-card" dir="rtl">
          {editing ? (
            <NoteEditor
              note={editing === 'new' ? null : editing}
              onSave={(n) => { apply((l) => saveNote(l, n)); setEditing(null); }}
              onCancel={() => setEditing(null)}
              onDelete={(id) => { apply((l) => removeNote(l, id)); setEditing(null); }}
            />
          ) : !picking && (
            <button type="button" className="notebook-btn primary notebook-add" onClick={() => setEditing('new')}>
              + ملاحظة جديدة
            </button>
          )}

          {!editing && (
            <>
              {all.length === 0 && <p className="notebook-empty">لا ملاحظات بعد</p>}
              <ul className="notebook-list">
                {open.map((n) => <NoteRow key={n.id} note={n} picked={picking && picked.has(n.id)} {...rowProps} />)}
              </ul>
              {done.length > 0 && (
                <>
                  <button
                    type="button" className="notebook-done-toggle"
                    onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}
                  >
                    تمّت ({done.length}) {showDone ? '▲' : '▼'}
                  </button>
                  {(showDone || picking) && (
                    <ul className="notebook-list">
                      {done.map((n) => <NoteRow key={n.id} note={n} picked={picking && picked.has(n.id)} {...rowProps} />)}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </IonContent>

      {picking && !editing && (
        <IonFooter>
          <div className="notebook-share-bar" dir="rtl">
            <div className="notebook-share-row">
              <button type="button" className="notebook-done-toggle" onClick={pickAll}>
                {allPicked ? 'إلغاء الكل' : 'الكل'}
              </button>
              <span className="notebook-share-count">{selected.length} مختارة</span>
              <button type="button" className="notebook-done-toggle" onClick={() => setPicked(null)}>إلغاء</button>
            </div>
            <div className="notebook-share-row">
              <button type="button" className="notebook-btn" disabled={selected.length === 0 || busy} onClick={() => void share('text')}>
                نصّ
              </button>
              <button type="button" className="notebook-btn primary" disabled={selected.length === 0 || busy} onClick={() => void share('pdf')}>
                {busy ? '…' : 'PDF'}
              </button>
            </div>
          </div>
        </IonFooter>
      )}
    </IonPage>
  );
};

export default UpdatesNotebook;
