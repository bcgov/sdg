import { describe, expect, it } from 'vitest';

import { extractExample } from '.';

const source = [
  'const before = 1;',
  '// #region hook',
  '    const a = 1;',
  '    const b = 2;',
  '// #endregion hook',
  '<div>',
  '  {/* #region markup */}',
  '  <p>One</p>',
  '    <p>Two</p>',
  '  {/* #endregion markup */}',
  '</div>',
].join('\n');

describe('extractExample', () => {
  it('extracts and dedents the code between line-comment markers', () => {
    expect(extractExample(source, 'hook')).toBe('const a = 1;\nconst b = 2;');
  });

  it('extracts the code between JSX-comment markers, keeping relative indentation', () => {
    expect(extractExample(source, 'markup')).toBe('<p>One</p>\n  <p>Two</p>');
  });

  it('throws when the start marker is missing', () => {
    expect(() => extractExample(source, 'missing')).toThrow('no "#region missing" marker');
  });

  it('throws when the end marker is missing', () => {
    expect(() => extractExample('// #region open\nconst a = 1;', 'open')).toThrow('no matching "#endregion open"');
  });
});
