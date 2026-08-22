// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from './AppShell';

describe('mode-aware app shell', () => {
  it('shows first-run mode choices and saves the chosen mode through the callback', () => {
    const onModeChange = vi.fn();
    render(<AppShell
      activeMode="bus"
      activeModePreference={null}
      activeTab="nearby"
      onTabChange={vi.fn()}
      onModeChange={onModeChange}
    >content</AppShell>);

    expect(screen.getByRole('dialog', { name: '選擇使用模式' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '搵泊車位' }));
    expect(onModeChange).toHaveBeenCalledWith('parking');
  });

  it('renders the exact bus and parking navigation sets and supports the quick switch', () => {
    const onModeChange = vi.fn();
    const { rerender } = render(<AppShell
      activeMode="bus"
      activeModePreference="bus"
      activeTab="nearby"
      onTabChange={vi.fn()}
      onModeChange={onModeChange}
    >content</AppShell>);

    expect(screen.getByRole('navigation', { name: '主要導覽' })).toHaveTextContent('附近路線地圖收藏設定');
    fireEvent.click(screen.getByRole('button', { name: '切換至泊車模式' }));
    expect(onModeChange).toHaveBeenCalledWith('parking');

    rerender(<AppShell
      activeMode="parking"
      activeModePreference="parking"
      activeTab="search"
      onTabChange={vi.fn()}
      onModeChange={onModeChange}
    >content</AppShell>);
    expect(screen.getByRole('navigation', { name: '主要導覽' })).toHaveTextContent('附近地圖搜尋收藏設定');
    expect(screen.getByRole('button', { name: '搜尋' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not show first-run choice after a remembered parking mode is loaded', () => {
    render(<AppShell
      activeMode="parking"
      activeModePreference="parking"
      activeTab="nearby"
      onTabChange={vi.fn()}
      onModeChange={vi.fn()}
    >content</AppShell>);

    expect(screen.queryByRole('dialog', { name: '選擇使用模式' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '搜尋' })).toBeVisible();
  });
});
