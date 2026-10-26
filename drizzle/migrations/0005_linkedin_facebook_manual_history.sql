ALTER TABLE public.social_organic_history ADD COLUMN organic_impressions numeric, ADD COLUMN organic_video_views numeric;
ALTER TABLE public.social_follower_history DROP CONSTRAINT social_follower_history_platform_check;
ALTER TABLE public.social_follower_history ADD CONSTRAINT social_follower_history_platform_check CHECK (platform IN ('instagram','tiktok','linkedin','facebook'));
COMMENT ON COLUMN public.social_organic_history.organic_impressions IS 'Organic account impressions from agency export (LinkedIn/Facebook). Instagram uses organic_views.';