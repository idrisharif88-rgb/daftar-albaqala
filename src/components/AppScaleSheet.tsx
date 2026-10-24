import { useMemo } from 'react';
import { IonModal } from '@ionic/react';
import { scaleSteps, DEFAULT_SCALE } from '../lib/appScale';
import './AppScaleSheet.css';

interface Props {
  isOpen: boolean;
  scale: number;
  onChange: (scale: number) => void;
  onClose: () => void;
}

/**
 * «حجم العرض» — a stepped slider with a preview above it. Copied from
 * «خماسيات». The whole app, this dialog included, changes as the slider moves.
 */
const AppScaleSheet: React.FC<Props> = ({ isOpen, scale, onChange, onClose }) => {
  // The steps depend on the device: a phone goes to 110, a tablet to 155.
  const steps = useMemo(() => scaleSteps(), []);
  const last = steps.length - 1;
  const index = Math.max(0, steps.indexOf(scale));
  const step = (delta: number) => onChange(steps[Math.min(last, Math.max(0, index + delta))]);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} className="app-scale-modal">
      <div className="app-scale-dialog" dir="rtl">
        <div className="app-scale-head">
          <h2>حجم العرض</h2>
          <button type="button" className="app-scale-close" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>

        <div className="app-scale-preview" aria-hidden="true">
          <p className="app-scale-sample">الحاج علي — تسديد دفعة</p>
          <div className="app-scale-preview-row">
            <span className="app-scale-chip">5,000 ريال</span>
            <span className="app-scale-dot">3</span>
          </div>
        </div>

        <div className="app-scale-slider" dir="ltr">
          <button type="button" className="app-scale-end small" onClick={() => step(-1)} disabled={index === 0} aria-label="أصغر">ا</button>
          <div className="app-scale-track">
            <div className="app-scale-ticks">
              {steps.map((s, i) => <span key={s} className={i <= index ? 'on' : ''} />)}
            </div>
            <input
              type="range"
              min={0}
              max={last}
              step={1}
              value={index}
              onChange={(e) => onChange(steps[Number(e.target.value)])}
              aria-label="حجم العرض"
              aria-valuetext={`${scale}%`}
              style={{ '--fill': `${(index / last) * 100}%` } as React.CSSProperties}
            />
          </div>
          <button type="button" className="app-scale-end large" onClick={() => step(1)} disabled={index === last} aria-label="أكبر">ا</button>
        </div>

        <div className="app-scale-foot">
          <span className="app-scale-value">{scale}%</span>
          <button
            type="button" className="app-scale-reset"
            onClick={() => onChange(DEFAULT_SCALE)} disabled={scale === DEFAULT_SCALE}
          >
            حجم الهاتف
          </button>
        </div>
      </div>
    </IonModal>
  );
};

export default AppScaleSheet;
