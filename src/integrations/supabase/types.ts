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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ap_email_sync: {
        Row: {
          emails_synced: number | null
          folder_name: string
          id: string
          last_error: string | null
          last_message_date: string | null
          last_sync_at: string | null
          supabase_user_id: string | null
          sync_status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          emails_synced?: number | null
          folder_name?: string
          id?: string
          last_error?: string | null
          last_message_date?: string | null
          last_sync_at?: string | null
          supabase_user_id?: string | null
          sync_status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          emails_synced?: number | null
          folder_name?: string
          id?: string
          last_error?: string | null
          last_message_date?: string | null
          last_sync_at?: string | null
          supabase_user_id?: string | null
          sync_status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ap_emails: {
        Row: {
          body_content_type: string | null
          body_preview: string | null
          body_text: string | null
          created_at: string | null
          folder_name: string | null
          graph_message_id: string
          has_attachments: boolean | null
          id: string
          importance: string | null
          is_read: boolean | null
          received_at: string
          sender_address: string | null
          sender_name: string | null
          subject: string | null
          supabase_user_id: string | null
          synced_at: string | null
          to_recipients: Json | null
          user_id: string
        }
        Insert: {
          body_content_type?: string | null
          body_preview?: string | null
          body_text?: string | null
          created_at?: string | null
          folder_name?: string | null
          graph_message_id: string
          has_attachments?: boolean | null
          id?: string
          importance?: string | null
          is_read?: boolean | null
          received_at: string
          sender_address?: string | null
          sender_name?: string | null
          subject?: string | null
          supabase_user_id?: string | null
          synced_at?: string | null
          to_recipients?: Json | null
          user_id: string
        }
        Update: {
          body_content_type?: string | null
          body_preview?: string | null
          body_text?: string | null
          created_at?: string | null
          folder_name?: string | null
          graph_message_id?: string
          has_attachments?: boolean | null
          id?: string
          importance?: string | null
          is_read?: boolean | null
          received_at?: string
          sender_address?: string | null
          sender_name?: string | null
          subject?: string | null
          supabase_user_id?: string | null
          synced_at?: string | null
          to_recipients?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      automation_triggers: {
        Row: {
          action: Json
          condition: Json
          created_at: string
          enabled: boolean
          fire_count: number
          id: string
          label: string
          last_fired_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          action?: Json
          condition: Json
          created_at?: string
          enabled?: boolean
          fire_count?: number
          id?: string
          label: string
          last_fired_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: Json
          condition?: Json
          created_at?: string
          enabled?: boolean
          fire_count?: number
          id?: string
          label?: string
          last_fired_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_product_prices: {
        Row: {
          created_at: string | null
          customer_name: string
          id: string
          price_per_lb: number | null
          price_per_ton: number
          product_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_name: string
          id?: string
          price_per_lb?: number | null
          price_per_ton: number
          product_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_name?: string
          id?: string
          price_per_lb?: number | null
          price_per_ton?: number
          product_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      customer_profiles: {
        Row: {
          account_id: string | null
          account_name: string
          account_notes: string | null
          account_short_name: string | null
          account_type: string | null
          billing_city: string | null
          billing_company_name: string | null
          billing_country: string | null
          billing_state: string | null
          billing_street: string | null
          billing_zip: string | null
          created_at: string | null
          freight_terms: string | null
          id: string
          is_distributor_account: boolean | null
          parent_account: string | null
          payment_method: string | null
          payment_terms: string | null
          po_required: boolean | null
          quickbooks_name: string | null
          shipping_city: string | null
          shipping_company_name: string | null
          shipping_country: string | null
          shipping_state: string | null
          shipping_street: string | null
          shipping_zip: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          account_name: string
          account_notes?: string | null
          account_short_name?: string | null
          account_type?: string | null
          billing_city?: string | null
          billing_company_name?: string | null
          billing_country?: string | null
          billing_state?: string | null
          billing_street?: string | null
          billing_zip?: string | null
          created_at?: string | null
          freight_terms?: string | null
          id?: string
          is_distributor_account?: boolean | null
          parent_account?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          po_required?: boolean | null
          quickbooks_name?: string | null
          shipping_city?: string | null
          shipping_company_name?: string | null
          shipping_country?: string | null
          shipping_state?: string | null
          shipping_street?: string | null
          shipping_zip?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          account_name?: string
          account_notes?: string | null
          account_short_name?: string | null
          account_type?: string | null
          billing_city?: string | null
          billing_company_name?: string | null
          billing_country?: string | null
          billing_state?: string | null
          billing_street?: string | null
          billing_zip?: string | null
          created_at?: string | null
          freight_terms?: string | null
          id?: string
          is_distributor_account?: boolean | null
          parent_account?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          po_required?: boolean | null
          quickbooks_name?: string | null
          shipping_city?: string | null
          shipping_company_name?: string | null
          shipping_country?: string | null
          shipping_state?: string | null
          shipping_street?: string | null
          shipping_zip?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string
          data_profile: Json | null
          extracted_text: string | null
          file_type: string
          filename: string
          fingerprint: string | null
          id: string
          metadata: Json | null
          mime_type: string
          storage_path: string
          structured_data: Json | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          data_profile?: Json | null
          extracted_text?: string | null
          file_type: string
          filename: string
          fingerprint?: string | null
          id?: string
          metadata?: Json | null
          mime_type: string
          storage_path: string
          structured_data?: Json | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          data_profile?: Json | null
          extracted_text?: string | null
          file_type?: string
          filename?: string
          fingerprint?: string | null
          id?: string
          metadata?: Json | null
          mime_type?: string
          storage_path?: string
          structured_data?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ragic_connections: {
        Row: {
          account_name: string
          api_key_encrypted: string
          created_at: string | null
          customer_database: string | null
          customer_sheet_id: string | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          sheet_path: string
          shipment_sheet_path: string | null
          updated_at: string | null
        }
        Insert: {
          account_name: string
          api_key_encrypted: string
          created_at?: string | null
          customer_database?: string | null
          customer_sheet_id?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          sheet_path: string
          shipment_sheet_path?: string | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string
          api_key_encrypted?: string
          created_at?: string | null
          customer_database?: string | null
          customer_sheet_id?: string | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          sheet_path?: string
          shipment_sheet_path?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ragic_orders_cache: {
        Row: {
          actual_ship_date: string | null
          cached_at: string | null
          class_name: string | null
          customer_name: string | null
          customer_po: string | null
          delivery_date: string | null
          due_date: string | null
          has_shipped: boolean
          id: string
          invoice_date: string | null
          order_number: string | null
          payment_terms: string | null
          product_name: string | null
          quantity: number | null
          ragic_id: string
          raw_record: Json | null
          requested_delivery_date: string | null
          resolved_qb_customer_name: string | null
          status: string | null
          total_amount: number | null
          unit_price: number | null
          updated_at: string | null
        }
        Insert: {
          actual_ship_date?: string | null
          cached_at?: string | null
          class_name?: string | null
          customer_name?: string | null
          customer_po?: string | null
          delivery_date?: string | null
          due_date?: string | null
          has_shipped?: boolean
          id?: string
          invoice_date?: string | null
          order_number?: string | null
          payment_terms?: string | null
          product_name?: string | null
          quantity?: number | null
          ragic_id: string
          raw_record?: Json | null
          requested_delivery_date?: string | null
          resolved_qb_customer_name?: string | null
          status?: string | null
          total_amount?: number | null
          unit_price?: number | null
          updated_at?: string | null
        }
        Update: {
          actual_ship_date?: string | null
          cached_at?: string | null
          class_name?: string | null
          customer_name?: string | null
          customer_po?: string | null
          delivery_date?: string | null
          due_date?: string | null
          has_shipped?: boolean
          id?: string
          invoice_date?: string | null
          order_number?: string | null
          payment_terms?: string | null
          product_name?: string | null
          quantity?: number | null
          ragic_id?: string
          raw_record?: Json | null
          requested_delivery_date?: string | null
          resolved_qb_customer_name?: string | null
          status?: string | null
          total_amount?: number | null
          unit_price?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sherpa_memories: {
        Row: {
          confidence: number
          content: string
          created_at: string
          hit_count: number
          id: string
          is_active: boolean
          last_activated_at: string | null
          miss_count: number
          reasoning: string | null
          source: string
          superseded_by: string | null
          tags: string[]
          tier: string
          trigger: Json
          type: string
          user_id: string
        }
        Insert: {
          confidence?: number
          content: string
          created_at?: string
          hit_count?: number
          id?: string
          is_active?: boolean
          last_activated_at?: string | null
          miss_count?: number
          reasoning?: string | null
          source?: string
          superseded_by?: string | null
          tags?: string[]
          tier?: string
          trigger?: Json
          type: string
          user_id: string
        }
        Update: {
          confidence?: number
          content?: string
          created_at?: string
          hit_count?: number
          id?: string
          is_active?: boolean
          last_activated_at?: string | null
          miss_count?: number
          reasoning?: string | null
          source?: string
          superseded_by?: string | null
          tags?: string[]
          tier?: string
          trigger?: Json
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sherpa_memories_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "sherpa_memories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decay_stale_memories: {
        Args: {
          decay_factor?: number
          stale_threshold_days?: number
          target_user_id: string
        }
        Returns: undefined
      }
      increment_memory_hit: { Args: { memory_id: string }; Returns: undefined }
      increment_memory_miss: { Args: { memory_id: string }; Returns: undefined }
      increment_trigger_fire_count: {
        Args: { trigger_id: string }
        Returns: undefined
      }
      supersede_memory: {
        Args: { new_memory_id: string; old_memory_id: string }
        Returns: undefined
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
