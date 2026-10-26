import { describe, it, expect } from 'vitest';
import { cleanPostText } from '../lib/top-posts';

describe('LinkedIn post text', () => {
  it('turns hashtag and mention markup into readable text', () => {
    expect(cleanPostText('linkedin', 'Derrière chaque avancée {hashtag|\\#|innovation} chez @[Exemple Corp](urn:li:organization:123)')).toBe('Derrière chaque avancée #innovation chez @Exemple Corp');
    expect(cleanPostText('linkedin', 'Félicitations à @[Prénom NOM](urn:li:person:AbC12), distinguée')).toBe('Félicitations à @Prénom NOM, distinguée');
  });
  it('removes escape backslashes before punctuation', () => {
    expect(cleanPostText('linkedin', 'Water Stewardship \\(AWS\\) \\#1')).toBe('Water Stewardship (AWS) #1');
  });
  it('leaves other networks untouched', () => {
    expect(cleanPostText('facebook', 'Texte avec \\( et {hashtag|\\#|x}')).toBe('Texte avec \\( et {hashtag|\\#|x}');
  });
});
