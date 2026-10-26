export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_comments: {
        Row: {
          cache_key: string
          content: string
          created_at: string
          tab: string
        }
        Insert: {
          cache_key: string
          content: string
          created_at?: string
          tab: string
        }
        Update: {
          cache_key?: string
          content?: string
          created_at?: string
          tab?: string
        }
        Relationships: []
      }
      google_ads_daily: {
        Row: {
          account_id: string
          campaign_id: string
          campaign_name: string
          channel: string
          clicks: number
          conversions: number
          conversions_value: number
          cost: number
          day: string
          impressions: number
          synced_at: string
          video_views: number | null
        }
        Insert: {
          account_id: string
          campaign_id: string
          campaign_name?: string
          channel?: string
          clicks?: number
          conversions?: number
          conversions_value?: number
          cost?: number
          day: string
          impressions?: number
          synced_at?: string
          video_views?: number | null
        }
        Update: {
          account_id?: string
          campaign_id?: string
          campaign_name?: string
          channel?: string
          clicks?: number
          conversions?: number
          conversions_value?: number
          cost?: number
          day?: string
          impressions?: number
          synced_at?: string
          video_views?: number | null
        }
        Relationships: []
      }
      social_ad_coverage: {
        Row: {
          day: string
          source: string
          synced_at: string
        }
        Insert: {
          day: string
          source: string
          synced_at?: string
        }
        Update: {
          day?: string
          source?: string
          synced_at?: string
        }
        Relationships: []
      }
      social_ad_creative_daily: {
        Row: {
          ad_id: string
          comments: number | null
          day: string
          impressions: number
          likes: number | null
          platform: string
          post_id: string | null
          shares: number | null
          source: string
          spend: number
          synced_at: string
        }
        Insert: {
          ad_id: string
          comments?: number | null
          day: string
          impressions?: number
          likes?: number | null
          platform: string
          post_id?: string | null
          shares?: number | null
          source: string
          spend?: number
          synced_at?: string
        }
        Update: {
          ad_id?: string
          comments?: number | null
          day?: string
          impressions?: number
          likes?: number | null
          platform?: string
          post_id?: string | null
          shares?: number | null
          source?: string
          spend?: number
          synced_at?: string
        }
        Relationships: []
      }
      social_ad_creatives: {
        Row: {
          ad_id: string
          ad_name: string | null
          platform: string
          synced_at: string
          thumbnail_path: string | null
        }
        Insert: {
          ad_id: string
          ad_name?: string | null
          platform: string
          synced_at?: string
          thumbnail_path?: string | null
        }
        Update: {
          ad_id?: string
          ad_name?: string | null
          platform?: string
          synced_at?: string
          thumbnail_path?: string | null
        }
        Relationships: []
      }
      social_ad_daily: {
        Row: {
          ad_id: string
          day: string
          impressions: number
          platform: string
          source: string
          synced_at: string
        }
        Insert: {
          ad_id: string
          day: string
          impressions: number
          platform: string
          source: string
          synced_at?: string
        }
        Update: {
          ad_id?: string
          day?: string
          impressions?: number
          platform?: string
          source?: string
          synced_at?: string
        }
        Relationships: []
      }
      social_audience: {
        Row: {
          dimension: string
          label: string
          platform: string
          synced_at: string
          unit: string
          value: number
        }
        Insert: {
          dimension: string
          label: string
          platform: string
          synced_at?: string
          unit: string
          value: number
        }
        Update: {
          dimension?: string
          label?: string
          platform?: string
          synced_at?: string
          unit?: string
          value?: number
        }
        Relationships: []
      }
      social_daily: {
        Row: {
          day: string
          followers_estimated: boolean
          metrics: Json
          platform: string
          source: string
          synced_at: string
        }
        Insert: {
          day: string
          followers_estimated?: boolean
          metrics?: Json
          platform: string
          source: string
          synced_at?: string
        }
        Update: {
          day?: string
          followers_estimated?: boolean
          metrics?: Json
          platform?: string
          source?: string
          synced_at?: string
        }
        Relationships: []
      }
      social_follower_history: {
        Row: {
          day: string
          net_growth: number | null
          new_followers: number | null
          platform: string
          total_followers: number | null
        }
        Insert: {
          day: string
          net_growth?: number | null
          new_followers?: number | null
          platform: string
          total_followers?: number | null
        }
        Update: {
          day?: string
          net_growth?: number | null
          new_followers?: number | null
          platform?: string
          total_followers?: number | null
        }
        Relationships: []
      }
      social_import_jobs: {
        Row: {
          attempts: number
          date_from: string
          date_to: string
          error_message: string | null
          finished_at: string | null
          id: number
          priority: number
          source: string
          started_at: string | null
          state: string
        }
        Insert: {
          attempts?: number
          date_from: string
          date_to: string
          error_message?: string | null
          finished_at?: string | null
          id?: never
          priority?: number
          source: string
          started_at?: string | null
          state?: string
        }
        Update: {
          attempts?: number
          date_from?: string
          date_to?: string
          error_message?: string | null
          finished_at?: string | null
          id?: never
          priority?: number
          source?: string
          started_at?: string | null
          state?: string
        }
        Relationships: []
      }
      social_organic_history: {
        Row: {
          day: string
          imported_at: string
          organic_comments: number | null
          organic_impressions: number | null
          organic_likes: number | null
          organic_shares: number | null
          organic_video_views: number | null
          organic_views: number | null
          paid_views: number | null
          platform: string
          posts_published: number | null
        }
        Insert: {
          day: string
          imported_at?: string
          organic_comments?: number | null
          organic_impressions?: number | null
          organic_likes?: number | null
          organic_shares?: number | null
          organic_video_views?: number | null
          organic_views?: number | null
          paid_views?: number | null
          platform: string
          posts_published?: number | null
        }
        Update: {
          day?: string
          imported_at?: string
          organic_comments?: number | null
          organic_impressions?: number | null
          organic_likes?: number | null
          organic_shares?: number | null
          organic_video_views?: number | null
          organic_views?: number | null
          paid_views?: number | null
          platform?: string
          posts_published?: number | null
        }
        Relationships: []
      }
      social_post_ad_daily: {
        Row: {
          ad_id: string
          day: string
          impressions: number
          platform: string
          post_id: string
          source: string
          spend: number
          synced_at: string
        }
        Insert: {
          ad_id: string
          day: string
          impressions?: number
          platform: string
          post_id: string
          source: string
          spend?: number
          synced_at?: string
        }
        Update: {
          ad_id?: string
          day?: string
          impressions?: number
          platform?: string
          post_id?: string
          source?: string
          spend?: number
          synced_at?: string
        }
        Relationships: []
      }
      social_posts: {
        Row: {
          format: string
          metrics: Json
          permalink: string | null
          platform: string
          post_id: string
          published_at: string
          synced_at: string
          thumbnail_path: string | null
          title: string
        }
        Insert: {
          format?: string
          metrics?: Json
          permalink?: string | null
          platform: string
          post_id: string
          published_at: string
          synced_at?: string
          thumbnail_path?: string | null
          title?: string
        }
        Update: {
          format?: string
          metrics?: Json
          permalink?: string | null
          platform?: string
          post_id?: string
          published_at?: string
          synced_at?: string
          thumbnail_path?: string | null
          title?: string
        }
        Relationships: []
      }
      social_sync_status: {
        Row: {
          coverage: Json
          last_attempt_at: string | null
          last_success_at: string | null
          message: string | null
          source: string
          state: string
        }
        Insert: {
          coverage?: Json
          last_attempt_at?: string | null
          last_success_at?: string | null
          message?: string | null
          source: string
          state?: string
        }
        Update: {
          coverage?: Json
          last_attempt_at?: string | null
          last_success_at?: string | null
          message?: string | null
          source?: string
          state?: string
        }
        Relationships: []
      }
      youtube_daily: {
        Row: {
          avg_view_duration_s: number | null
          channel_id: string
          comments: number | null
          day: string
          likes: number | null
          minutes_watched: number | null
          shares: number | null
          subscribers_gained: number | null
          subscribers_lost: number | null
          synced_at: string
          views: number | null
        }
        Insert: {
          avg_view_duration_s?: number | null
          channel_id: string
          comments?: number | null
          day: string
          likes?: number | null
          minutes_watched?: number | null
          shares?: number | null
          subscribers_gained?: number | null
          subscribers_lost?: number | null
          synced_at?: string
          views?: number | null
        }
        Update: {
          avg_view_duration_s?: number | null
          channel_id?: string
          comments?: number | null
          day?: string
          likes?: number | null
          minutes_watched?: number | null
          shares?: number | null
          subscribers_gained?: number | null
          subscribers_lost?: number | null
          synced_at?: string
          views?: number | null
        }
        Relationships: []
      }
      youtube_subscriber_snapshots: {
        Row: {
          channel_id: string
          day: string
          subscriber_count: number
          synced_at: string
          video_count: number | null
        }
        Insert: {
          channel_id: string
          day: string
          subscriber_count: number
          synced_at?: string
          video_count?: number | null
        }
        Update: {
          channel_id?: string
          day?: string
          subscriber_count?: number
          synced_at?: string
          video_count?: number | null
        }
        Relationships: []
      }
      youtube_videos: {
        Row: {
          channel_id: string
          comments: number | null
          duration: string | null
          likes: number | null
          published_at: string
          synced_at: string
          thumbnail_path: string | null
          title: string
          url: string | null
          video_id: string
          views: number | null
        }
        Insert: {
          channel_id: string
          comments?: number | null
          duration?: string | null
          likes?: number | null
          published_at: string
          synced_at?: string
          thumbnail_path?: string | null
          title?: string
          url?: string | null
          video_id: string
          views?: number | null
        }
        Update: {
          channel_id?: string
          comments?: number | null
          duration?: string | null
          likes?: number | null
          published_at?: string
          synced_at?: string
          thumbnail_path?: string | null
          title?: string
          url?: string | null
          video_id?: string
          views?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_social_import_job: {
        Args: never
        Returns: {
          attempts: number
          date_from: string
          date_to: string
          error_message: string | null
          finished_at: string | null
          id: number
          priority: number
          source: string
          started_at: string | null
          state: string
        }[]
        SetofOptions: {
          from: "*"
          to: "social_import_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
