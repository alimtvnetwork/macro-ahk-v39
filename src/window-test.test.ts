import { test, expect }  from 'vitest';
test('window exists', () => { expect(typeof window).toBe('object'); });
test('localStorage exists', () => { expect(typeof localStorage).toBe('object'); });
