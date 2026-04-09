import { createClient } from '@supabase/supabase-js';

// NOTE: @supabase/postgrest-js ≥ v1.17 (supabase-js ≥ v2.50) requires every table to
// have a `Relationships` field and the schema to have `Views` and `Functions`.
export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          name: string | null;
          email: string | null;
          avatar_url: string | null;
          avatar_body_color: string;
          avatar_skin_color: string;
          avatar_style: string;
          avatar_accessories: string[];
          avatar_preset_id: string | null;
          avatar_model_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          avatar_body_color?: string;
          avatar_skin_color?: string;
          avatar_style?: string;
          avatar_accessories?: string[];
          avatar_preset_id?: string | null;
          avatar_model_url?: string | null;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      offices: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          link_access: boolean;
          environment: string;
          created_at: string;
        };
        Insert: { id?: string; name: string; description?: string | null; link_access?: boolean; environment?: string };
        Update: Partial<Database['public']['Tables']['offices']['Insert']>;
        Relationships: [];
      };
      office_members: {
        Row: {
          id: string;
          office_id: string;
          user_id: string;
          role: 'owner' | 'admin' | 'member';
          created_at: string;
          avatar_body_color: string | null;
          avatar_skin_color: string | null;
          avatar_style: string | null;
          avatar_accessories: string[] | null;
          avatar_preset_id: string | null;
          avatar_model_url: string | null;
        };
        Insert: {
          office_id: string;
          user_id: string;
          role: 'owner' | 'admin' | 'member';
          avatar_body_color?: string | null;
          avatar_skin_color?: string | null;
          avatar_style?: string | null;
          avatar_accessories?: string[] | null;
          avatar_preset_id?: string | null;
          avatar_model_url?: string | null;
        };
        Update: Partial<Database['public']['Tables']['office_members']['Insert']>;
        Relationships: [];
      };
      office_skins: {
        Row: {
          id: string;
          office_id: string;
          name: string;
          model_url: string;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          office_id: string;
          name: string;
          model_url: string;
          uploaded_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['office_skins']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      join_office_if_allowed: {
        Args: { p_office_id: string };
        Returns: 'ready' | 'denied' | 'not-found';
      };
    };
  };
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey);
