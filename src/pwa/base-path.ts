export interface PagesBuildEnvironment {
  GITHUB_ACTIONS?: string;
  GITHUB_REPOSITORY?: string;
  BASE_PATH?: string;
  VITE_BASE_PATH?: string;
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '/';
  }
  if (trimmed === '.' || trimmed === './') {
    return './';
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${withLeadingSlash.replace(/\/+$/, '')}/`;
}

/** Resolve the Vite base URL used by local development and project GitHub Pages builds. */
export function resolvePagesBasePath(environment: PagesBuildEnvironment = {}): string {
  const explicitBase = environment.VITE_BASE_PATH?.trim() || environment.BASE_PATH?.trim();
  if (explicitBase) {
    return normalizeBasePath(explicitBase);
  }

  if (environment.GITHUB_ACTIONS === 'true') {
    const repositoryName = environment.GITHUB_REPOSITORY?.split('/').filter(Boolean).pop();
    if (repositoryName) {
      return normalizeBasePath(repositoryName);
    }
  }

  return '/';
}

export function joinBasePath(basePath: string, assetPath: string): string {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${base}${assetPath.replace(/^\/+/, '')}`;
}
