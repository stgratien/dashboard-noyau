import { describe, it, expect } from 'vitest';
import { mapPost, isVideoType, mapStory, mergeStory, VIDEO_FORMATS } from '@/lib/windsor-mapping';

const fb = (type: string, permalink = 'https://www.facebook.com/12345678901234/posts/1') => ({
  post_id: '12345678901234_1', post_created_time: '2026-04-21T09:00:00Z', post_message: 'Texte', permalink_url: permalink,
  full_picture: 'https://scontent.xx.fbcdn.net/a.jpg', post_type: type, post_impressions: 100, post_reactions_total: 5, post_comments_total: 1, post_activity_by_action_type_share: 2,
});
const ig = (type: string) => ({
  media_id: '1', timestamp: '2026-04-21T09:00:00Z', media_caption: 'Légende', media_permalink: 'https://www.instagram.com/p/x/', media_url: 'https://cdninstagram.com/a.jpg',
  media_type: type, media_views: 4198, media_like_count: 10, media_comments_count: 1, media_shares: 2,
});
const li = (type: string, extra: Record<string, unknown> = {}) => ({
  share_id: 'urn:li:share:1', share_published_time: '2026-03-03T10:00:00Z', share_text: 'Texte', share_url: 'https://www.linkedin.com/feed/update/1',
  share_post_type: type, share_impression_count: 500, share_like_count: 3, share_comment_count: 0, share_count: 1, share_video_views: 120, ...extra,
});

describe('mapPost : formats et vidéos par plateforme', () => {
  it('Instagram : REELS est une vidéo et porte ses vues, comme VIDEO et REEL', () => {
    for (const type of ['REELS', 'VIDEO', 'REEL']) {
      const post = mapPost('instagram', ig(type));
      expect(post?.format).toBe('Vidéo');
      expect(post?.metrics['videoViews']).toBe(4198);
    }
    expect(mapPost('instagram', ig('IMAGE'))).toMatchObject({ format: 'Photo', metrics: { videoViews: 0 } });
    expect(mapPost('instagram', ig('CAROUSEL_ALBUM'))?.format).toBe('Carrousel / Album');
  });

  it('Facebook : photo, album, vidéo, reel et couverture', () => {
    expect(mapPost('facebook_organic', fb('photo'))?.format).toBe('Photo');
    expect(mapPost('facebook_organic', fb('album'))?.format).toBe('Carrousel / Album');
    expect(mapPost('facebook_organic', fb('video_inline', 'https://www.facebook.com/12345678901234/videos/1'))?.format).toBe('Vidéo');
    expect(mapPost('facebook_organic', fb('video_direct_response', 'https://www.facebook.com/reel/1'))?.format).toBe('Vidéo');
    expect(mapPost('facebook_organic', fb('cover_photo', 'https://www.facebook.com/photo.php?fbid=1&substory_index=0'))?.format).toBe('Autre');
  });

  it('Facebook : sans type, un permalien /reel/ ou /videos/ reste une vidéo, sinon « Post »', () => {
    expect(mapPost('facebook_organic', fb('', 'https://www.facebook.com/reel/1'))?.format).toBe('Vidéo');
    expect(mapPost('facebook_organic', fb('', 'https://www.facebook.com/12345678901234/videos/9'))?.format).toBe('Vidéo');
    expect(mapPost('facebook_organic', fb(''))?.format).toBe('Post');
  });

  it('le test de permalien vidéo ne s’applique qu’à Facebook', () => {
    const post = mapPost('instagram', { ...ig('IMAGE'), media_permalink: 'https://www.instagram.com/reel/abc/' });
    expect(post?.format).toBe('Photo');
  });

  it('LinkedIn : vidéo, document, image et multi-images', () => {
    expect(mapPost('linkedin_organic', li('video'))).toMatchObject({ format: 'Vidéo', metrics: { videoViews: 120 } });
    expect(mapPost('linkedin_organic', li('document'))?.format).toBe('Document');
    expect(mapPost('linkedin_organic', li('image'))?.format).toBe('Photo');
    expect(mapPost('linkedin_organic', li('multiImage'))?.format).toBe('Carrousel / Album');
    expect(mapPost('linkedin_organic', li('article'))?.format).toBe('Autre');
  });

  it('LinkedIn : la vignette de secours share_thumbnail ne passe qu’après share_image_url', () => {
    const cover = 'https://media.licdn.com/dms/image/videocover.jpg';
    const photo = 'https://media.licdn.com/dms/image/photo.jpg';
    expect(mapPost('linkedin_organic', li('video', { share_image_url: null, share_thumbnail: cover }))?.remoteThumbnail).toBe(cover);
    expect(mapPost('linkedin_organic', li('image', { share_image_url: photo, share_thumbnail: cover }))?.remoteThumbnail).toBe(photo);
    expect(mapPost('linkedin_organic', li('image', { share_image_url: photo, share_thumbnail: cover }))?.remoteThumbnails).toEqual([photo, cover]);
    expect(mapPost('linkedin_organic', li('document', { share_image_url: null, share_thumbnail: null }))?.remoteThumbnails).toEqual([]);
    expect(mapPost('linkedin_organic', li('document', { share_image_url: null, share_thumbnail: null }))?.remoteThumbnail).toBe('');
  });

  it('TikTok reste une vidéo', () => {
    const post = mapPost('tiktok_organic', { video_id: 'v1', video_create_datetime: '2026-06-01T10:00:00Z', video_caption: 'c', video_share_url: 'https://www.tiktok.com/v1', video_thumbnail_url: 'https://p16.tiktokcdn.com/a.jpg', video_views_count: 10, video_likes: 1, video_comments: 0, video_shares: 0 });
    expect(post?.format).toBe('Vidéo');
  });

  it('isVideoType est insensible à la casse et VIDEO_FORMATS couvre le format produit', () => {
    expect(isVideoType('reels')).toBe(true);
    expect(isVideoType('IMAGE')).toBe(false);
    expect(VIDEO_FORMATS).toContain('Vidéo');
  });
});

import { AUDIENCE_SPECS, audienceFields, audienceValues, postRefFromAd, postIdFromAd } from '../lib/windsor-mapping';
describe('audience specs', () => {
  const fb = AUDIENCE_SPECS.facebook_organic ?? [];
  const city = fb.find(s => s.dimension === 'city')!;
  it('asks Facebook for dated fan breakdowns with page_fans_likes, and no gender/age', () => {
    expect(fb.map(s => s.dimension)).toEqual(['country', 'city']);
    expect(audienceFields(city)).toBe('date,page_fans_likes,page_fans_city_name,page_fans_city_value');
    expect(audienceFields(fb[0]!)).toBe('date,page_fans_likes,page_fans_country_name,page_fans_country_value');
  });
  it('keeps other networks as they were', () => {
    expect(audienceFields(AUDIENCE_SPECS.instagram![0]!)).toBe('audience_gender_age_name,audience_gender_age_size');
    expect(AUDIENCE_SPECS.tiktok_organic?.map(s => s.dimension)).toEqual(['gender', 'age', 'country']);
  });
  it('keeps only the most recent day of a dated breakdown instead of adding the days up', () => {
    const rows = [
      { date: '2026-10-15', page_fans_city_name: 'Paris', page_fans_city_value: 100, page_fans_likes: 500 },
      { date: '2026-10-16', page_fans_city_name: 'Paris', page_fans_city_value: 110, page_fans_likes: 510 },
      { date: '2026-10-16', page_fans_city_name: 'Lyon', page_fans_city_value: 40, page_fans_likes: 510 },
      { date: '2026-10-15', page_fans_city_name: 'Nice', page_fans_city_value: 9, page_fans_likes: 500 },
    ];
    expect([...audienceValues(city, rows)]).toEqual([['Paris', 110], ['Lyon', 40]]);
  });
  it('ignores the latest day when it carries no value and returns nothing for empty rows', () => {
    const rows = [
      { date: '2026-10-16', page_fans_city_name: '', page_fans_city_value: null },
      { date: '2026-10-15', page_fans_city_name: 'Paris', page_fans_city_value: 100 },
    ];
    expect([...audienceValues(city, rows)]).toEqual([['Paris', 100]]);
    expect(audienceValues(city, []).size).toBe(0);
  });
  it('converts TikTok percentages (fractions from Windsor) to percent', () => {
    const spec = AUDIENCE_SPECS.tiktok_organic![0]!;
    expect([...audienceValues(spec, [{ audience_genders_gender: 'Male', audience_genders_percentage: 0.63 }])][0]![1]).toBeCloseTo(63);
    // Undated rows (TikTok, Instagram) are all kept, one value per label.
    const twice = audienceValues(spec, [{ audience_genders_gender: 'Male', audience_genders_percentage: 0.6 }, { audience_genders_gender: 'Female', audience_genders_percentage: 0.4 }]);
    expect([...twice.keys()]).toEqual(['Male', 'Female']);
  });
});

describe('publication targeted by an ad', () => {
  const igAd = { source_instagram_media_id: '17000000000001', effective_object_story_id: '12345678901234_20000000000001', effective_instagram_media__id: '17000000000002' };
  it('uses the organic Instagram media of an ad made from an Instagram post, whatever the placement', () => {
    expect(postRefFromAd('facebook', 'instagram', igAd)).toEqual({ platform: 'instagram', post_id: '17000000000001' });
    expect(postRefFromAd('facebook', 'facebook', igAd)).toEqual({ platform: 'instagram', post_id: '17000000000001' });
  });
  it('uses the Facebook page post for a boosted Facebook post, on both placements', () => {
    const fbAd = { source_instagram_media_id: null, effective_object_story_id: '12345678901234_20000000000002', effective_instagram_media__id: '17000000000003' };
    expect(postRefFromAd('facebook', 'facebook', fbAd)).toEqual({ platform: 'facebook', post_id: '12345678901234_20000000000002' });
    expect(postRefFromAd('facebook', 'instagram', fbAd)).toEqual({ platform: 'facebook', post_id: '12345678901234_20000000000002' });
  });
  it('falls back to the ad copy media, then to nothing', () => {
    expect(postRefFromAd('facebook', 'instagram', { effective_instagram_media__id: '1801' })).toEqual({ platform: 'instagram', post_id: '1801' });
    expect(postRefFromAd('facebook', 'facebook', {}).post_id).toBe('');
  });
  it('keeps TikTok and LinkedIn as they were', () => {
    expect(postIdFromAd('tiktok', 'tiktok', { item_id: '70000000000001' })).toBe('70000000000001');
    expect(postIdFromAd('linkedin', 'linkedin', { share_id: 'urn:li:share:80000000000001' })).toBe('80000000000001');
    expect(postRefFromAd('linkedin', 'linkedin', { share_id: 'urn:li:ugcPost:75117' })).toEqual({ platform: 'linkedin', post_id: '75117' });
  });
});


describe('stories Instagram', () => {
  const row = { story_id: '178', story_timestamp: '2026-10-20T08:15:00Z', story_views: 1200, story_reach: 900, story_replies: 4, story_shares: 2, story_interactions: 30 };
  it('maps a Windsor story row, with the date as ISO and views from story_views', () => {
    expect(mapStory(row)).toEqual({ story_id: '178', published_at: '2026-10-20T08:15:00.000Z', views: 1200, reach: 900, replies: 4, shares: 2, interactions: 30 });
    expect(mapStory({ ...row, story_timestamp: 1_760_948_100 })?.published_at).toBe('2025-10-20T08:15:00.000Z');
  });
  it('falls back to the deprecated story_impressions, keeps missing figures null and ignores rows without id or date', () => {
    expect(mapStory({ story_id: '1', story_timestamp: '2026-10-20T08:15:00Z', story_impressions: 50 })).toMatchObject({ views: 50, reach: null, replies: null, shares: null, interactions: null });
    expect(mapStory({ story_timestamp: '2026-10-20T08:15:00Z' })).toBeNull();
    expect(mapStory({ story_id: '1', story_timestamp: 'pas une date' })).toBeNull();
  });
  it('keeps the highest figure seen and never erases a known one with a missing one', () => {
    const next = mapStory({ ...row, story_views: 1500, story_reach: null, story_replies: 1, story_shares: undefined, story_interactions: null })!;
    expect(mergeStory({ views: 1200, reach: 900, replies: 4, shares: 2, interactions: 30 }, next)).toMatchObject({ views: 1500, reach: 900, replies: 4, shares: 2, interactions: 30 });
    expect(mergeStory(undefined, next)).toMatchObject({ views: 1500, reach: null, replies: 1 });
  });
});
