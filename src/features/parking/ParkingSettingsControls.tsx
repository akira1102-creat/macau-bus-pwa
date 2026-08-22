import { useState } from 'react';

import type { LocalPreferences } from '../../infra/local-preferences';
import { messages } from '../../i18n/messages';

export interface ParkingSettingsControlsProps {
  preferences: LocalPreferences;
}

export function ParkingSettingsControls({ preferences }: ParkingSettingsControlsProps) {
  const [threshold, setThreshold] = useState(() => preferences.getParkingAlertThreshold());
  const [inputValue, setInputValue] = useState(() => String(threshold));

  const commitThreshold = () => {
    const numeric = Number(inputValue);
    const next = preferences.setParkingAlertThreshold(numeric);
    setThreshold(next.parkingAlertThreshold);
    setInputValue(String(next.parkingAlertThreshold));
  };

  return (
    <section className="settings-section parking-settings-section" aria-labelledby="parking-settings-title">
      <h2 id="parking-settings-title">泊車模式</h2>
      <label className="parking-threshold-control">
        <span>{messages.parkingAlertThreshold}</span>
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          inputMode="numeric"
          aria-label={messages.parkingAlertThreshold}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onBlur={commitThreshold}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitThreshold();
            }
          }}
        />
      </label>
      <p>{messages.parkingAlertThresholdCopy}</p>
      <p>{messages.parkingSourceNote}</p>
      <p>{messages.parkingPrivacyNote}</p>
      <span className="sr-only">目前門檻 {threshold}</span>
    </section>
  );
}
