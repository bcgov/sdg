import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Avatar, getInitials } from './avatar';

afterEach(cleanup);

describe('Avatar', () => {
  describe('getInitials', () => {
    it('uses the first letters of the first and last words', () => {
      expect(getInitials('Ada Lovelace')).toBe('AL');
      expect(getInitials('ada king lovelace')).toBe('AL');
      expect(getInitials('  Grace   Hopper  ')).toBe('GH');
    });

    it('uses one letter for a single word and ? for blank names', () => {
      expect(getInitials('cher')).toBe('C');
      expect(getInitials('')).toBe('?');
      expect(getInitials('   ')).toBe('?');
    });

    it('is Unicode-aware', () => {
      expect(getInitials('Émile zola')).toBe('ÉZ');
      expect(getInitials('𝒜da 𝒷yron')).toBe('𝒜𝒷');
      expect(getInitials('łukasz ŻAK')).toBe('ŁŻ');
    });
  });

  describe('rendering', () => {
    it('renders initials with role img and the name as label', () => {
      render(<Avatar name="Ada Lovelace" />);
      const avatar = screen.getByRole('img', { name: 'Ada Lovelace' });
      expect(avatar.textContent).toBe('AL');
      expect(avatar.tagName).toBe('SPAN');
    });

    it('renders an img with alt and falls back to initials on error', () => {
      render(<Avatar name="Ada Lovelace" src="/ada.png" />);
      const image = screen.getByRole('img', { name: 'Ada Lovelace' });
      expect(image.tagName).toBe('IMG');
      expect(image.getAttribute('src')).toBe('/ada.png');
      fireEvent.error(image);
      const fallback = screen.getByRole('img', { name: 'Ada Lovelace' });
      expect(fallback.tagName).toBe('SPAN');
      expect(fallback.textContent).toBe('AL');
    });

    it('is aria-hidden when decorative', () => {
      const { container } = render(<Avatar name="Ada Lovelace" decorative />);
      expect(screen.queryByRole('img')).toBeNull();
      const root = container.firstElementChild;
      expect(root?.getAttribute('aria-hidden')).toBe('true');
      expect(root?.getAttribute('aria-label')).toBeNull();
    });

    it('applies the size class', () => {
      const { rerender } = render(<Avatar name="Ada Lovelace" className="extra" />);
      const medium = screen.getByRole('img').className;
      rerender(<Avatar name="Ada Lovelace" size="large" className="extra" />);
      const large = screen.getByRole('img').className;
      expect(medium).toMatch(/medium/);
      expect(large).toMatch(/large/);
      expect(large).not.toMatch(/medium/);
      expect(large).toMatch(/\bextra\b/);
    });
  });
});
