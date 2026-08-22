interface NetlifyRuntime {
  env?: {
    get(name: string): string | undefined;
  };
}

function runtime(): NetlifyRuntime | undefined {
  return (globalThis as typeof globalThis & { Netlify?: NetlifyRuntime }).Netlify;
}

/** Reads deploy-time settings through Netlify's runtime environment API. */
export function readNetlifyEnv(name: string): string | undefined {
  try {
    const value = runtime()?.env?.get(name);
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export function readFirstNetlifyEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = readNetlifyEnv(name);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}
