import { describe, expect, it } from 'vitest';

import { buildDsatProbeRequest, createDsatToken } from './test-dsat';

describe('DSAT probe request', () => {
  it('uses the current form field order and lowercase md5 token protocol', () => {
    const request = buildDsatProbeRequest({
      route: '1',
      direction: 0,
      now: new Date('2026-08-21T12:34:56.000Z'),
      nonce: '0123456789abcdef0123456789abcdef',
    });

    expect(request.body).toBe(
      'action=dy&routeName=1&dir=0&lang=zh-tw&routeType=0&device=web',
    );
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(request.headers.token).toBe(createDsatToken(request.body, new Date('2026-08-21T12:34:56.000Z')));
  });
});
