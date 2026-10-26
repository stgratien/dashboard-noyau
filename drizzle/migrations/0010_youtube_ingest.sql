CREATE TABLE public.youtube_daily (
 day date PRIMARY KEY, channel_id text NOT NULL,
 views numeric, minutes_watched numeric, avg_view_duration_s numeric,
 subscribers_gained numeric, subscribers_lost numeric, likes numeric, comments numeric, shares numeric,
 synced_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.youtube_daily TO service_role;
ALTER TABLE public.youtube_daily ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.youtube_videos (
 video_id text PRIMARY KEY, channel_id text NOT NULL, published_at timestamptz NOT NULL,
 title text NOT NULL DEFAULT '', url text, thumbnail_path text, duration text,
 views numeric, likes numeric, comments numeric, synced_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.youtube_videos TO service_role;
ALTER TABLE public.youtube_videos ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.youtube_subscriber_snapshots (
 day date PRIMARY KEY, channel_id text NOT NULL, subscriber_count numeric NOT NULL, video_count numeric,
 synced_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.youtube_subscriber_snapshots TO service_role;
ALTER TABLE public.youtube_subscriber_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read safe sync status" ON public.social_sync_status;
CREATE POLICY "Read safe sync status" ON public.social_sync_status FOR SELECT TO anon, authenticated USING (source = ANY (ARRAY['facebook','facebook_organic','instagram','tiktok','tiktok_organic','linkedin','linkedin_organic','google_ads','youtube']));