// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createLocalPreferences, type PreferencesStorage } from '../../infra/local-preferences';
import { ParkingSettingsControls } from './ParkingSettingsControls';

class MemoryStorage implements PreferencesStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe('ParkingSettingsControls', () => {
  it('persists an integer threshold from 1 through 100 and explains source/privacy', () => {
    const preferences = createLocalPreferences({ storage: new MemoryStorage() });
    render(<ParkingSettingsControls preferences={preferences} />);

    const input = screen.getByRole('spinbutton', { name: '低空位提醒門檻' });
    expect(input).toHaveValue(10);
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.blur(input);
    expect(preferences.getParkingAlertThreshold()).toBe(100);
    fireEvent.change(input, { target: { value: '101' } });
    fireEvent.blur(input);
    expect(preferences.getParkingAlertThreshold()).toBe(10);
    expect(screen.getByText(/定位只在瀏覽器本機/)).toBeVisible();
    expect(screen.getByText(/資料來自 DSAT/)).toBeVisible();
  });
});
