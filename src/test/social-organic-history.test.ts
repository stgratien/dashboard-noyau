import { describe, it, expect } from 'vitest';
import { mergeOrganicHistory, type ManualOrganicDay } from '../lib/social-organic-history';
import { realBlendedTotals, realAllNetworkTotals, type SocialDay } from '../lib/social-totals';

const period={start:'2025-03-10',end:'2025-03-16'};
const rows=(platform:string,source:string,impressions=0):SocialDay[]=>Array.from({length:7},(_,i)=>({platform,source,day:`2025-03-${10+i}`,followers_estimated:false,metrics:{impressions,likes:0,comments:0,shares:0,videoViews:0,postsAvailable:1,spend:10}}));
describe('manual organic history',()=>{
 it('preserves positive provider values, replaces zero/null/negative, and never mutates provider facts',()=>{
  const days=rows('instagram','instagram');
  const first=days[0];if(!first)throw new Error('Missing fixture');first.metrics={...first.metrics,impressions:50,likes:-2,comments:2};
  const manual:ManualOrganicDay={platform:'instagram',day:period.start,organic_views:100,organic_likes:20,organic_comments:3,organic_shares:0,posts_published:2};
  const merged=mergeOrganicHistory(days,[manual]);
  // The agency export has one views column for all Instagram formats: it fills impressions, never videoViews.
  expect(merged[0]?.metrics).toMatchObject({impressions:50,videoViews:0,likes:20,comments:2,shares:0});
  expect(days[0]?.metrics['likes']).toBe(-2);
 });
 it('lets the manual history of the chosen networks come before positive provider values, for the days it covers only',()=>{
  const days=rows('linkedin','linkedin_organic',100);
  const manual:ManualOrganicDay[]=[{platform:'linkedin',day:period.start,organic_views:null,organic_impressions:250,organic_likes:7,organic_comments:null,organic_shares:0,posts_published:1}];
  // By default the provider comes first: a positive provider value stays, the history only fills what is empty.
  expect(mergeOrganicHistory(days,manual)[0]?.metrics).toMatchObject({impressions:100,likes:7});
  const first=mergeOrganicHistory(days,manual,['linkedin']);
  expect(first[0]?.metrics).toMatchObject({impressions:250,likes:7,shares:0,manualOrganicHistory:1,manualPostsPublished:1});
  // A blank manual field never replaces a provider value, and a day the history does not cover keeps the provider data.
  expect(first[0]?.metrics['comments']).toBe(0);
  expect(first[1]?.metrics['impressions']).toBe(100);
  // An explicit manual zero is a known value: it replaces a positive provider value too.
  expect(mergeOrganicHistory(days,[{...manual[0]!,organic_impressions:0}],['linkedin'])[0]?.metrics['impressions']).toBe(0);
  // Other networks are not concerned by the choice of linkedin.
  const facebook=mergeOrganicHistory(rows('facebook','facebook_organic',100),[{...manual[0]!,platform:'facebook'}],['linkedin']);
  expect(facebook[0]?.metrics['impressions']).toBe(100);
 });
 it('keeps manual zeroes known and blank manual fields unavailable',()=>{
  const manual:ManualOrganicDay={platform:'facebook',day:period.start,organic_views:null,organic_impressions:0,organic_likes:null,organic_comments:0,organic_shares:0,posts_published:0};
  const merged=mergeOrganicHistory([], [manual]);expect(merged[0]?.metrics['impressions']).toBe(0);expect(merged[0]?.metrics['likes']).toBeUndefined();
 });
 it('marks long provider runs across networks but leaves paid and TikTok video cohorts untouched',()=>{
  const days=[...rows('facebook','facebook_organic'),...rows('instagram','instagram'),...rows('linkedin','linkedin_organic'),...rows('tiktok','tiktok_organic'),...rows('instagram','facebook')];
  const merged=mergeOrganicHistory(days,[]);
  expect(merged.filter(d=>['facebook_organic','instagram','linkedin_organic'].includes(d.source)).every(d=>d.metrics['impressions']===null)).toBe(true);
  expect(merged.filter(d=>['facebook','tiktok_organic'].includes(d.source)).every(d=>d.metrics['impressions']===0)).toBe(true);
  expect(mergeOrganicHistory(rows('facebook','facebook_organic').slice(0,3),[])[0]?.metrics['impressions']).toBe(0);
 });
 it('reports LinkedIn organic unavailable while keeping exact paid totals and propagating partial scope',()=>{
  const days=mergeOrganicHistory([...rows('linkedin','linkedin_organic'),...rows('linkedin','linkedin',100)],[]);
  const t=realBlendedTotals('linkedin',days,[],period,[]);
  expect(t.organicImpressions).toBeNull();expect(t.organicInteractions).toBeNull();expect(t.impressions).toBe(700);expect(t.interactions).toBe(0);
  expect(t.missing['impressions']).toEqual(['linkedin:organic']);expect(t.missing['interactions']).toEqual(['linkedin:organic']);
  expect(realAllNetworkTotals([t]).missing['impressions']).toEqual(['linkedin:organic']);expect(t.cpm).toBe(100);
 });
 it('fills Instagram days from agency rows with one views column and no paid_views field, without adding the Meta Ads impressions',()=>{
  const manual:ManualOrganicDay[]=Array.from({length:7},(_,i)=>({platform:'instagram',day:`2025-03-${10+i}`,organic_views:1000*(i+1),organic_likes:10*(i+1),organic_comments:i,organic_shares:1,posts_published:i%2}));
  const days=mergeOrganicHistory([...rows('instagram','instagram'),...rows('instagram','facebook',100)],manual);
  const t=realBlendedTotals('instagram',days,[],period,[]);
  // Windsor's Instagram account views already include paid delivery: the 700 Meta Ads impressions are not added.
  expect(t.organicImpressions).toBe(28000);expect(t.impressions).toBe(28000);expect(t.posts).toBe(3);
  expect(days.filter(d=>d.source==='instagram'&&d.day>=period.start&&d.day<=period.end).reduce((s,d)=>s+(d.metrics['likes']??0),0)).toBe(280);
 });
});
import { mergeOrganicHistory as mergeLF } from '@/lib/social-organic-history';
import { mergeFollowerHistory as mergeFollowersLF } from '@/lib/social-followers';
import { it as itLF, expect as expectLF } from 'vitest';
itLF('LinkedIn export fills zero runs with impressions, keeps Facebook provider values and maps followers', () => {
  const zero = Array.from({ length: 7 }, (_, i) => ({ platform: 'linkedin', source: 'linkedin_organic', day: `2025-03-${String(10 + i).padStart(2, '0')}`, metrics: { impressions: 0, likes: 0 }, followers_estimated: false }));
  const fb = { platform: 'facebook', source: 'facebook_organic', day: '2025-03-10', metrics: { impressions: 500 }, followers_estimated: false };
  const manual = [{ platform: 'linkedin', day: '2025-03-10', organic_views: null, organic_impressions: 100, organic_video_views: null, organic_likes: 5, organic_comments: 1, organic_shares: 0, posts_published: 1 }, { platform: 'facebook', day: '2025-03-10', organic_views: null, organic_impressions: 900, organic_video_views: 10, organic_likes: 2, organic_comments: 0, organic_shares: 0, posts_published: 1 }];
  const merged = mergeFollowersLF(mergeLF([...zero, fb], manual), [{ platform: 'linkedin', day: '2025-03-16', total_followers: 33781, net_growth: 5, new_followers: 6 }]);
  const li = merged.find(d => d.platform === 'linkedin' && d.day === '2025-03-10')!;
  expectLF(li.metrics['impressions']).toBe(100); expectLF(li.metrics['clicks']).toBeUndefined();
  expectLF(merged.find(d => d.platform === 'facebook')!.metrics['impressions']).toBe(500);
  const f = merged.find(d => d.platform === 'linkedin' && d.day === '2025-03-16')!;
  expectLF(f.metrics['followers']).toBe(33781); expectLF(f.metrics['newFollowers']).toBe(6);
});
