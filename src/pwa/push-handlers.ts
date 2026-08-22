export interface PushEventLike {
  data?: {
    json(): unknown;
    text?(): string | Promise<string>;
  } | null;
  registration: {
    showNotification(title: string, options?: NotificationOptions): Promise<void>;
  };
}

export interface NotificationClickEventLike {
  notification: {
    data?: unknown;
    close(): void;
  };
  clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WindowClientLike[]>;
    openWindow(url: string): Promise<WindowClientLike | null | undefined>;
  };
  scope: string;
}

export interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  route?: string;
  direction?: 0 | 1;
  stop?: string;
  plate?: string;
  remainingStops?: number;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function directionValue(value: unknown): 0 | 1 | undefined {
  return value === 0 || value === 1 ? value : undefined;
}

function remainingStopsValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function fallbackBody(payload: Pick<PushPayload, 'route' | 'direction' | 'stop' | 'plate' | 'remainingStops'>): string {
  if (payload.route && payload.direction !== undefined && payload.stop && payload.plate && payload.remainingStops !== undefined) {
    return `路線 ${payload.route} 方向 ${payload.direction}，站點 ${payload.stop}，車牌 ${payload.plate}，尚餘 ${payload.remainingStops} 站`;
  }
  return '有一則到站提醒。';
}

function parsePayload(value: unknown): PushPayload {
  const source = objectValue(value) ?? {};
  const nestedData = objectValue(source.data);
  const title = textValue(source.title) ?? '澳門巴士到站提醒';
  const payload: PushPayload = { title, body: textValue(source.body) ?? '' };
  const route = textValue(source.route) ?? textValue(nestedData?.route);
  const direction = directionValue(source.direction ?? nestedData?.direction);
  const stop = textValue(source.stop) ?? textValue(nestedData?.stop);
  const plate = textValue(source.plate) ?? textValue(nestedData?.plate);
  const remainingStops = remainingStopsValue(source.remainingStops ?? nestedData?.remainingStops);
  if (route !== undefined) payload.route = route;
  if (direction !== undefined) payload.direction = direction;
  if (stop !== undefined) payload.stop = stop;
  if (plate !== undefined) payload.plate = plate;
  if (remainingStops !== undefined) payload.remainingStops = remainingStops;
  if (!payload.body) {
    payload.body = fallbackBody(payload);
  }
  if (typeof source.icon === 'string') {
    payload.icon = source.icon;
  }
  if (typeof source.badge === 'string') {
    payload.badge = source.badge;
  }
  if (typeof source.tag === 'string') {
    payload.tag = source.tag;
  }
  const url = typeof source.url === 'string' ? source.url : nestedData?.url;
  if (typeof url === 'string' && url.trim()) {
    payload.url = url.trim();
  }
  return payload;
}

export async function handlePushEvent(event: PushEventLike): Promise<void> {
  let rawPayload: unknown = undefined;
  try {
    rawPayload = event.data?.json();
  } catch {
    rawPayload = undefined;
  }
  const payload = parsePayload(rawPayload);
  const options: NotificationOptions = { data: { url: payload.url } };
  options.body = payload.body;
  if (payload.icon !== undefined) {
    options.icon = payload.icon;
  }
  if (payload.badge !== undefined) {
    options.badge = payload.badge;
  }
  if (payload.tag !== undefined) {
    options.tag = payload.tag;
  }
  await event.registration.showNotification(payload.title, options);
}

function notificationUrl(data: unknown, scope: string): string {
  const source = objectValue(data);
  const value = typeof source?.url === 'string' ? source.url : undefined;
  try {
    return new URL(value ?? scope, scope).toString();
  } catch {
    return scope;
  }
}

export async function handleNotificationClick(event: NotificationClickEventLike): Promise<void> {
  const targetUrl = notificationUrl(event.notification.data, event.scope);
  event.notification.close();
  const clients = await event.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const scopeOrigin = new URL(event.scope).origin;
  const existing = clients.find((client) => {
    try {
      return new URL(client.url).origin === scopeOrigin;
    } catch {
      return false;
    }
  });
  if (existing) {
    if (existing.navigate && existing.url !== targetUrl) {
      try {
        await existing.navigate(targetUrl);
      } catch {
        // Focusing the existing app remains useful when navigation is denied.
      }
    }
    await existing.focus();
    return;
  }
  await event.clients.openWindow(targetUrl);
}
