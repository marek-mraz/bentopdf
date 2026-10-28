import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// DOMContentLoaded fires before the page language is fetched, so a page that
// builds its UI there renders English. Page scripts must start via onPageReady().
const DIR = join(process.cwd(), 'src/js/logic');

describe('page scripts wait for translations', () => {
  it('no tool page starts on DOMContentLoaded', () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) =>
        /addEventListener\(\s*['"]DOMContentLoaded['"]/.test(
          readFileSync(join(DIR, f), 'utf8')
        )
      );
    expect(offenders).toEqual([]);
  });
});
