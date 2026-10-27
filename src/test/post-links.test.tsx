import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { safePostUrl, facebookPostUrl } from '../lib/post-links';
import { PostLink } from '../components/post-link';

describe('safePostUrl', () => {
  it('keeps valid network links, with a clean TikTok URL', () => {
    const handle = 'demo_account';
    expect(safePostUrl('facebook', 'https://www.facebook.com/12345678901234/posts/23456789012345')).toBe('https://www.facebook.com/12345678901234/posts/23456789012345');
    expect(safePostUrl('facebook', 'https://www.facebook.com/12345678901234/posts/34567890123456?substory_index=34567890123456')).toContain('substory_index');
    expect(safePostUrl('facebook', 'https://www.facebook.com/12345678901234/videos/45678901234567')).toContain('/videos/');
    expect(safePostUrl('facebook', 'https://www.facebook.com/reel/1234567890/')).toContain('/reel/');
    expect(safePostUrl('instagram', 'https://www.instagram.com/p/DdWc05uiDqL/')).toBe('https://www.instagram.com/p/DdWc05uiDqL/');
    expect(safePostUrl('instagram', 'https://www.instagram.com/reel/DdWc05uiDqL/')).toContain('/reel/');
    expect(safePostUrl('linkedin', 'https://www.linkedin.com/feed/update/urn:li:ugcPost:56789012345678')).toContain('urn:li:ugcPost');
    expect(safePostUrl('tiktok', `https://www.tiktok.com/@${handle}/video/67890123456789?utm_campaign=tt4d_open_api&utm_source=123`)).toBe(`https://www.tiktok.com/@${handle}/video/67890123456789`);
  });
  it('rejects empty, relative, insecure, foreign and script links', () => {
    for (const raw of ['', '   ', null, undefined, 42, '/publications/instagram/1', 'http://www.instagram.com/p/x/', 'javascript:alert(1)', 'data:text/html,x', 'https://evil.com/p/x/', 'https://www.instagram.com.evil.com/p/x/', 'https://notinstagram.com/p/x/']) {
      expect(safePostUrl('instagram', raw)).toBe('');
    }
    expect(safePostUrl('instagram', 'https://www.facebook.com/x/posts/1')).toBe('');
    expect(safePostUrl('unknown', 'https://www.instagram.com/p/x/')).toBe('');
  });
});

describe('facebookPostUrl', () => {
  it('builds the link from a page_post identifier', () => {
    expect(facebookPostUrl('12345678901234_23456789012345')).toBe('https://www.facebook.com/12345678901234/posts/23456789012345');
  });
  it('rejects anything else', () => {
    for (const raw of ['23456789012345', '', 'abc_def', '12345678901234_', '_123', '123_456_789', null, undefined]) expect(facebookPostUrl(raw)).toBe('');
  });
});

describe('PostLink', () => {
  it('renders a real link that opens in a new tab with the safe rel attributes', () => {
    render(<PostLink href="https://www.instagram.com/p/x/" label="Voir la publication" linkClassName="hover:underline">Titre</PostLink>);
    const link = screen.getByRole('link', { name: 'Voir la publication' });
    expect(link).toHaveAttribute('href', 'https://www.instagram.com/p/x/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
    expect(link.className).toContain('hover:underline');
  });
  it('passes the full title to the hover text, with or without a link', () => {
    const { unmount } = render(<PostLink href="https://www.instagram.com/p/x/" title="Titre complet">Titre</PostLink>);
    expect(screen.getByRole('link')).toHaveAttribute('title', 'Titre complet');
    unmount();
    render(<PostLink href="" title="Titre complet">Titre</PostLink>);
    expect(screen.getByText('Titre')).toHaveAttribute('title', 'Titre complet');
  });
  it('adds no tooltip of its own to a thumbnail without a link', () => {
    render(<PostLink href={null}>Visuel</PostLink>);
    expect(screen.getByText('Visuel')).not.toHaveAttribute('title');
  });
  it('renders plain text, not a link, when there is no URL', () => {
    for (const href of [undefined, null, '']) {
      const { unmount } = render(<PostLink href={href} label="Voir" className="font-medium" linkClassName="hover:underline">Titre</PostLink>);
      expect(screen.queryByRole('link')).toBeNull();
      const text = screen.getByText('Titre');
      expect(text.className).toContain('font-medium');
      expect(text.className).not.toContain('hover:underline');
      expect(text.tagName).toBe('SPAN');
      unmount();
    }
  });
});
