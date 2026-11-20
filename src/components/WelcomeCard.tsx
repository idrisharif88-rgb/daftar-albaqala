import { greeting, initialOf, type Welcome } from '../data/welcome';

// Top of Home: «مساء الخير، إدريس 👋» beside a round badge with the initial.
// The name is the owner's own (Settings), else the store's; the second line
// is the owner's own text, else today's date. Hidden when switched off.

interface Props {
  welcome: Welcome;
  name: string;
  storeName: string;
}

function today(): string {
  return new Date().toLocaleDateString('ar', {
    weekday: 'long', day: 'numeric', month: 'long', numberingSystem: 'latn',
  });
}

const WelcomeCard: React.FC<Props> = ({ welcome, name, storeName }) => {
  if (!welcome.show) return null;
  const who = name || storeName;
  return (
    <div className="welcome" role="status">
      <div className="welcome__badge" aria-hidden="true">{initialOf(who)}</div>
      <div className="welcome__text">
        <div className="welcome__hello">
          {greeting()}{who ? `، ${who}` : ''} 👋
        </div>
        <div className="welcome__line">{welcome.text || today()}</div>
      </div>
      {storeName && name && <span className="welcome__store">{storeName}</span>}
    </div>
  );
};

export default WelcomeCard;
