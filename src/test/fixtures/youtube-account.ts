import type { YoutubeData } from "../../lib/youtube";
import { range } from "./young-account";

/** Une chaîne YouTube connectée sur janvier-juin 2025 (mêmes mois que le compte de young-account) : des vues, des gains d'abonnés, deux vidéos publiées en mai et juin. */
export const youtubeConnected: YoutubeData = {
  days: range("2025-01-01", "2025-06-30").map((day) => ({
    day, views: 100, minutes_watched: 60, avg_view_duration_s: 30, subscribers_gained: 5, subscribers_lost: 1, likes: 3, comments: 1, shares: 1,
  })),
  videos: [
    { video_id: "v-may", published_at: "2025-05-12T10:00:00Z", title: "Video de mai", url: null, views: 500, likes: 10, comments: 2 },
    { video_id: "v-june", published_at: "2025-06-10T10:00:00Z", title: "Video de juin", url: null, views: 800, likes: 20, comments: 3 },
  ],
  snapshots: [{ day: "2025-06-30", subscriber_count: 2000 }],
  lastSuccess: "2025-07-01T05:00:00Z",
};
