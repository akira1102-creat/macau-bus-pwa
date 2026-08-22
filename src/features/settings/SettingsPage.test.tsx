// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createLocalPreferences, type LocalPreferences, type PreferencesStorage } from '../../infra/local-preferences';
import type { PushClient } from '../../infra/push-client';
import { SettingsPage } from './SettingsPage';

class MemoryStorage implements PreferencesStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function preferences(): LocalPreferences {
  return createLocalPreferences({ storage: new MemoryStorage() });
}

function pushClient(overrides: Partial<PushClient> = {}): PushClient {
  return {
    support: () => ({ supported: true, permission: 'granted' }),
    listAlerts: vi.fn().mockResolvedValue([]),
    createAlert: vi.fn(),
    deleteAlert: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('SettingsPage', () => {
  it('persists system, light and dark theme choices', () => {
    const preferenceStore = preferences();
    const onThemeChange = vi.fn();
    render(<SettingsPage preferences={preferenceStore} onThemeChange={onThemeChange} />);

    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(preferenceStore.getTheme()).toBe('dark');
    expect(onThemeChange).toHaveBeenCalledWith('dark');

    fireEvent.click(screen.getByRole('radio', { name: '淺色' }));
    expect(preferenceStore.getTheme()).toBe('light');
    expect(onThemeChange).toHaveBeenCalledWith('light');
  });

  it('persists lead-stop values from one through ten and reports push permission', () => {
    const preferenceStore = preferences();
    render(<SettingsPage preferences={preferenceStore} onThemeChange={vi.fn()} pushClient={pushClient()} />);

    expect(screen.getByRole('heading', { name: '到站提醒' })).toBeVisible();
    expect(screen.getByText('通知權限已允許')).toBeVisible();
    fireEvent.click(screen.getByRole('radio', { name: '提前 1 站' }));
    expect(preferenceStore.getNotificationLeadStops()).toBe(1);
    fireEvent.click(screen.getByRole('radio', { name: '提前 10 站' }));
    expect(preferenceStore.getNotificationLeadStops()).toBe(10);
  });

  it('lists active reminders and cancels them through the push client', async () => {
    const deleteAlert = vi.fn().mockResolvedValue(undefined);
    const client = pushClient({
      listAlerts: vi.fn().mockResolvedValue([{
        id: 'alert-1', routeId: '1', direction: 0, targetStopId: 'M2', targetStopIndex: 1, threshold: 3,
      }]),
      deleteAlert,
    });
    render(<SettingsPage preferences={preferences()} onThemeChange={vi.fn()} pushClient={client} />);

    expect(await screen.findByText(/路線 1.*方向 0.*第 2 站.*M2.*提前 3 站/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消提醒' }));
    await waitFor(() => expect(deleteAlert).toHaveBeenCalledWith('alert-1'));
    expect(screen.queryByText(/路線 1.*方向 0.*第 2 站.*M2.*提前 3 站/)).not.toBeInTheDocument();
  });

  it('shows an explicit unsupported permission state', () => {
    const client = pushClient({ support: () => ({ supported: false, permission: 'unsupported', reason: 'push-unavailable' }) });
    render(<SettingsPage preferences={preferences()} onThemeChange={vi.fn()} pushClient={client} />);

    expect(screen.getByText(/此裝置未支援背景到站提醒/)).toBeVisible();
  });

  it('explains that iOS and iPadOS must be launched from the home screen', () => {
    const client = pushClient({ support: () => ({ supported: false, permission: 'default', reason: 'ios-not-standalone' }) });
    render(<SettingsPage preferences={preferences()} onThemeChange={vi.fn()} pushClient={client} />);

    expect(screen.getByText('iOS/iPadOS 需先將 PWA 加入主畫面，然後從主畫面開啟提醒功能。')).toBeVisible();
  });
});
