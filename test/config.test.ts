import { defaultVersions } from '../src/config';

describe('pinned chart versions', () => {
  it('pins every dependency to an explicit version (no floating tags)', () => {
    for (const [name, version] of Object.entries(defaultVersions)) {
      expect(typeof version).toBe('string');
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(name).toBeTruthy();
    }
  });
});
