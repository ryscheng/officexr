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
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['offices']['Row'], 'id' | 'created_at'>;
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
        };
        Insert: Omit<Database['public']['Tables']['office_members']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['office_members']['Insert']>;
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          office_id: string;
          inviter_id: string;
          email: string;
          role: 'admin' | 'member';
          token: string;
          status: 'pending' | 'accepted' | 'declined' | 'expired';
          expires_at: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['invitations']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['invitations']['Insert']>;
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: string;
          office_id: string;
          user_id: string | null;
          user_name: string | null;
          message: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['chat_messages']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['chat_messages']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
