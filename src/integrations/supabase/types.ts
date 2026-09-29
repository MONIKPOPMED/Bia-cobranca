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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_secrets: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          id: string
          key_name: string
          metadata: Json
          provider: string
          updated_at: string
          vault_secret_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_name: string
          metadata?: Json
          provider: string
          updated_at?: string
          vault_secret_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_name?: string
          metadata?: Json
          provider?: string
          updated_at?: string
          vault_secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_secrets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_users: {
        Row: {
          account_id: string
          active_at: string | null
          auto_offline: boolean
          availability: Database["public"]["Enums"]["user_availability"]
          created_at: string
          id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          active_at?: string | null
          auto_offline?: boolean
          availability?: Database["public"]["Enums"]["user_availability"]
          created_at?: string
          id?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          active_at?: string | null
          auto_offline?: boolean
          availability?: Database["public"]["Enums"]["user_availability"]
          created_at?: string
          id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_users_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          dialing_settings: Json
          domain: string | null
          feature_flags: Json
          id: string
          internal_attributes: Json
          is_primary: boolean
          locale: string
          name: string
          settings: Json
          status: Database["public"]["Enums"]["account_status"]
          support_email: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dialing_settings?: Json
          domain?: string | null
          feature_flags?: Json
          id?: string
          internal_attributes?: Json
          is_primary?: boolean
          locale?: string
          name: string
          settings?: Json
          status?: Database["public"]["Enums"]["account_status"]
          support_email?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dialing_settings?: Json
          domain?: string | null
          feature_flags?: Json
          id?: string
          internal_attributes?: Json
          is_primary?: boolean
          locale?: string
          name?: string
          settings?: Json
          status?: Database["public"]["Enums"]["account_status"]
          support_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_persona_deployments: {
        Row: {
          account_id: string
          autonomy: string
          confidence_threshold: number
          created_at: string
          daily_message_budget: number
          enabled: boolean
          id: number
          inbox_id: string
          last_reset_at: string
          messages_sent_today: number
          mode: string
          persona_id: string
          schedule: Json
          updated_at: string
        }
        Insert: {
          account_id: string
          autonomy?: string
          confidence_threshold?: number
          created_at?: string
          daily_message_budget?: number
          enabled?: boolean
          id?: never
          inbox_id: string
          last_reset_at?: string
          messages_sent_today?: number
          mode?: string
          persona_id: string
          schedule?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string
          autonomy?: string
          confidence_threshold?: number
          created_at?: string
          daily_message_budget?: number
          enabled?: boolean
          id?: never
          inbox_id?: string
          last_reset_at?: string
          messages_sent_today?: number
          mode?: string
          persona_id?: string
          schedule?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_persona_deployments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_persona_deployments_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_persona_deployments_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_persona_samples: {
        Row: {
          category: string | null
          conversation_id: string | null
          created_at: string
          id: number
          message_id: string | null
          persona_id: string
          representativeness: number
          text: string
        }
        Insert: {
          category?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: never
          message_id?: string | null
          persona_id: string
          representativeness?: number
          text: string
        }
        Update: {
          category?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: never
          message_id?: string | null
          persona_id?: string
          representativeness?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_persona_samples_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_persona_samples_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_persona_samples_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_personas: {
        Row: {
          account_id: string
          asr_keywords: string[]
          config: Json
          created_at: string
          description: string | null
          elevenlabs_agent_id: string | null
          elevenlabs_knowledge_base_ids: Json
          enabled: boolean
          first_message: string | null
          id: string
          llm_max_tokens: number
          llm_model: string
          llm_temperature: number
          name: string
          sample_count: number
          source_user_id: string | null
          status: Database["public"]["Enums"]["persona_status"]
          style_profile: Json
          system_prompt: string | null
          tts_config: Json
          turn_config: Json
          updated_at: string
          version: number
          voice_clone_id: string | null
          voice_config: Json
          voice_provider: string | null
        }
        Insert: {
          account_id: string
          asr_keywords?: string[]
          config?: Json
          created_at?: string
          description?: string | null
          elevenlabs_agent_id?: string | null
          elevenlabs_knowledge_base_ids?: Json
          enabled?: boolean
          first_message?: string | null
          id?: string
          llm_max_tokens?: number
          llm_model?: string
          llm_temperature?: number
          name: string
          sample_count?: number
          source_user_id?: string | null
          status?: Database["public"]["Enums"]["persona_status"]
          style_profile?: Json
          system_prompt?: string | null
          tts_config?: Json
          turn_config?: Json
          updated_at?: string
          version?: number
          voice_clone_id?: string | null
          voice_config?: Json
          voice_provider?: string | null
        }
        Update: {
          account_id?: string
          asr_keywords?: string[]
          config?: Json
          created_at?: string
          description?: string | null
          elevenlabs_agent_id?: string | null
          elevenlabs_knowledge_base_ids?: Json
          enabled?: boolean
          first_message?: string | null
          id?: string
          llm_max_tokens?: number
          llm_model?: string
          llm_temperature?: number
          name?: string
          sample_count?: number
          source_user_id?: string | null
          status?: Database["public"]["Enums"]["persona_status"]
          style_profile?: Json
          system_prompt?: string | null
          tts_config?: Json
          turn_config?: Json
          updated_at?: string
          version?: number
          voice_clone_id?: string | null
          voice_config?: Json
          voice_provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_personas_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          secret_refs: Json
          supabase_publishable_key: string | null
          supabase_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          secret_refs?: Json
          supabase_publishable_key?: string | null
          supabase_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          secret_refs?: Json
          supabase_publishable_key?: string | null
          supabase_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          account_id: string
          action: string
          created_at: string
          id: number
          ip_address: string | null
          metadata: Json
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          account_id: string
          action: string
          created_at?: string
          id?: number
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          created_at?: string
          id?: number
          ip_address?: string | null
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_integrations: {
        Row: {
          account_id: string
          config: Json
          created_at: string
          enabled: boolean
          id: string
          last_synced_at: string | null
          no_show_detection_minutes: number
          provider: string
          updated_at: string
        }
        Insert: {
          account_id: string
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          last_synced_at?: string | null
          no_show_detection_minutes?: number
          provider: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          last_synced_at?: string | null
          no_show_detection_minutes?: number
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_integrations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      call_attempts_log: {
        Row: {
          account_id: string
          attempt_at: string
          campaign_id: string | null
          contact_id: string | null
          id: number
          outcome: string | null
          phone_number: string
          voice_call_id: string | null
        }
        Insert: {
          account_id: string
          attempt_at?: string
          campaign_id?: string | null
          contact_id?: string | null
          id?: never
          outcome?: string | null
          phone_number: string
          voice_call_id?: string | null
        }
        Update: {
          account_id?: string
          attempt_at?: string
          campaign_id?: string | null
          contact_id?: string | null
          id?: never
          outcome?: string | null
          phone_number?: string
          voice_call_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_log_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_runs: {
        Row: {
          account_id: string
          contact_count: number
          created_at: string
          error_count: number
          errors: Json
          finished_at: string | null
          id: number
          inbox_id: string
          message_template: string | null
          persona_id: string
          sent_count: number
          skipped_count: number
          triggered_by_id: string | null
          used_ai: boolean
        }
        Insert: {
          account_id: string
          contact_count?: number
          created_at?: string
          error_count?: number
          errors?: Json
          finished_at?: string | null
          id?: number
          inbox_id: string
          message_template?: string | null
          persona_id: string
          sent_count?: number
          skipped_count?: number
          triggered_by_id?: string | null
          used_ai?: boolean
        }
        Update: {
          account_id?: string
          contact_count?: number
          created_at?: string
          error_count?: number
          errors?: Json
          finished_at?: string | null
          id?: number
          inbox_id?: string
          message_template?: string | null
          persona_id?: string
          sent_count?: number
          skipped_count?: number
          triggered_by_id?: string | null
          used_ai?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "campaign_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_runs_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_runs_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          account_id: string
          channel_type: Database["public"]["Enums"]["channel_type"]
          config: Json
          created_at: string
          enabled: boolean
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          channel_type: Database["public"]["Enums"]["channel_type"]
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          channel_type?: Database["public"]["Enums"]["channel_type"]
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          account_id: string
          created_at: string
          domain: string | null
          id: string
          industry: string | null
          metadata: Json
          name: string
          size: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          domain?: string | null
          id?: string
          industry?: string | null
          metadata?: Json
          name: string
          size?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          domain?: string | null
          id?: string
          industry?: string | null
          metadata?: Json
          name?: string
          size?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          account_id: string
          attempt_gap_minutes: number
          cnpj: string | null
          collection_window: Json
          company_name: string
          created_at: string
          default_agent_id: string | null
          default_discount_pct: number | null
          default_max_installments: number | null
          legal_footer: string | null
          logo_url: string | null
          max_attempts_per_debtor: number
          record_calls: boolean
          recording_retention_days: number
          reply_email: string | null
          support_phone: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          attempt_gap_minutes?: number
          cnpj?: string | null
          collection_window?: Json
          company_name: string
          created_at?: string
          default_agent_id?: string | null
          default_discount_pct?: number | null
          default_max_installments?: number | null
          legal_footer?: string | null
          logo_url?: string | null
          max_attempts_per_debtor?: number
          record_calls?: boolean
          recording_retention_days?: number
          reply_email?: string | null
          support_phone?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          attempt_gap_minutes?: number
          cnpj?: string | null
          collection_window?: Json
          company_name?: string
          created_at?: string
          default_agent_id?: string | null
          default_discount_pct?: number | null
          default_max_installments?: number | null
          legal_footer?: string | null
          logo_url?: string | null
          max_attempts_per_debtor?: number
          record_calls?: boolean
          recording_retention_days?: number
          reply_email?: string | null
          support_phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_default_agent_id_fkey"
            columns: ["default_agent_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_dossiers: {
        Row: {
          account_id: string
          briefing: string
          contact_id: string
          embedding: string | null
          generated_at: string
          highlights: Json
          node_count: number
          stale_after: string
        }
        Insert: {
          account_id: string
          briefing?: string
          contact_id: string
          embedding?: string | null
          generated_at?: string
          highlights?: Json
          node_count?: number
          stale_after?: string
        }
        Update: {
          account_id?: string
          briefing?: string
          contact_id?: string
          embedding?: string | null
          generated_at?: string
          highlights?: Json
          node_count?: number
          stale_after?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_dossiers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_dossiers_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_facts: {
        Row: {
          account_id: string
          confidence: number
          contact_id: string
          created_at: string
          id: number
          key: string
          source_node_id: number | null
          updated_at: string
          value: string | null
          value_numeric: number | null
        }
        Insert: {
          account_id: string
          confidence?: number
          contact_id: string
          created_at?: string
          id?: never
          key: string
          source_node_id?: number | null
          updated_at?: string
          value?: string | null
          value_numeric?: number | null
        }
        Update: {
          account_id?: string
          confidence?: number
          contact_id?: string
          created_at?: string
          id?: never
          key?: string
          source_node_id?: number | null
          updated_at?: string
          value?: string | null
          value_numeric?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_facts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_facts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_facts_source_node_id_fkey"
            columns: ["source_node_id"]
            isOneToOne: false
            referencedRelation: "customer_memory_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_inboxes: {
        Row: {
          contact_id: string
          created_at: string
          hmac_verified: boolean
          id: string
          inbox_id: string
          pubsub_token: string | null
          source_id: string | null
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          hmac_verified?: boolean
          id?: string
          inbox_id: string
          pubsub_token?: string | null
          source_id?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          hmac_verified?: boolean
          id?: string
          inbox_id?: string
          pubsub_token?: string | null
          source_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_inboxes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_inboxes_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          account_id: string
          color: string | null
          contact_id: string
          created_at: string
          created_by_id: string | null
          description: string | null
          id: string
          tag: string
        }
        Insert: {
          account_id: string
          color?: string | null
          contact_id: string
          created_at?: string
          created_by_id?: string | null
          description?: string | null
          id?: string
          tag: string
        }
        Update: {
          account_id?: string
          color?: string | null
          contact_id?: string
          created_at?: string
          created_by_id?: string | null
          description?: string | null
          id?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string
          additional_attributes: Json
          blocked: boolean
          company_id: string | null
          country_code: string | null
          created_at: string
          custom_attributes: Json
          email: string | null
          id: string
          identifier: string | null
          last_activity_at: string | null
          location: string | null
          name: string | null
          phone_number: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          additional_attributes?: Json
          blocked?: boolean
          company_id?: string | null
          country_code?: string | null
          created_at?: string
          custom_attributes?: Json
          email?: string | null
          id?: string
          identifier?: string | null
          last_activity_at?: string | null
          location?: string | null
          name?: string | null
          phone_number?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          additional_attributes?: Json
          blocked?: boolean
          company_id?: string | null
          country_code?: string | null
          created_at?: string
          custom_attributes?: Json
          email?: string | null
          id?: string
          identifier?: string | null
          last_activity_at?: string | null
          location?: string | null
          name?: string | null
          phone_number?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_checkpoints: {
        Row: {
          account_id: string
          branch_note: string | null
          branched_from_id: number | null
          conversation_id: string
          created_at: string
          created_by_id: string | null
          id: number
          message_id: string | null
          state: Json
        }
        Insert: {
          account_id: string
          branch_note?: string | null
          branched_from_id?: number | null
          conversation_id: string
          created_at?: string
          created_by_id?: string | null
          id?: number
          message_id?: string | null
          state?: Json
        }
        Update: {
          account_id?: string
          branch_note?: string | null
          branched_from_id?: number | null
          conversation_id?: string
          created_at?: string
          created_by_id?: string | null
          id?: number
          message_id?: string | null
          state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "conversation_checkpoints_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_checkpoints_branched_from_id_fkey"
            columns: ["branched_from_id"]
            isOneToOne: false
            referencedRelation: "conversation_checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_checkpoints_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_checkpoints_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_outcomes: {
        Row: {
          account_id: string
          confidence: number
          contact_id: string | null
          conversation_id: string
          created_at: string
          currency: string | null
          id: number
          metadata: Json
          observed_at: string
          outcome_type: string
          source: string
          value: number | null
        }
        Insert: {
          account_id: string
          confidence?: number
          contact_id?: string | null
          conversation_id: string
          created_at?: string
          currency?: string | null
          id?: never
          metadata?: Json
          observed_at?: string
          outcome_type: string
          source?: string
          value?: number | null
        }
        Update: {
          account_id?: string
          confidence?: number
          contact_id?: string | null
          conversation_id?: string
          created_at?: string
          currency?: string | null
          id?: never
          metadata?: Json
          observed_at?: string
          outcome_type?: string
          source?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_outcomes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_outcomes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_outcomes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_replays: {
        Row: {
          account_id: string
          checkpoint_id: number | null
          cost_cents: number
          created_at: string
          created_by_id: string | null
          edited_message: string
          finished_at: string | null
          id: number
          judge_notes: string | null
          original_conversation_id: string
          outcome_delta: number | null
          outcome_score: number | null
          persona_id: string | null
          simulated_outcome: string | null
          status: string
          transcript: Json
        }
        Insert: {
          account_id: string
          checkpoint_id?: number | null
          cost_cents?: number
          created_at?: string
          created_by_id?: string | null
          edited_message: string
          finished_at?: string | null
          id?: number
          judge_notes?: string | null
          original_conversation_id: string
          outcome_delta?: number | null
          outcome_score?: number | null
          persona_id?: string | null
          simulated_outcome?: string | null
          status?: string
          transcript?: Json
        }
        Update: {
          account_id?: string
          checkpoint_id?: number | null
          cost_cents?: number
          created_at?: string
          created_by_id?: string | null
          edited_message?: string
          finished_at?: string | null
          id?: number
          judge_notes?: string | null
          original_conversation_id?: string
          outcome_delta?: number | null
          outcome_score?: number | null
          persona_id?: string | null
          simulated_outcome?: string | null
          status?: string
          transcript?: Json
        }
        Relationships: [
          {
            foreignKeyName: "conversation_replays_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_replays_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "conversation_checkpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_replays_original_conversation_id_fkey"
            columns: ["original_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_replays_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_signals: {
        Row: {
          account_id: string
          action: string | null
          conversation_id: string
          detected_at: string
          id: number
          kind: string
          message_id: string | null
          payload: Json
          severity: number
        }
        Insert: {
          account_id: string
          action?: string | null
          conversation_id: string
          detected_at?: string
          id?: never
          kind: string
          message_id?: string | null
          payload?: Json
          severity?: number
        }
        Update: {
          account_id?: string
          action?: string | null
          conversation_id?: string
          detected_at?: string
          id?: never
          kind?: string
          message_id?: string | null
          payload?: Json
          severity?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_signals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_signals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_signals_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          account_id: string
          additional_attributes: Json
          agent_last_seen_at: string | null
          assignee_agent_bot_id: string | null
          assignee_id: string | null
          cached_label_list: string | null
          campaign_id: string | null
          contact_id: string
          contact_last_seen_at: string | null
          created_at: string
          custom_attributes: Json
          display_id: number
          first_reply_created_at: string | null
          id: string
          identifier: string | null
          inbox_id: string
          last_activity_at: string
          last_customer_msg_at: string | null
          priority: number | null
          sla_policy_id: string | null
          snoozed_until: string | null
          status: number
          team_id: string | null
          updated_at: string
          uuid: string | null
          waiting_since: string | null
        }
        Insert: {
          account_id: string
          additional_attributes?: Json
          agent_last_seen_at?: string | null
          assignee_agent_bot_id?: string | null
          assignee_id?: string | null
          cached_label_list?: string | null
          campaign_id?: string | null
          contact_id: string
          contact_last_seen_at?: string | null
          created_at?: string
          custom_attributes?: Json
          display_id?: number
          first_reply_created_at?: string | null
          id?: string
          identifier?: string | null
          inbox_id: string
          last_activity_at?: string
          last_customer_msg_at?: string | null
          priority?: number | null
          sla_policy_id?: string | null
          snoozed_until?: string | null
          status?: number
          team_id?: string | null
          updated_at?: string
          uuid?: string | null
          waiting_since?: string | null
        }
        Update: {
          account_id?: string
          additional_attributes?: Json
          agent_last_seen_at?: string | null
          assignee_agent_bot_id?: string | null
          assignee_id?: string | null
          cached_label_list?: string | null
          campaign_id?: string | null
          contact_id?: string
          contact_last_seen_at?: string | null
          created_at?: string
          custom_attributes?: Json
          display_id?: number
          first_reply_created_at?: string | null
          id?: string
          identifier?: string | null
          inbox_id?: string
          last_activity_at?: string
          last_customer_msg_at?: string | null
          priority?: number | null
          sla_policy_id?: string | null
          snoozed_until?: string | null
          status?: number
          team_id?: string | null
          updated_at?: string
          uuid?: string | null
          waiting_since?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      csat_surveys: {
        Row: {
          account_id: string
          answered_at: string | null
          contact_id: string | null
          conversation_id: string
          expires_at: string
          feedback: string | null
          handler_id: string | null
          handler_type: string | null
          id: string
          rating: number | null
          sent_at: string
          status: string
        }
        Insert: {
          account_id: string
          answered_at?: string | null
          contact_id?: string | null
          conversation_id: string
          expires_at?: string
          feedback?: string | null
          handler_id?: string | null
          handler_type?: string | null
          id?: string
          rating?: number | null
          sent_at?: string
          status?: string
        }
        Update: {
          account_id?: string
          answered_at?: string | null
          contact_id?: string | null
          conversation_id?: string
          expires_at?: string
          feedback?: string | null
          handler_id?: string | null
          handler_type?: string | null
          id?: string
          rating?: number | null
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "csat_surveys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csat_surveys_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csat_surveys_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_memory_edges: {
        Row: {
          account_id: string
          created_at: string
          from_contact_id: string | null
          from_node_id: number | null
          id: number
          metadata: Json
          relation: string
          to_contact_id: string | null
          to_node_id: number | null
          weight: number
        }
        Insert: {
          account_id: string
          created_at?: string
          from_contact_id?: string | null
          from_node_id?: number | null
          id?: never
          metadata?: Json
          relation: string
          to_contact_id?: string | null
          to_node_id?: number | null
          weight?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          from_contact_id?: string | null
          from_node_id?: number | null
          id?: never
          metadata?: Json
          relation?: string
          to_contact_id?: string | null
          to_node_id?: number | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_memory_edges_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_edges_from_contact_id_fkey"
            columns: ["from_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_edges_from_node_id_fkey"
            columns: ["from_node_id"]
            isOneToOne: false
            referencedRelation: "customer_memory_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_edges_to_contact_id_fkey"
            columns: ["to_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_edges_to_node_id_fkey"
            columns: ["to_node_id"]
            isOneToOne: false
            referencedRelation: "customer_memory_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_memory_nodes: {
        Row: {
          account_id: string
          confidence: number
          contact_id: string
          content: string | null
          created_at: string
          embedding: string | null
          expires_at: string | null
          id: number
          importance: number
          kind: string
          metadata: Json
          source_conversation_id: string | null
          source_message_id: string | null
          summary: string
          updated_at: string
        }
        Insert: {
          account_id: string
          confidence?: number
          contact_id: string
          content?: string | null
          created_at?: string
          embedding?: string | null
          expires_at?: string | null
          id?: never
          importance?: number
          kind: string
          metadata?: Json
          source_conversation_id?: string | null
          source_message_id?: string | null
          summary: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          confidence?: number
          contact_id?: string
          content?: string | null
          created_at?: string
          embedding?: string | null
          expires_at?: string | null
          id?: never
          importance?: number
          kind?: string
          metadata?: Json
          source_conversation_id?: string | null
          source_message_id?: string | null
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_memory_nodes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_nodes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_nodes_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_memory_nodes_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          confirmation_id: string
          created_at: string
          email: string | null
          external_identifier: string | null
          id: string
          ip_address: unknown
          meta_user_id: string | null
          notes: string | null
          processed_at: string | null
          processed_by_user_id: string | null
          raw_payload: Json | null
          reason: string | null
          source: string
          status: string
          user_agent: string | null
        }
        Insert: {
          confirmation_id?: string
          created_at?: string
          email?: string | null
          external_identifier?: string | null
          id?: string
          ip_address?: unknown
          meta_user_id?: string | null
          notes?: string | null
          processed_at?: string | null
          processed_by_user_id?: string | null
          raw_payload?: Json | null
          reason?: string | null
          source: string
          status?: string
          user_agent?: string | null
        }
        Update: {
          confirmation_id?: string
          created_at?: string
          email?: string | null
          external_identifier?: string | null
          id?: string
          ip_address?: unknown
          meta_user_id?: string | null
          notes?: string | null
          processed_at?: string | null
          processed_by_user_id?: string | null
          raw_payload?: Json | null
          reason?: string | null
          source?: string
          status?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      debtor_profiles: {
        Row: {
          account_id: string
          contact_id: string
          created_at: string
          doc_number: string | null
          doc_type: Database["public"]["Enums"]["doc_type"] | null
          external_ref: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          contact_id: string
          created_at?: string
          doc_number?: string | null
          doc_type?: Database["public"]["Enums"]["doc_type"] | null
          external_ref?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          contact_id?: string
          created_at?: string
          doc_number?: string | null
          doc_type?: Database["public"]["Enums"]["doc_type"] | null
          external_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "debtor_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debtor_profiles_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          account_id: string
          attempts_count: number
          contact_id: string
          created_at: string
          descricao: string | null
          external_ref: string | null
          id: string
          imported_at: string
          last_call_at: string | null
          last_synced_at: string | null
          metadata: Json
          origem: string | null
          source: string
          status: Database["public"]["Enums"]["debt_status"]
          updated_at: string
          valor_atual: number
          valor_original: number
          vencimento: string
        }
        Insert: {
          account_id: string
          attempts_count?: number
          contact_id: string
          created_at?: string
          descricao?: string | null
          external_ref?: string | null
          id?: string
          imported_at?: string
          last_call_at?: string | null
          last_synced_at?: string | null
          metadata?: Json
          origem?: string | null
          source?: string
          status?: Database["public"]["Enums"]["debt_status"]
          updated_at?: string
          valor_atual: number
          valor_original: number
          vencimento: string
        }
        Update: {
          account_id?: string
          attempts_count?: number
          contact_id?: string
          created_at?: string
          descricao?: string | null
          external_ref?: string | null
          id?: string
          imported_at?: string
          last_call_at?: string | null
          last_synced_at?: string | null
          metadata?: Json
          origem?: string | null
          source?: string
          status?: Database["public"]["Enums"]["debt_status"]
          updated_at?: string
          valor_atual?: number
          valor_original?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      dnc_list: {
        Row: {
          account_id: string
          added_by: string | null
          created_at: string
          id: number
          metadata: Json
          notes: string | null
          phone_e164: string | null
          phone_number: string
          reason: string | null
          registered_at: string
          registered_by: string | null
          source: string | null
        }
        Insert: {
          account_id: string
          added_by?: string | null
          created_at?: string
          id?: never
          metadata?: Json
          notes?: string | null
          phone_e164?: string | null
          phone_number: string
          reason?: string | null
          registered_at?: string
          registered_by?: string | null
          source?: string | null
        }
        Update: {
          account_id?: string
          added_by?: string | null
          created_at?: string
          id?: never
          metadata?: Json
          notes?: string | null
          phone_e164?: string | null
          phone_number?: string
          reason?: string | null
          registered_at?: string
          registered_by?: string | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dnc_list_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      elevenlabs_usage_log: {
        Row: {
          account_id: string
          character_count: number
          created_at: string
          id: number
          metadata: Json
          model_id: string | null
          purpose: string
          voice_id: string | null
        }
        Insert: {
          account_id: string
          character_count?: number
          created_at?: string
          id?: number
          metadata?: Json
          model_id?: string | null
          purpose?: string
          voice_id?: string | null
        }
        Update: {
          account_id?: string
          character_count?: number
          created_at?: string
          id?: number
          metadata?: Json
          model_id?: string | null
          purpose?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "elevenlabs_usage_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_rules: {
        Row: {
          account_id: string
          action: string
          created_at: string
          enabled: boolean
          id: string
          keywords: Json
          name: string
          priority: number
          target_number: string | null
          updated_at: string
          voicemail_message: string | null
        }
        Insert: {
          account_id: string
          action?: string
          created_at?: string
          enabled?: boolean
          id?: string
          keywords?: Json
          name: string
          priority?: number
          target_number?: string | null
          updated_at?: string
          voicemail_message?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          created_at?: string
          enabled?: boolean
          id?: string
          keywords?: Json
          name?: string
          priority?: number
          target_number?: string | null
          updated_at?: string
          voicemail_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalation_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_conversations: {
        Row: {
          cost_cents: number
          created_at: string
          decisive_turn_index: number | null
          duration_ms: number | null
          eval_run_id: number
          finished_at: string | null
          id: number
          judge_notes: string | null
          outcome: string | null
          outcome_score: number | null
          scenario_id: number
          transcript: Json
          turns: number
        }
        Insert: {
          cost_cents?: number
          created_at?: string
          decisive_turn_index?: number | null
          duration_ms?: number | null
          eval_run_id: number
          finished_at?: string | null
          id?: number
          judge_notes?: string | null
          outcome?: string | null
          outcome_score?: number | null
          scenario_id: number
          transcript?: Json
          turns?: number
        }
        Update: {
          cost_cents?: number
          created_at?: string
          decisive_turn_index?: number | null
          duration_ms?: number | null
          eval_run_id?: number
          finished_at?: string | null
          id?: number
          judge_notes?: string | null
          outcome?: string | null
          outcome_score?: number | null
          scenario_id?: number
          transcript?: Json
          turns?: number
        }
        Relationships: [
          {
            foreignKeyName: "eval_conversations_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_conversations_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "eval_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_runs: {
        Row: {
          account_id: string
          avg_latency_ms: number | null
          avg_outcome_score: number | null
          avg_turns: number | null
          baseline_prompt_version_id: number | null
          conversations_run: number
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: number
          name: string
          persona_id: string | null
          prompt_version_id: number | null
          scenario_count: number
          started_at: string | null
          status: string
          total_cost_cents: number
          updated_at: string
          verdict: string | null
          verdict_reason: string | null
          win_rate: number | null
        }
        Insert: {
          account_id: string
          avg_latency_ms?: number | null
          avg_outcome_score?: number | null
          avg_turns?: number | null
          baseline_prompt_version_id?: number | null
          conversations_run?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: number
          name: string
          persona_id?: string | null
          prompt_version_id?: number | null
          scenario_count?: number
          started_at?: string | null
          status?: string
          total_cost_cents?: number
          updated_at?: string
          verdict?: string | null
          verdict_reason?: string | null
          win_rate?: number | null
        }
        Update: {
          account_id?: string
          avg_latency_ms?: number | null
          avg_outcome_score?: number | null
          avg_turns?: number | null
          baseline_prompt_version_id?: number | null
          conversations_run?: number
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: number
          name?: string
          persona_id?: string | null
          prompt_version_id?: number | null
          scenario_count?: number
          started_at?: string | null
          status?: string
          total_cost_cents?: number
          updated_at?: string
          verdict?: string | null
          verdict_reason?: string | null
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "eval_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_baseline_prompt_version_id_fkey"
            columns: ["baseline_prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_runs_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_scenarios: {
        Row: {
          account_id: string
          created_at: string
          customer_profile: Json
          difficulty: number
          enabled: boolean
          goal: string
          hidden_traits: Json
          id: number
          name: string
          source: string
          source_conversation_id: string | null
          success_criteria: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          customer_profile?: Json
          difficulty?: number
          enabled?: boolean
          goal: string
          hidden_traits?: Json
          id?: number
          name: string
          source?: string
          source_conversation_id?: string | null
          success_criteria?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          customer_profile?: Json
          difficulty?: number
          enabled?: boolean
          goal?: string
          hidden_traits?: Json
          id?: number
          name?: string
          source?: string
          source_conversation_id?: string | null
          success_criteria?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_scenarios_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_scenarios_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      holidays_br: {
        Row: {
          date: string
          name: string
        }
        Insert: {
          date: string
          name: string
        }
        Update: {
          date?: string
          name?: string
        }
        Relationships: []
      }
      inboxes: {
        Row: {
          account_id: string
          allow_messages_after_resolved: boolean
          auto_assignment_config: Json
          channel_id: string
          channel_type: string | null
          created_at: string
          csat_config: Json
          csat_survey_enabled: boolean
          enable_auto_assignment: boolean
          enabled: boolean
          greeting_enabled: boolean
          greeting_message: string | null
          id: string
          name: string
          out_of_office_message: string | null
          portal_id: string | null
          timezone: string | null
          updated_at: string
          working_hours_enabled: boolean
        }
        Insert: {
          account_id: string
          allow_messages_after_resolved?: boolean
          auto_assignment_config?: Json
          channel_id: string
          channel_type?: string | null
          created_at?: string
          csat_config?: Json
          csat_survey_enabled?: boolean
          enable_auto_assignment?: boolean
          enabled?: boolean
          greeting_enabled?: boolean
          greeting_message?: string | null
          id?: string
          name: string
          out_of_office_message?: string | null
          portal_id?: string | null
          timezone?: string | null
          updated_at?: string
          working_hours_enabled?: boolean
        }
        Update: {
          account_id?: string
          allow_messages_after_resolved?: boolean
          auto_assignment_config?: Json
          channel_id?: string
          channel_type?: string | null
          created_at?: string
          csat_config?: Json
          csat_survey_enabled?: boolean
          enable_auto_assignment?: boolean
          enabled?: boolean
          greeting_enabled?: boolean
          greeting_message?: string | null
          id?: string
          name?: string
          out_of_office_message?: string | null
          portal_id?: string | null
          timezone?: string | null
          updated_at?: string
          working_hours_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "inboxes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inboxes_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_cluster_members: {
        Row: {
          cluster_id: number
          contact_id: string | null
          conversation_id: string
          created_at: string
          id: number
          match_score: number
        }
        Insert: {
          cluster_id: number
          contact_id?: string | null
          conversation_id: string
          created_at?: string
          id?: never
          match_score?: number
        }
        Update: {
          cluster_id?: number
          contact_id?: string | null
          conversation_id?: string
          created_at?: string
          id?: never
          match_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "incident_cluster_members_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "incident_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_cluster_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_cluster_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_clusters: {
        Row: {
          account_id: string
          acknowledged_at: string | null
          acknowledged_by_id: string | null
          contact_count: number
          conversation_count: number
          created_at: string
          embedding: string | null
          first_seen_at: string
          id: number
          last_seen_at: string
          member_count: number
          metadata: Json
          severity: string
          status: string
          summary: string
          tags: Json
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          acknowledged_at?: string | null
          acknowledged_by_id?: string | null
          contact_count?: number
          conversation_count?: number
          created_at?: string
          embedding?: string | null
          first_seen_at?: string
          id?: never
          last_seen_at?: string
          member_count?: number
          metadata?: Json
          severity?: string
          status?: string
          summary?: string
          tags?: Json
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          acknowledged_at?: string | null
          acknowledged_by_id?: string | null
          contact_count?: number
          conversation_count?: number
          created_at?: string
          embedding?: string | null
          first_seen_at?: string
          id?: never
          last_seen_at?: string
          member_count?: number
          metadata?: Json
          severity?: string
          status?: string
          summary?: string
          tags?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_clusters_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_queue: {
        Row: {
          account_id: string
          created_at: string
          debt_id: string
          external_ref: string
          id: number
          last_error: string | null
          payload: Json
          processed_at: string | null
          provider: string
          retry_count: number
          status: string
        }
        Insert: {
          account_id: string
          created_at?: string
          debt_id: string
          external_ref: string
          id?: number
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          provider: string
          retry_count?: number
          status?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          debt_id?: string
          external_ref?: string
          id?: number
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          provider?: string
          retry_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_queue_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
        ]
      }
      live_sessions: {
        Row: {
          account_id: string
          conversation_id: string
          current_speaker_id: string | null
          current_speaker_type: string
          ended_at: string | null
          id: number
          live_state: Json
          participants: Json
          pinned_persona_id: string | null
          rtc_channel: string | null
          started_at: string
          updated_at: string
        }
        Insert: {
          account_id: string
          conversation_id: string
          current_speaker_id?: string | null
          current_speaker_type?: string
          ended_at?: string | null
          id?: number
          live_state?: Json
          participants?: Json
          pinned_persona_id?: string | null
          rtc_channel?: string | null
          started_at?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          conversation_id?: string
          current_speaker_id?: string | null
          current_speaker_type?: string
          ended_at?: string | null
          id?: number
          live_state?: Json
          participants?: Json
          pinned_persona_id?: string | null
          rtc_channel?: string | null
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_sessions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_sessions_pinned_persona_id_fkey"
            columns: ["pinned_persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      live_takeovers: {
        Row: {
          at_message_id: string | null
          created_at: string
          from_id: string | null
          from_type: string
          id: number
          metadata: Json
          reason: string
          session_id: number
          to_id: string | null
          to_type: string
          visible_to_customer: boolean
        }
        Insert: {
          at_message_id?: string | null
          created_at?: string
          from_id?: string | null
          from_type: string
          id?: number
          metadata?: Json
          reason?: string
          session_id: number
          to_id?: string | null
          to_type: string
          visible_to_customer?: boolean
        }
        Update: {
          at_message_id?: string | null
          created_at?: string
          from_id?: string | null
          from_type?: string
          id?: number
          metadata?: Json
          reason?: string
          session_id?: number
          to_id?: string | null
          to_type?: string
          visible_to_customer?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "live_takeovers_at_message_id_fkey"
            columns: ["at_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_takeovers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_extraction_state: {
        Row: {
          account_id: string
          contact_id: string
          conversation_id: string
          created_at: string
          error_count: number
          last_error: string | null
          last_extracted_message_id: string | null
          last_run_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          contact_id: string
          conversation_id: string
          created_at?: string
          error_count?: number
          last_error?: string | null
          last_extracted_message_id?: string | null
          last_run_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          contact_id?: string
          conversation_id?: string
          created_at?: string
          error_count?: number
          last_error?: string | null
          last_extracted_message_id?: string | null
          last_run_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_extraction_state_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_extraction_state_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_extraction_state_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_dispatch_queue: {
        Row: {
          account_id: string
          attempts: number
          channel_type: Database["public"]["Enums"]["channel_type"]
          conversation_id: string
          created_at: string
          id: number
          last_error: string | null
          max_attempts: number
          message_id: string
          next_attempt_at: string
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          attempts?: number
          channel_type: Database["public"]["Enums"]["channel_type"]
          conversation_id: string
          created_at?: string
          id?: number
          last_error?: string | null
          max_attempts?: number
          message_id: string
          next_attempt_at?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          channel_type?: Database["public"]["Enums"]["channel_type"]
          conversation_id?: string
          created_at?: string
          id?: number
          last_error?: string | null
          max_attempts?: number
          message_id?: string
          next_attempt_at?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_dispatch_queue_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_dispatch_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_dispatch_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          account_id: string
          additional_attributes: Json
          content: string | null
          content_attributes: Json
          content_type: number
          conversation_id: string
          created_at: string
          external_source_ids: Json
          id: string
          inbox_id: string
          message_type: number
          private: boolean
          processed_message_content: string | null
          sender_id: string | null
          sender_type: string | null
          sentiment: Json | null
          source_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          additional_attributes?: Json
          content?: string | null
          content_attributes?: Json
          content_type?: number
          conversation_id: string
          created_at?: string
          external_source_ids?: Json
          id?: string
          inbox_id: string
          message_type?: number
          private?: boolean
          processed_message_content?: string | null
          sender_id?: string | null
          sender_type?: string | null
          sentiment?: Json | null
          source_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          additional_attributes?: Json
          content?: string | null
          content_attributes?: Json
          content_type?: number
          conversation_id?: string
          created_at?: string
          external_source_ids?: Json
          id?: string
          inbox_id?: string
          message_type?: number
          private?: boolean
          processed_message_content?: string | null
          sender_id?: string | null
          sender_type?: string | null
          sentiment?: Json | null
          source_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          account_id: string
          body: string | null
          created_at: string
          id: number
          kind: string
          link_to: string | null
          metadata: Json
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          account_id: string
          body?: string | null
          created_at?: string
          id?: number
          kind: string
          link_to?: string | null
          metadata?: Json
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          account_id?: string
          body?: string | null
          created_at?: string
          id?: number
          kind?: string
          link_to?: string | null
          metadata?: Json
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      org_onboarding_state: {
        Row: {
          account_id: string
          completed_at: string | null
          completed_steps: Json
          current_step: string
          dismissed_at: string | null
          health_check_at: string | null
          health_check_results: Json
          metadata: Json
          started_at: string
        }
        Insert: {
          account_id: string
          completed_at?: string | null
          completed_steps?: Json
          current_step?: string
          dismissed_at?: string | null
          health_check_at?: string | null
          health_check_results?: Json
          metadata?: Json
          started_at?: string
        }
        Update: {
          account_id?: string
          completed_at?: string | null
          completed_steps?: Json
          current_step?: string
          dismissed_at?: string | null
          health_check_at?: string | null
          health_check_results?: Json
          metadata?: Json
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_onboarding_state_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_attributions: {
        Row: {
          created_at: string
          id: number
          message_id: string | null
          outcome_id: number
          persona_id: string | null
          prompt_version_id: number | null
          reason: string | null
          weight: number
        }
        Insert: {
          created_at?: string
          id?: never
          message_id?: string | null
          outcome_id: number
          persona_id?: string | null
          prompt_version_id?: number | null
          reason?: string | null
          weight?: number
        }
        Update: {
          created_at?: string
          id?: never
          message_id?: string | null
          outcome_id?: number
          persona_id?: string | null
          prompt_version_id?: number | null
          reason?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "outcome_attributions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_attributions_outcome_id_fkey"
            columns: ["outcome_id"]
            isOneToOne: false
            referencedRelation: "conversation_outcomes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_attributions_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_attributions_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_arrangements: {
        Row: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          asaas_charge_id: string | null
          asaas_payment_url: string | null
          canceled_at: string | null
          contact_id: string
          conversation_id: string | null
          created_at: string
          debt_id: string
          id: string
          message_id: string | null
          metadata: Json
          metodo: string
          num_parcelas: number
          paid_at: string | null
          primeiro_vencimento: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          source: string
          status: Database["public"]["Enums"]["arrangement_status"]
          updated_at: string
          valor_negociado: number
          voice_call_id: string | null
        }
        Insert: {
          account_id: string
          approved_at?: string | null
          approved_by?: string | null
          asaas_charge_id?: string | null
          asaas_payment_url?: string | null
          canceled_at?: string | null
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          debt_id: string
          id?: string
          message_id?: string | null
          metadata?: Json
          metodo?: string
          num_parcelas?: number
          paid_at?: string | null
          primeiro_vencimento: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          source?: string
          status?: Database["public"]["Enums"]["arrangement_status"]
          updated_at?: string
          valor_negociado: number
          voice_call_id?: string | null
        }
        Update: {
          account_id?: string
          approved_at?: string | null
          approved_by?: string | null
          asaas_charge_id?: string | null
          asaas_payment_url?: string | null
          canceled_at?: string | null
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          debt_id?: string
          id?: string
          message_id?: string | null
          metadata?: Json
          metodo?: string
          num_parcelas?: number
          paid_at?: string | null
          primeiro_vencimento?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          source?: string
          status?: Database["public"]["Enums"]["arrangement_status"]
          updated_at?: string
          valor_negociado?: number
          voice_call_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_arrangements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_arrangements_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_arrangements_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_arrangements_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_arrangements_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_arrangements_voice_call_id_fkey"
            columns: ["voice_call_id"]
            isOneToOne: false
            referencedRelation: "voice_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_improvement_attempts: {
        Row: {
          account_id: string
          baseline_prompt_version_id: number | null
          candidate_prompt_version_id: number | null
          change_summary: string | null
          created_at: string
          eval_run_id: number | null
          id: number
          persona_id: string
          status: string
          why: string | null
        }
        Insert: {
          account_id: string
          baseline_prompt_version_id?: number | null
          candidate_prompt_version_id?: number | null
          change_summary?: string | null
          created_at?: string
          eval_run_id?: number | null
          id?: number
          persona_id: string
          status?: string
          why?: string | null
        }
        Update: {
          account_id?: string
          baseline_prompt_version_id?: number | null
          candidate_prompt_version_id?: number | null
          change_summary?: string | null
          created_at?: string
          eval_run_id?: number | null
          id?: number
          persona_id?: string
          status?: string
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "persona_improvement_attempts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_improvement_attempts_baseline_prompt_version_id_fkey"
            columns: ["baseline_prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_improvement_attempts_candidate_prompt_version_id_fkey"
            columns: ["candidate_prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_improvement_attempts_eval_run_id_fkey"
            columns: ["eval_run_id"]
            isOneToOne: false
            referencedRelation: "eval_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_improvement_attempts_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          account_id: string
          created_at: string
          e164: string
          elevenlabs_phone_number_id: string | null
          enabled: boolean
          friendly_name: string | null
          id: string
          inbound_behavior: Database["public"]["Enums"]["phone_inbound_behavior"]
          inbox_id: string | null
          outbound_enabled: boolean
          pinned_persona_id: string | null
          provider: string
          provider_config: Json
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          e164: string
          elevenlabs_phone_number_id?: string | null
          enabled?: boolean
          friendly_name?: string | null
          id?: string
          inbound_behavior?: Database["public"]["Enums"]["phone_inbound_behavior"]
          inbox_id?: string | null
          outbound_enabled?: boolean
          pinned_persona_id?: string | null
          provider?: string
          provider_config?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          e164?: string
          elevenlabs_phone_number_id?: string | null
          enabled?: boolean
          friendly_name?: string | null
          id?: string
          inbound_behavior?: Database["public"]["Enums"]["phone_inbound_behavior"]
          inbox_id?: string | null
          outbound_enabled?: boolean
          pinned_persona_id?: string | null
          provider?: string
          provider_config?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_numbers_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_numbers_pinned_persona_id_fkey"
            columns: ["pinned_persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          availability: Database["public"]["Enums"]["user_availability"]
          confirmed_at: string | null
          created_at: string
          custom_attributes: Json
          display_name: string | null
          email: string
          id: string
          is_super_admin: boolean
          name: string | null
          super_admin_onboarding_completed: boolean
          ui_settings: Json
          updated_at: string
        }
        Insert: {
          availability?: Database["public"]["Enums"]["user_availability"]
          confirmed_at?: string | null
          created_at?: string
          custom_attributes?: Json
          display_name?: string | null
          email: string
          id: string
          is_super_admin?: boolean
          name?: string | null
          super_admin_onboarding_completed?: boolean
          ui_settings?: Json
          updated_at?: string
        }
        Update: {
          availability?: Database["public"]["Enums"]["user_availability"]
          confirmed_at?: string | null
          created_at?: string
          custom_attributes?: Json
          display_name?: string | null
          email?: string
          id?: string
          is_super_admin?: boolean
          name?: string | null
          super_admin_onboarding_completed?: boolean
          ui_settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      prompt_deployments: {
        Row: {
          account_id: string
          created_at: string
          ended_at: string | null
          id: number
          inbox_id: string | null
          persona_id: string | null
          prompt_version_id: number
          started_at: string
          traffic_share: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          ended_at?: string | null
          id?: never
          inbox_id?: string | null
          persona_id?: string | null
          prompt_version_id: number
          started_at?: string
          traffic_share?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          ended_at?: string | null
          id?: never
          inbox_id?: string | null
          persona_id?: string | null
          prompt_version_id?: number
          started_at?: string
          traffic_share?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_deployments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_deployments_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_deployments_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_deployments_prompt_version_id_fkey"
            columns: ["prompt_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_templates: {
        Row: {
          account_id: string
          body: string
          created_at: string
          enabled: boolean
          id: string
          key: string
          name: string
          updated_at: string
          variables: Json
        }
        Insert: {
          account_id: string
          body: string
          created_at?: string
          enabled?: boolean
          id?: string
          key: string
          name: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          account_id?: string
          body?: string
          created_at?: string
          enabled?: boolean
          id?: string
          key?: string
          name?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "prompt_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_versions: {
        Row: {
          account_id: string
          author: string
          change_note: string | null
          content: string
          created_at: string
          created_by_id: string | null
          eval_score: number | null
          id: number
          parent_version_id: number | null
          slug: string
          status: string
          updated_at: string
          variables: Json
          version: number
        }
        Insert: {
          account_id: string
          author?: string
          change_note?: string | null
          content: string
          created_at?: string
          created_by_id?: string | null
          eval_score?: number | null
          id?: never
          parent_version_id?: number | null
          slug: string
          status?: string
          updated_at?: string
          variables?: Json
          version: number
        }
        Update: {
          account_id?: string
          author?: string
          change_note?: string | null
          content?: string
          created_at?: string
          created_by_id?: string | null
          eval_score?: number | null
          id?: never
          parent_version_id?: number | null
          slug?: string
          status?: string
          updated_at?: string
          variables?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_parent_version_id_fkey"
            columns: ["parent_version_id"]
            isOneToOne: false
            referencedRelation: "prompt_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_deliveries: {
        Row: {
          account_id: string
          arrangement_id: string
          channel: Database["public"]["Enums"]["delivery_channel"]
          created_at: string
          delivered_at: string | null
          error_message: string | null
          failed_at: string | null
          id: string
          metadata: Json
          provider_msg_id: string | null
          read_at: string | null
          recipient: string
          sent_at: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          updated_at: string
        }
        Insert: {
          account_id: string
          arrangement_id: string
          channel: Database["public"]["Enums"]["delivery_channel"]
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          metadata?: Json
          provider_msg_id?: string | null
          read_at?: string | null
          recipient: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Update: {
          account_id?: string
          arrangement_id?: string
          channel?: Database["public"]["Enums"]["delivery_channel"]
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: string
          metadata?: Json
          provider_msg_id?: string | null
          read_at?: string | null
          recipient?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_deliveries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposal_deliveries_arrangement_id_fkey"
            columns: ["arrangement_id"]
            isOneToOne: false
            referencedRelation: "payment_arrangements"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_meetings: {
        Row: {
          account_id: string
          attended_at: string | null
          cancellation_reason: string | null
          contact_id: string | null
          created_at: string
          detected_no_show_at: string | null
          ends_at: string | null
          event_type_uri: string | null
          id: string
          invitee_email: string | null
          invitee_name: string | null
          invitee_phone: string | null
          meeting_url: string | null
          payload: Json
          provider: string
          provider_event_id: string
          starts_at: string
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          attended_at?: string | null
          cancellation_reason?: string | null
          contact_id?: string | null
          created_at?: string
          detected_no_show_at?: string | null
          ends_at?: string | null
          event_type_uri?: string | null
          id?: string
          invitee_email?: string | null
          invitee_name?: string | null
          invitee_phone?: string | null
          meeting_url?: string | null
          payload?: Json
          provider: string
          provider_event_id: string
          starts_at: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          attended_at?: string | null
          cancellation_reason?: string | null
          contact_id?: string | null
          created_at?: string
          detected_no_show_at?: string | null
          ends_at?: string | null
          event_type_uri?: string | null
          id?: string
          invitee_email?: string | null
          invitee_name?: string | null
          invitee_phone?: string | null
          meeting_url?: string | null
          payload?: Json
          provider?: string
          provider_event_id?: string
          starts_at?: string
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_meetings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_meetings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_opt_outs: {
        Row: {
          account_id: string
          id: number
          opted_back_in_at: string | null
          opted_out_at: string
          phone_number: string
          reason: string | null
        }
        Insert: {
          account_id: string
          id?: never
          opted_back_in_at?: string | null
          opted_out_at?: string
          phone_number: string
          reason?: string | null
        }
        Update: {
          account_id?: string
          id?: never
          opted_back_in_at?: string | null
          opted_out_at?: string
          phone_number?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_opt_outs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      twilio_number_provisioning: {
        Row: {
          account_id: string
          action: string
          created_at: string
          e164: string
          http_status: number | null
          id: number
          phone_number_id: string | null
          request: Json
          response: Json
          triggered_by_id: string | null
        }
        Insert: {
          account_id: string
          action: string
          created_at?: string
          e164: string
          http_status?: number | null
          id?: never
          phone_number_id?: string | null
          request?: Json
          response?: Json
          triggered_by_id?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          created_at?: string
          e164?: string
          http_status?: number | null
          id?: never
          phone_number_id?: string | null
          request?: Json
          response?: Json
          triggered_by_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "twilio_number_provisioning_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "twilio_number_provisioning_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          account_id: string
          created_at: string
          id: number
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: number
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: number
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_calls: {
        Row: {
          account_id: string
          collection_outcome:
            | Database["public"]["Enums"]["collection_outcome"]
            | null
          consent_recorded_at: string | null
          conversation_id: string | null
          created_at: string
          debt_id: string | null
          direction: Database["public"]["Enums"]["voice_call_direction"]
          duration_seconds: number
          ended_at: string | null
          from_number: string
          handled_by_user_id: string | null
          id: string
          metadata: Json
          next_retry_at: string | null
          outcome_category: string | null
          outcome_classified_at: string | null
          outcome_confidence: number | null
          outcome_summary: string | null
          persona_id: string | null
          phone_number_id: string | null
          provider: string
          provider_call_sid: string | null
          recording_duration_sec: number | null
          recording_sid: string | null
          recording_storage_path: string | null
          recording_url: string | null
          retry_count: number
          source_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["voice_call_status"]
          to_number: string
          total_cost_cents: number
          transcript: Json
          transcription_completed_at: string | null
          transcription_error: string | null
          transcription_provider: string | null
          transcription_status: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          collection_outcome?:
            | Database["public"]["Enums"]["collection_outcome"]
            | null
          consent_recorded_at?: string | null
          conversation_id?: string | null
          created_at?: string
          debt_id?: string | null
          direction: Database["public"]["Enums"]["voice_call_direction"]
          duration_seconds?: number
          ended_at?: string | null
          from_number: string
          handled_by_user_id?: string | null
          id?: string
          metadata?: Json
          next_retry_at?: string | null
          outcome_category?: string | null
          outcome_classified_at?: string | null
          outcome_confidence?: number | null
          outcome_summary?: string | null
          persona_id?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_call_sid?: string | null
          recording_duration_sec?: number | null
          recording_sid?: string | null
          recording_storage_path?: string | null
          recording_url?: string | null
          retry_count?: number
          source_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["voice_call_status"]
          to_number: string
          total_cost_cents?: number
          transcript?: Json
          transcription_completed_at?: string | null
          transcription_error?: string | null
          transcription_provider?: string | null
          transcription_status?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          collection_outcome?:
            | Database["public"]["Enums"]["collection_outcome"]
            | null
          consent_recorded_at?: string | null
          conversation_id?: string | null
          created_at?: string
          debt_id?: string | null
          direction?: Database["public"]["Enums"]["voice_call_direction"]
          duration_seconds?: number
          ended_at?: string | null
          from_number?: string
          handled_by_user_id?: string | null
          id?: string
          metadata?: Json
          next_retry_at?: string | null
          outcome_category?: string | null
          outcome_classified_at?: string | null
          outcome_confidence?: number | null
          outcome_summary?: string | null
          persona_id?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_call_sid?: string | null
          recording_duration_sec?: number | null
          recording_sid?: string | null
          recording_storage_path?: string | null
          recording_url?: string | null
          retry_count?: number
          source_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["voice_call_status"]
          to_number?: string
          total_cost_cents?: number
          transcript?: Json
          transcription_completed_at?: string | null
          transcription_error?: string | null
          transcription_provider?: string | null
          transcription_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_calls_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_calls_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_calls_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_calls_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_calls_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_campaign_contacts: {
        Row: {
          account_id: string
          attempts: number
          campaign_id: string
          contact_id: string | null
          created_at: string
          dispatch_after: string
          dispatched_at: string | null
          error_message: string | null
          finished_at: string | null
          id: number
          last_attempt_at: string | null
          last_error: string | null
          metadata: Json
          next_retry_at: string | null
          phone_number: string | null
          provider_call_sid: string | null
          status: string
          to_number: string
          updated_at: string
          variables: Json
          voice_call_id: string | null
        }
        Insert: {
          account_id: string
          attempts?: number
          campaign_id: string
          contact_id?: string | null
          created_at?: string
          dispatch_after?: string
          dispatched_at?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: number
          last_attempt_at?: string | null
          last_error?: string | null
          metadata?: Json
          next_retry_at?: string | null
          phone_number?: string | null
          provider_call_sid?: string | null
          status?: string
          to_number: string
          updated_at?: string
          variables?: Json
          voice_call_id?: string | null
        }
        Update: {
          account_id?: string
          attempts?: number
          campaign_id?: string
          contact_id?: string | null
          created_at?: string
          dispatch_after?: string
          dispatched_at?: string | null
          error_message?: string | null
          finished_at?: string | null
          id?: number
          last_attempt_at?: string | null
          last_error?: string | null
          metadata?: Json
          next_retry_at?: string | null
          phone_number?: string | null
          provider_call_sid?: string | null
          status?: string
          to_number?: string
          updated_at?: string
          variables?: Json
          voice_call_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_campaign_contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_campaign_contacts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "voice_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_campaign_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_campaign_contacts_voice_call_id_fkey"
            columns: ["voice_call_id"]
            isOneToOne: false
            referencedRelation: "voice_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_campaigns: {
        Row: {
          account_id: string
          allowed_hours_local: Json | null
          campaign_kind: string
          canceled_after_placed: number | null
          canceled_at: string | null
          collection_config: Json
          connected_count: number
          contact_count: number
          created_at: string
          created_by_id: string | null
          description: string | null
          disclaimer_enabled: boolean | null
          escalated_count: number
          escalation_keywords: Json
          escalation_rules: Json
          escalation_target_number: string | null
          failed_count: number
          finished_at: string | null
          from_number: string
          id: string
          language_code: string
          max_attempts_per_day: number | null
          max_call_duration_sec: number
          max_calls_per_day: number | null
          max_calls_per_month: number | null
          max_calls_per_week: number | null
          max_concurrent: number
          max_messages_per_day: number | null
          max_messages_per_month: number | null
          max_messages_per_week: number | null
          metadata: Json
          min_minutes_between_attempts: number | null
          mode: string
          name: string
          opening_script: string | null
          persona_id: string | null
          phone_number_id: string | null
          placed_count: number
          record_call: boolean
          retry_attempts: number
          retry_delay_minutes: number
          scheduled_at: string | null
          scheduled_for: string | null
          script_mode: string
          started_at: string | null
          status: string
          system_prompt: string | null
          test_mode: boolean
          total_contacts: number
          triggered_by_id: string | null
          updated_at: string
          voice_id: string | null
          voicemail_count: number
          voicemail_detection: boolean
        }
        Insert: {
          account_id: string
          allowed_hours_local?: Json | null
          campaign_kind?: string
          canceled_after_placed?: number | null
          canceled_at?: string | null
          collection_config?: Json
          connected_count?: number
          contact_count?: number
          created_at?: string
          created_by_id?: string | null
          description?: string | null
          disclaimer_enabled?: boolean | null
          escalated_count?: number
          escalation_keywords?: Json
          escalation_rules?: Json
          escalation_target_number?: string | null
          failed_count?: number
          finished_at?: string | null
          from_number: string
          id?: string
          language_code?: string
          max_attempts_per_day?: number | null
          max_call_duration_sec?: number
          max_calls_per_day?: number | null
          max_calls_per_month?: number | null
          max_calls_per_week?: number | null
          max_concurrent?: number
          max_messages_per_day?: number | null
          max_messages_per_month?: number | null
          max_messages_per_week?: number | null
          metadata?: Json
          min_minutes_between_attempts?: number | null
          mode?: string
          name: string
          opening_script?: string | null
          persona_id?: string | null
          phone_number_id?: string | null
          placed_count?: number
          record_call?: boolean
          retry_attempts?: number
          retry_delay_minutes?: number
          scheduled_at?: string | null
          scheduled_for?: string | null
          script_mode?: string
          started_at?: string | null
          status?: string
          system_prompt?: string | null
          test_mode?: boolean
          total_contacts?: number
          triggered_by_id?: string | null
          updated_at?: string
          voice_id?: string | null
          voicemail_count?: number
          voicemail_detection?: boolean
        }
        Update: {
          account_id?: string
          allowed_hours_local?: Json | null
          campaign_kind?: string
          canceled_after_placed?: number | null
          canceled_at?: string | null
          collection_config?: Json
          connected_count?: number
          contact_count?: number
          created_at?: string
          created_by_id?: string | null
          description?: string | null
          disclaimer_enabled?: boolean | null
          escalated_count?: number
          escalation_keywords?: Json
          escalation_rules?: Json
          escalation_target_number?: string | null
          failed_count?: number
          finished_at?: string | null
          from_number?: string
          id?: string
          language_code?: string
          max_attempts_per_day?: number | null
          max_call_duration_sec?: number
          max_calls_per_day?: number | null
          max_calls_per_month?: number | null
          max_calls_per_week?: number | null
          max_concurrent?: number
          max_messages_per_day?: number | null
          max_messages_per_month?: number | null
          max_messages_per_week?: number | null
          metadata?: Json
          min_minutes_between_attempts?: number | null
          mode?: string
          name?: string
          opening_script?: string | null
          persona_id?: string | null
          phone_number_id?: string | null
          placed_count?: number
          record_call?: boolean
          retry_attempts?: number
          retry_delay_minutes?: number
          scheduled_at?: string | null
          scheduled_for?: string | null
          script_mode?: string
          started_at?: string | null
          status?: string
          system_prompt?: string | null
          test_mode?: boolean
          total_contacts?: number
          triggered_by_id?: string | null
          updated_at?: string
          voice_id?: string | null
          voicemail_count?: number
          voicemail_detection?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "voice_campaigns_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_campaigns_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_campaigns_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          account_id: string
          created_at: string
          direction: string
          duration_ms: number | null
          endpoint: string
          error: string | null
          http_status: number | null
          id: number
          metadata: Json
          payload_preview: string | null
          signature_valid: boolean | null
          source_ip: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          direction?: string
          duration_ms?: number | null
          endpoint: string
          error?: string | null
          http_status?: number | null
          id?: number
          metadata?: Json
          payload_preview?: string | null
          signature_valid?: boolean | null
          source_ip?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          direction?: string
          duration_ms?: number | null
          endpoint?: string
          error?: string | null
          http_status?: number | null
          id?: number
          metadata?: Json
          payload_preview?: string | null
          signature_valid?: boolean | null
          source_ip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_campaign_recipients: {
        Row: {
          account_id: string
          attempts: number
          campaign_id: string
          contact_id: string
          conversation_id: string | null
          created_at: string
          debt_data: Json
          debt_ids: string[]
          dispatch_after: string
          generated_message: string | null
          id: number
          last_attempt_at: string | null
          last_error: string | null
          message_id: string | null
          phone_number: string
          provider_message_id: string | null
          replied_at: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          attempts?: number
          campaign_id: string
          contact_id: string
          conversation_id?: string | null
          created_at?: string
          debt_data?: Json
          debt_ids?: string[]
          dispatch_after?: string
          generated_message?: string | null
          id?: number
          last_attempt_at?: string | null
          last_error?: string | null
          message_id?: string | null
          phone_number: string
          provider_message_id?: string | null
          replied_at?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          campaign_id?: string
          contact_id?: string
          conversation_id?: string | null
          created_at?: string
          debt_data?: Json
          debt_ids?: string[]
          dispatch_after?: string
          generated_message?: string | null
          id?: number
          last_attempt_at?: string | null
          last_error?: string | null
          message_id?: string | null
          phone_number?: string
          provider_message_id?: string | null
          replied_at?: string | null
          sent_at?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaign_recipients_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_campaigns: {
        Row: {
          account_id: string
          audience_mode: string
          contact_count: number
          created_at: string
          created_by_id: string | null
          daily_limit: number
          failed_count: number
          finished_at: string | null
          id: string
          inbox_id: string
          last_error: string | null
          name: string
          persona_id: string
          replied_count: number
          scheduled_for: string | null
          sent_count: number
          skipped_count: number
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          audience_mode?: string
          contact_count?: number
          created_at?: string
          created_by_id?: string | null
          daily_limit?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          inbox_id: string
          last_error?: string | null
          name: string
          persona_id: string
          replied_count?: number
          scheduled_for?: string | null
          sent_count?: number
          skipped_count?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          audience_mode?: string
          contact_count?: number
          created_at?: string
          created_by_id?: string | null
          daily_limit?: number
          failed_count?: number
          finished_at?: string | null
          id?: string
          inbox_id?: string
          last_error?: string | null
          name?: string
          persona_id?: string
          replied_count?: number
          scheduled_for?: string | null
          sent_count?: number
          skipped_count?: number
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaigns_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaigns_inbox_id_fkey"
            columns: ["inbox_id"]
            isOneToOne: false
            referencedRelation: "inboxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaigns_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "agent_personas"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_events: {
        Row: {
          account_id: string
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          event_type: string
          id: number
          matched_workflow_count: number
          payload: Json
          processed_at: string | null
          source: string
        }
        Insert: {
          account_id: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          event_type: string
          id?: number
          matched_workflow_count?: number
          payload?: Json
          processed_at?: string | null
          source: string
        }
        Update: {
          account_id?: string
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          event_type?: string
          id?: number
          matched_workflow_count?: number
          payload?: Json
          processed_at?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_events_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          account_id: string
          action_results: Json
          context: Json
          created_at: string
          duration_ms: number | null
          error_action_index: number | null
          error_message: string | null
          event_id: number | null
          finished_at: string | null
          id: number
          input_payload: Json
          scheduled_at: string
          started_at: string | null
          status: string
          trigger_type: string
          workflow_id: string
        }
        Insert: {
          account_id: string
          action_results?: Json
          context?: Json
          created_at?: string
          duration_ms?: number | null
          error_action_index?: number | null
          error_message?: string | null
          event_id?: number | null
          finished_at?: string | null
          id?: number
          input_payload?: Json
          scheduled_at?: string
          started_at?: string | null
          status?: string
          trigger_type: string
          workflow_id: string
        }
        Update: {
          account_id?: string
          action_results?: Json
          context?: Json
          created_at?: string
          duration_ms?: number | null
          error_action_index?: number | null
          error_message?: string | null
          event_id?: number | null
          finished_at?: string | null
          id?: number
          input_payload?: Json
          scheduled_at?: string
          started_at?: string | null
          status?: string
          trigger_type?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_runs_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          account_id: string
          actions: Json
          conditions: Json
          created_at: string
          created_by_id: string | null
          description: string | null
          enabled: boolean
          failure_count: number
          id: string
          last_run_at: string | null
          name: string
          success_count: number
          trigger_config: Json
          trigger_type: string
          updated_at: string
          version: number
        }
        Insert: {
          account_id: string
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by_id?: string | null
          description?: string | null
          enabled?: boolean
          failure_count?: number
          id?: string
          last_run_at?: string | null
          name: string
          success_count?: number
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
          version?: number
        }
        Update: {
          account_id?: string
          actions?: Json
          conditions?: Json
          created_at?: string
          created_by_id?: string | null
          description?: string | null
          enabled?: boolean
          failure_count?: number
          id?: string
          last_run_at?: string | null
          name?: string
          success_count?: number
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "workflows_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_arrangement: {
        Args: { p_arrangement_id: string }
        Returns: boolean
      }
      bump_debt_attempts: { Args: { p_debt_id: string }; Returns: undefined }
      bump_voice_campaign_totals: {
        Args: {
          p_campaign_id: string
          p_connected?: number
          p_escalated?: number
          p_failed?: number
          p_placed?: number
          p_voicemail?: number
        }
        Returns: undefined
      }
      bump_workflow_counters: {
        Args: { p_failure?: number; p_success?: number; p_workflow_id: string }
        Returns: undefined
      }
      claim_whatsapp_campaign_recipients: {
        Args: { p_limit?: number }
        Returns: {
          account_id: string
          attempts: number
          campaign_id: string
          contact_id: string
          conversation_id: string | null
          created_at: string
          debt_data: Json
          debt_ids: string[]
          dispatch_after: string
          generated_message: string | null
          id: number
          last_attempt_at: string | null
          last_error: string | null
          message_id: string | null
          phone_number: string
          provider_message_id: string | null
          replied_at: string | null
          sent_at: string | null
          skip_reason: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "whatsapp_campaign_recipients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_super_admin_onboarding: { Args: never; Returns: boolean }
      configure_whatsapp_campaign_dispatch: {
        Args: { p_auth_token: string }
        Returns: undefined
      }
      delete_account_secret: {
        Args: { p_account_id: string; p_key_name: string; p_provider: string }
        Returns: boolean
      }
      delete_voice_campaign: { Args: { p_campaign_id: string }; Returns: Json }
      ensure_workspace: { Args: never; Returns: string }
      get_account_secret: {
        Args: { p_account_id: string; p_key_name: string; p_provider: string }
        Returns: string
      }
      get_account_secrets_bulk: {
        Args: { p_account_id: string; p_provider: string }
        Returns: Json
      }
      get_or_create_open_conversation: {
        Args: { p_account_id: string; p_contact_id: string; p_inbox_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _account_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      incident_find_similar: {
        Args: {
          p_account_id: string
          p_embedding: string
          p_lookback_hours?: number
          p_threshold?: number
        }
        Returns: {
          id: number
          last_seen_at: string
          member_count: number
          similarity: number
          status: string
          title: string
        }[]
      }
      invite_preview: {
        Args: { p_token: string }
        Returns: {
          account_name: string
          email_hint: string
          expires_at: string
          role: string
        }[]
      }
      is_account_member: {
        Args: { _account_id: string; _user_id: string }
        Returns: boolean
      }
      is_phone_allowed_to_call: {
        Args: {
          p_account_id: string
          p_allowed_hours_local?: Json
          p_max_attempts_per_day?: number
          p_min_minutes_between_attempts?: number
          p_phone_number: string
          p_timezone?: string
        }
        Returns: Json
      }
      is_phone_in_dnc: {
        Args: { p_account_id: string; p_phone_e164: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_within_collection_window: {
        Args: { p_account_id: string; p_at?: string }
        Returns: boolean
      }
      lgpd_delete_contact: {
        Args: { p_contact_id: string }
        Returns: undefined
      }
      list_account_secrets: {
        Args: { p_account_id: string }
        Returns: {
          created_at: string
          key_name: string
          metadata: Json
          provider: string
          updated_at: string
        }[]
      }
      mark_arrangement_paid: {
        Args: {
          p_arrangement_id: string
          p_note?: string
          p_payment_method?: string
        }
        Returns: Json
      }
      memory_recall_topk: {
        Args: {
          p_contact_id: string
          p_limit?: number
          p_min_importance?: number
          p_query_embedding: string
        }
        Returns: {
          account_id: string
          confidence: number
          contact_id: string
          content: string
          created_at: string
          expires_at: string
          id: number
          importance: number
          kind: string
          metadata: Json
          similarity: number
          source_conversation_id: string
          summary: string
        }[]
      }
      messenger_channel_config: {
        Args: { _page_id: string }
        Returns: {
          account_id: string
          channel_id: string
          config: Json
        }[]
      }
      nexus_cron_status: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          last_run_at: string
          last_run_message: string
          last_run_status: string
          schedule: string
        }[]
      }
      onboarding_dismiss: { Args: { p_account_id: string }; Returns: undefined }
      onboarding_reopen: { Args: { p_account_id: string }; Returns: undefined }
      refresh_whatsapp_campaign_totals: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      reject_arrangement: {
        Args: { p_arrangement_id: string; p_reason: string }
        Returns: boolean
      }
      save_app_settings: {
        Args: {
          p_metadata?: Json
          p_supabase_publishable_key: string
          p_supabase_url: string
        }
        Returns: boolean
      }
      schedule_edge_cron: {
        Args: {
          p_body?: Json
          p_function: string
          p_name: string
          p_schedule: string
        }
        Returns: undefined
      }
      set_account_secret: {
        Args: {
          p_account_id: string
          p_key_name: string
          p_metadata?: Json
          p_provider: string
          p_value: string
        }
        Returns: string
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      team_change_role: {
        Args: {
          p_account_id: string
          p_new_role: Database["public"]["Enums"]["app_role"]
          p_target_user_id: string
        }
        Returns: undefined
      }
      team_list_members: {
        Args: { p_account_id: string }
        Returns: {
          email: string
          joined_at: string
          name: string
          role: string
          user_id: string
        }[]
      }
      team_remove_member: {
        Args: { p_account_id: string; p_target_user_id: string }
        Returns: undefined
      }
      voice_campaign_quota_check: {
        Args: { p_campaign_id: string; p_kind?: string }
        Returns: Json
      }
    }
    Enums: {
      account_status: "active" | "suspended" | "archived"
      app_role: "admin" | "agent"
      arrangement_status:
        | "pendente_aprovacao"
        | "pendente"
        | "pago"
        | "atrasado"
        | "cancelado"
      channel_type:
        | "web_widget"
        | "email"
        | "whatsapp"
        | "instagram"
        | "voice"
        | "messenger"
        | "sms"
        | "telegram"
      collection_outcome:
        | "cpc"
        | "cpct"
        | "nao_atende"
        | "caixa_postal"
        | "numero_errado"
        | "recusa"
        | "dnc_solicitado"
        | "acordo"
        | "pago"
        | "sem_resultado"
      debt_status:
        | "aberto"
        | "em_negociacao"
        | "acordado"
        | "pago"
        | "baixado"
        | "cancelado"
      delivery_channel: "whatsapp" | "email" | "sms"
      delivery_status: "pendente" | "enviado" | "entregue" | "lido" | "falhou"
      doc_type: "cpf" | "cnpj"
      persona_status: "draft" | "active" | "archived" | "training" | "retired"
      phone_inbound_behavior:
        | "ai_answer"
        | "suggest"
        | "forward_to_agent"
        | "voicemail"
      user_availability: "online" | "offline" | "busy"
      voice_call_direction: "inbound" | "outbound"
      voice_call_status:
        | "queued"
        | "ringing"
        | "in_progress"
        | "completed"
        | "busy"
        | "failed"
        | "no_answer"
        | "canceled"
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
    Enums: {
      account_status: ["active", "suspended", "archived"],
      app_role: ["admin", "agent"],
      arrangement_status: [
        "pendente_aprovacao",
        "pendente",
        "pago",
        "atrasado",
        "cancelado",
      ],
      channel_type: [
        "web_widget",
        "email",
        "whatsapp",
        "instagram",
        "voice",
        "messenger",
        "sms",
        "telegram",
      ],
      collection_outcome: [
        "cpc",
        "cpct",
        "nao_atende",
        "caixa_postal",
        "numero_errado",
        "recusa",
        "dnc_solicitado",
        "acordo",
        "pago",
        "sem_resultado",
      ],
      debt_status: [
        "aberto",
        "em_negociacao",
        "acordado",
        "pago",
        "baixado",
        "cancelado",
      ],
      delivery_channel: ["whatsapp", "email", "sms"],
      delivery_status: ["pendente", "enviado", "entregue", "lido", "falhou"],
      doc_type: ["cpf", "cnpj"],
      persona_status: ["draft", "active", "archived", "training", "retired"],
      phone_inbound_behavior: [
        "ai_answer",
        "suggest",
        "forward_to_agent",
        "voicemail",
      ],
      user_availability: ["online", "offline", "busy"],
      voice_call_direction: ["inbound", "outbound"],
      voice_call_status: [
        "queued",
        "ringing",
        "in_progress",
        "completed",
        "busy",
        "failed",
        "no_answer",
        "canceled",
      ],
    },
  },
} as const
