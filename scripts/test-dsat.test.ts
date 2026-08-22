import { describe, expect, it, vi } from 'vitest';

import {
  DSAT_MAX_RESPONSE_BYTES,
  DSAT_ORIGIN,
  DSAT_REFERER,
  DSAT_TIMEOUT_MS,
  DsatProbeError,
  DsatUsageError,
  buildDsatProbeRequest,
  fetchDsatProbe,
  formatDsatProbeError,
  summarizeDsatResponse,
} from './test-dsat';

async function captureAsyncError(task: Promise<unknown>): Promise<unknown> {
  try {
    await task;
    return undefined;
  } catch (error) {
    return error;
  }
}

function captureSyncError(task: () => unknown): unknown {
  try {
    task();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('DSAT probe request', () => {
  it('uses the current form field order, origin/referer and a fixed known token vector', () => {
    const request = buildDsatProbeRequest({
      route: '1',
      direction: 0,
      // 12:34 in Macau (UTC+8). The token must be identical on UTC hosts.
      now: new Date('2026-08-21T04:34:56.000Z'),
    });

    expect(request.body).toBe(
      'action=dy&routeName=1&dir=0&lang=zh-tw&routeType=0&device=web',
    );
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(DSAT_ORIGIN).toBe('https://bis.dsat.gov.mo:37812');
    expect(request.headers.origin).toBe('https://bis.dsat.gov.mo:37812');
    expect(request.headers.referer).toBe(DSAT_REFERER);
    expect(request.headers.token).toBe('26982026ca6b27e30821d3f6c95ee98f123488a00648');
  });

  it('aborts a hung request through the timeout AbortSignal', async () => {
    vi.useFakeTimers();
    const request = buildDsatProbeRequest({ route: '1', direction: 0 });
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    );

    try {
      const pending = fetchDsatProbe(request, { fetch: fetcher });
      const rejection = expect(pending).rejects.toThrow(/逾時|timeout/i);
      await vi.advanceTimersByTimeAsync(DSAT_TIMEOUT_MS);
      await rejection;
      expect(fetcher).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      );
      expect(DSAT_TIMEOUT_MS).toBe(4_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a response once its bounded body exceeds the limit', async () => {
    const request = buildDsatProbeRequest({ route: '1', direction: 0 });
    const fetcher = vi.fn(async () => new Response('0123456789', {
      status: 200,
      headers: { 'content-length': String(DSAT_MAX_RESPONSE_BYTES + 1) },
    }));

    const error = await captureAsyncError(fetchDsatProbe(request, { fetch: fetcher }));
    expect(error).toMatchObject({ code: 'response-too-large' });
    expect(formatDsatProbeError(error)).toBe('DSAT 測試失敗：回應超過大小限制。');
    expect(DSAT_MAX_RESPONSE_BYTES).toBeGreaterThan(0);
  });

  it('rejects a response without a readable body stream before any unbounded text fallback', async () => {
    const request = buildDsatProbeRequest({ route: '1', direction: 0 });
    const response = new Response(null, { status: 200 });
    const text = vi.spyOn(response, 'text');
    const fetcher = vi.fn(async () => response);

    const error = await captureAsyncError(fetchDsatProbe(request, { fetch: fetcher }));
    expect(error).toMatchObject({ code: 'missing-body' });
    expect(text).not.toHaveBeenCalled();
    expect(formatDsatProbeError(error)).toBe('DSAT 測試失敗：回應沒有可讀取的內容。');
  });

  it('aborts a hanging response body read under the same timeout', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Keep the stream pending until the probe timeout cancels it.
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = buildDsatProbeRequest({ route: '1', direction: 0 });
    const fetcher = vi.fn(async () => new Response(body, { status: 200 }));

    try {
      const pending = fetchDsatProbe(request, { fetch: fetcher });
      const rejection = expect(pending).rejects.toThrow(/逾時|timeout/i);
      await vi.advanceTimersByTimeAsync(DSAT_TIMEOUT_MS);
      await rejection;
      expect(cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps abort and network errors to stable Traditional Chinese without raw English', () => {
    expect(formatDsatProbeError(new DOMException('English timeout detail', 'TimeoutError'))).toBe('DSAT 測試失敗：請求逾時或已中止。');
    expect(formatDsatProbeError(new TypeError('fetch failed: private network detail'))).toBe('DSAT 測試失敗：網絡連線失敗。');
  });

  it('preserves a useful Traditional Chinese usage instruction for invalid CLI arguments', () => {
    const message = formatDsatProbeError(new DsatUsageError());

    expect(message).toBe('DSAT 測試用法：npm run dsat:test -- --route 1 --direction 0');
    expect(message).not.toContain('無法取得 DSAT 資料');
  });

  it('maps HTTP, application header, invalid JSON, and missing-body failures with safe codes', () => {
    expect(formatDsatProbeError(new DsatProbeError('http', { status: 503 }))).toBe('DSAT 測試失敗：上游 HTTP 狀態碼 503。');
    expect(formatDsatProbeError(new DsatProbeError('application-header', { status: 200, applicationHeader: '1200' }))).toBe('DSAT 測試失敗：DSAT application header 1200（HTTP 200）。');
    expect(formatDsatProbeError(new DsatProbeError('invalid-json'))).toBe('DSAT 測試失敗：回應不是有效 JSON。');
    expect(formatDsatProbeError(new DsatProbeError('missing-body'))).toBe('DSAT 測試失敗：回應沒有可讀取的內容。');
  });

  it('normalizes only successful application header 000 responses', () => {
    const success = summarizeDsatResponse(
      new Response('', { status: 200 }),
      JSON.stringify({ header: '000', data: { routeInfo: [{ busInfo: [{ busPlate: 'MASKED' }] }] } }),
    );
    expect(success).toEqual({ status: 200, applicationHeader: '000', routeInfo: 1, busCount: 1 });

    const httpError = captureSyncError(() => summarizeDsatResponse(new Response('', { status: 503 }), '<html>upstream</html>'));
    expect(httpError).toBeInstanceOf(DsatProbeError);
    expect(formatDsatProbeError(httpError)).toBe('DSAT 測試失敗：上游 HTTP 狀態碼 503。');
    expect(formatDsatProbeError(httpError)).not.toMatch(/upstream|html/i);
    const jsonError = captureSyncError(() => summarizeDsatResponse(new Response('', { status: 200 }), '{bad json'));
    expect(jsonError).toBeInstanceOf(DsatProbeError);
    expect(formatDsatProbeError(jsonError)).toBe('DSAT 測試失敗：回應不是有效 JSON。');
    const applicationError = captureSyncError(() => summarizeDsatResponse(new Response('', { status: 200 }), JSON.stringify({ header: '1200' })));
    expect(applicationError).toBeInstanceOf(DsatProbeError);
    expect(formatDsatProbeError(applicationError)).toBe('DSAT 測試失敗：DSAT application header 1200（HTTP 200）。');
  });
});
