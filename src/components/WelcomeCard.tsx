import { greeting, initialOf } from '../data/welcome';
import { useBrandLogo } from '../lib/brandLogo';

// Top of Home: a round badge, «مساء الخير، إدريس 👋», and the store name as a
// pill. The badge is the shop's own logo when the developer set one (Watcher),
// else the first letter of the name — the owner's own (Settings), else the store's.

interface Props {
  name: string;
  storeName: string;
}

const WelcomeCard: React.FC<Props> = ({ name, storeName }) => {
  const logo = useBrandLogo();
  const who = name || storeName;
  return (
    <div className="greet" role="status">
      {logo ? (
        <img className="greet__logo" src={logo} alt={storeName || 'شعار المتجر'} />
      ) : (
        <div className="greet__badge" aria-hidden="true">{initialOf(who)}</div>
      )}
      <div className="greet__text">
        <div className="greet__hello">
          {greeting()}{who ? `، ${who}` : ''} 👋
        </div>
      </div>
      {storeName && name && <span className="greet__store">{storeName}</span>}
    </div>
  );
};

export default WelcomeCard;
