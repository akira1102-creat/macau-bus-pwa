// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ParkingFacility } from '../../../shared/parking-contract';
import type { LocalPreferences } from '../../infra/local-preferences';
import { createLocalPreferences } from '../../infra/local-preferences';
import type { ParkingAlertSummary, PushClient } from '../../infra/push-client';
import { ParkingAlertSheet } from './ParkingAlertSheet';

const facility: ParkingFacility = {
  id: '42', name: '甲停車場', location: '澳門半島', entrance: null, latitude: null, longitude: null,
  spaces: { car: 8, motorcycle: null, electricCar: null, electricMotorcycle: null, accessible: null },
  updatedAt: null, suspended: false,
};

function client(overrides: Partial<PushClient> = {}): PushClient {
  return {
    support: () => ({ supported: true, permission: 'granted' }),
    listAlerts: vi.fn(async () => []),
    createAlert: vi.fn(),
    deleteAlert: vi.fn(),
    listParkingAlerts: vi.fn(async () => []),
    createParkingAlert: vi.fn(async () => ({ id: 'parking-alert-1', parkingId: facility.id, parkingName: facility.name, threshold: 10 } as ParkingAlertSummary)),
    deleteParkingAlert: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderSheet(pushClient: PushClient = client(), preferences: LocalPreferences = createLocalPreferences()) {
  return render(<ParkingAlertSheet facility={facility} pushClient={pushClient} preferences={preferences} onClose={vi.fn()} />);
}

describe('ParkingAlertSheet', () => {
  it('uses the preference threshold 10 by default and creates one active parking alert', async () => {
    const pushClient = client();
    renderSheet(pushClient);
    expect(screen.getByRole('spinbutton', { name: '低空位提醒門檻' })).toHaveValue(10);
    fireEvent.click(screen.getByRole('button', { name: '開啟低空位提醒' }));
    await waitFor(() => expect(pushClient.createParkingAlert).toHaveBeenCalledWith({ parkingId: '42', parkingName: '甲停車場', threshold: 10 }));
    expect(await screen.findByText('已設定低空位提醒。')).toBeVisible();
  });

  it('lists and cancels an existing alert, and explains unsupported or denied permission', async () => {
    const existing = { id: 'parking-alert-1', parkingId: facility.id, parkingName: facility.name, threshold: 5 } as ParkingAlertSummary;
    const pushClient = client({ listParkingAlerts: vi.fn(async () => [existing]) });
    renderSheet(pushClient);
    expect(await screen.findByRole('button', { name: '取消低空位提醒' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消低空位提醒' }));
    await waitFor(() => expect(pushClient.deleteParkingAlert).toHaveBeenCalledWith(existing.id));

    const unsupported = client({ support: () => ({ supported: false, permission: 'denied', reason: 'push-unavailable' }) });
    renderSheet(unsupported);
    expect(screen.getAllByText(/不支援背景泊車提醒|通知權限/).length).toBeGreaterThan(0);
  });
});
