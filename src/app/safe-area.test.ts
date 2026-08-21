import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('notched standalone safe-area contract', () => {
  it('keeps viewport-fit cover and adds top insets without replacing normal spacing', () => {
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/app.css'), 'utf8');

    expect(indexHtml).toContain('viewport-fit=cover');
    expect(styles).toMatch(/\.app-header\s*\{[^}]*padding:\s*calc\(42px\s*\+\s*env\(safe-area-inset-top\)\)/s);
    expect(styles).toMatch(/\.route-page\s*\{[^}]*padding-top:\s*env\(safe-area-inset-top\)/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*460px\)[\s\S]*?\.app-header\s*\{[^}]*padding-top:\s*calc\(28px\s*\+\s*env\(safe-area-inset-top\)\)/s);
    expect(styles).toMatch(/@media\s*\(min-width:\s*760px\)[\s\S]*?\.app-header\s*\{[^}]*padding-top:\s*calc\(54px\s*\+\s*env\(safe-area-inset-top\)\)/s);
  });
});
