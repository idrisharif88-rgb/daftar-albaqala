import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButtons, IonBackButton, IonList, IonItem,
  IonLabel, IonText, IonBadge, IonFooter, IonTextarea, IonButton, IonIcon, IonNote, IonSpinner,
  useIonViewWillEnter, useIonViewWillLeave,
} from '@ionic/react';
import { sendOutline } from 'ionicons/icons';
import PosFooter from './PosFooter';
import { CHAT_EVENT, useAuth } from '../../lib/auth';
import {
  ApiError, chatMessages, chatRead, chatSend, chatThreads, type ChatMessage, type ChatThread,
} from '../../lib/api';
import { MESSAGE_MAX_CHARS } from './chatLimits';
import { refreshChatUnread } from './chat';
import { PosRefresher, RefreshButton, usePosRefresh } from './PosRefresh';

// «المحادثة» — private chat between the shop owner and each staff member.
// The owner sees a list (one conversation per member) and opens one; a member
// goes straight to their own conversation with the owner. Text only, online.
// A new message arrives AT ONCE over the live line (CHAT_EVENT); a slow timer
// is only the fallback for a broken line.

const POLL_MS = 30_000;
const hhmm = (iso: string) => {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`);
  const p = (n: number) => String(n).padStart(2, '0');
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const offline = (err: unknown) => err instanceof ApiError && err.status === 0;

/** The owner's list of conversations. */
const ThreadList: React.FC = () => {
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setThreads((await chatThreads()).threads);
      setError(null);
    } catch (err) {
      setError(offline(err) ? 'لا يوجد اتصال بالإنترنت.' : 'تعذّر تحميل المحادثات.');
    }
  }, []);
  useIonViewWillEnter(() => { void load(); void refreshChatUnread(); });
  useEffect(() => {
    const onChat = () => { void load(); };
    window.addEventListener(CHAT_EVENT, onChat);
    return () => window.removeEventListener(CHAT_EVENT, onChat);
  }, [load]);
  const pull = usePosRefresh(load);
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>المحادثة</IonTitle>
          <IonButtons slot="end"><RefreshButton busy={pull.busy} onClick={() => { void pull.run(); }} /></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <PosRefresher onRefresh={pull.run} />
        {error ? (
          <IonText color="danger"><p className="ion-text-center ion-padding">{error}</p></IonText>
        ) : threads === null ? (
          <div className="ion-text-center ion-padding"><IonSpinner name="crescent" /></div>
        ) : threads.length === 0 ? (
          <IonText color="medium"><p className="ion-text-center ion-padding">لا يوجد موظفون بعد.</p></IonText>
        ) : (
          <IonList>
            {threads.map((t) => (
              <IonItem key={t.staff_id} button detail routerLink={`/pos/chat/${t.staff_id}`}>
                <IonLabel>
                  <h2 style={{ fontWeight: 700 }}>{t.name}{t.disabled ? ' (موقوف)' : ''}</h2>
                  <p>{t.last_body ?? 'لا توجد رسائل بعد'}</p>
                </IonLabel>
                {t.unread > 0 && <IonBadge slot="end" color="danger">{t.unread}</IonBadge>}
              </IonItem>
            ))}
          </IonList>
        )}
      </IonContent>
      <PosFooter />
    </IonPage>
  );
};

/** One conversation. `staffId` = the member (owner), or 'me' (the member). */
const Thread: React.FC<{ staffId: string; title: string; back: boolean }> = ({ staffId, title, back }) => {
  const { staff } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const content = useRef<HTMLIonContentElement>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const count = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await chatMessages(staffId);
      setMessages(res.messages);
      setError(null);
      const unseen = res.messages.some((m) => m.from_staff !== (staff !== null) && !m.read_at);
      if (unseen) { await chatRead(staffId); void refreshChatUnread(); }
      if (res.messages.length !== count.current) {
        count.current = res.messages.length;
        setTimeout(() => { void content.current?.scrollToBottom(200); }, 50);
      }
    } catch (err) {
      setError(offline(err) ? 'لا يوجد اتصال بالإنترنت.' : 'تعذّر تحميل الرسائل.');
    }
  }, [staffId, staff]);

  // Re-read every few seconds while this conversation is on screen.
  useIonViewWillEnter(() => {
    void load();
    timer.current = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
  });
  useIonViewWillLeave(() => { if (timer.current) clearInterval(timer.current); timer.current = null; });
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => {
    const onChat = () => { void load(); };
    window.addEventListener(CHAT_EVENT, onChat);
    return () => window.removeEventListener(CHAT_EVENT, onChat);
  }, [load]);
  const pull = usePosRefresh(load);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await chatSend(staffId, body);
      setDraft('');
      await load();
    } catch (err) {
      setError(offline(err) ? 'لا يوجد اتصال بالإنترنت. لم تُرسل الرسالة.' : 'تعذّر الإرسال.');
    } finally {
      setSending(false);
    }
  };

  // A message is "mine" when it came from my side of the conversation.
  const mine = (m: ChatMessage) => m.from_staff === (staff !== null);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          {back && <IonButtons slot="start"><IonBackButton defaultHref="/pos/chat" text="رجوع" /></IonButtons>}
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end"><RefreshButton busy={pull.busy} onClick={() => { void pull.run(); }} /></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent ref={content} className="ion-padding">
        <PosRefresher onRefresh={pull.run} />
        {messages === null && !error ? (
          <div className="ion-text-center"><IonSpinner name="crescent" /></div>
        ) : messages && messages.length === 0 ? (
          <IonText color="medium"><p className="ion-text-center">لا توجد رسائل بعد. اكتب أول رسالة.</p></IonText>
        ) : (
          <div className="chat">
            {(messages ?? []).map((m) => (
              <div key={m.id} className={`chat__msg ${mine(m) ? 'chat__msg--mine' : 'chat__msg--theirs'}`}>
                <div className="chat__body">{m.body}</div>
                <div className="chat__meta">
                  <span dir="ltr">{hhmm(m.created_at)}</span>
                  {mine(m) && <span>{m.read_at ? ' · قُرئت' : ' · أُرسلت'}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {error && <IonNote color="danger" style={{ display: 'block', marginTop: 8 }}>{error}</IonNote>}
      </IonContent>
      <IonFooter>
        <IonToolbar>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '4px 8px' }}>
            <IonTextarea
              value={draft} autoGrow rows={1} maxlength={MESSAGE_MAX_CHARS} placeholder="اكتب رسالة…"
              onIonInput={(e) => setDraft(e.detail.value ?? '')} style={{ flex: 1 }}
            />
            <IonButton aria-label="إرسال" disabled={!draft.trim() || sending} onClick={() => { void send(); }}>
              {sending ? <IonSpinner name="crescent" /> : <IonIcon slot="icon-only" icon={sendOutline} />}
            </IonButton>
          </div>
        </IonToolbar>
      </IonFooter>
      <PosFooter />
    </IonPage>
  );
};

/** /pos/chat — the owner's list, or a member's own conversation. */
export const ChatPage: React.FC = () => {
  const { staff } = useAuth();
  return staff ? <Thread staffId="me" title="المحادثة مع صاحب المتجر" back={false} /> : <ThreadList />;
};

/** /pos/chat/:id — the owner inside one member's conversation. */
export const ChatThreadPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('محادثة');
  useEffect(() => {
    chatThreads().then((r) => {
      const t = r.threads.find((x) => x.staff_id === id);
      if (t) setName(t.name);
    }).catch(() => undefined);
  }, [id]);
  return <Thread staffId={id} title={name} back />;
};
