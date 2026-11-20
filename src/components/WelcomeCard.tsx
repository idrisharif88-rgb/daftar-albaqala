import { greeting, initialOf } from '../data/welcome';

// Top of Home: a round badge with the initial, «مساء الخير، إدريس 👋», and the
// store name as a pill. The name is the owner's own (Settings), else the store's.

interface Props {
  name: string;
  storeName: string;
}

const WelcomeCard: React.FC<Props> = ({ name, storeName }) => {
  const who = name || storeName;
  return (
    <div className="greet" role="status">
      <div className="greet__badge" aria-hidden="true">{initialOf(who)}</div>
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
