// Generated from the CRM project (supabase-crm/, schema public). Do not edit by hand.
// Regenerate: supabase.cmd gen types typescript --local --workdir supabase-crm --schema public
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      _prisma_migrations: {
        Row: {
          applied_steps_count: number
          checksum: string
          finished_at: string | null
          id: string
          logs: string | null
          migration_name: string
          rolled_back_at: string | null
          started_at: string
        }
        Insert: {
          applied_steps_count?: number
          checksum: string
          finished_at?: string | null
          id: string
          logs?: string | null
          migration_name: string
          rolled_back_at?: string | null
          started_at?: string
        }
        Update: {
          applied_steps_count?: number
          checksum?: string
          finished_at?: string | null
          id?: string
          logs?: string | null
          migration_name?: string
          rolled_back_at?: string | null
          started_at?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          id: string
          jewelos_branch_id: string | null
          name: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          jewelos_branch_id?: string | null
          name: string
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          jewelos_branch_id?: string | null
          name?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_campaign_tags: {
        Row: {
          campaign_id: string
          client_id: string
          id: string
          note: string | null
          tagged_at: string
          tagged_by: string | null
        }
        Insert: {
          campaign_id: string
          client_id: string
          id?: string
          note?: string | null
          tagged_at?: string
          tagged_by?: string | null
        }
        Update: {
          campaign_id?: string
          client_id?: string
          id?: string
          note?: string | null
          tagged_at?: string
          tagged_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_campaign_tags_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_campaign_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_campaign_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_campaign_tags_tagged_by_fkey"
            columns: ["tagged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_edit_log: {
        Row: {
          client_id: string
          created_at: string
          edited_by: string | null
          field_name: string
          id: number
          new_value: Json | null
          old_value: Json | null
          source: string
        }
        Insert: {
          client_id: string
          created_at?: string
          edited_by?: string | null
          field_name: string
          id?: number
          new_value?: Json | null
          old_value?: Json | null
          source?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          edited_by?: string | null
          field_name?: string
          id?: number
          new_value?: Json | null
          old_value?: Json | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_edit_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_edit_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_edit_log_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_phone_index: {
        Row: {
          client_id: string
          phone: string
        }
        Insert: {
          client_id: string
          phone: string
        }
        Update: {
          client_id?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_phone_index_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_phone_index_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      client_timeline: {
        Row: {
          bought_categories: string[] | null
          branch_id: string
          buy_status: Database["public"]["Enums"]["buy_status"] | null
          client_id: string
          created_at: string
          crm_name: string | null
          event_date: string
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          order_categories: string[] | null
          product_requirement: string | null
          reference_number: string | null
          remark: string | null
          salesperson_id: string | null
          seen_categories: string[] | null
        }
        Insert: {
          bought_categories?: string[] | null
          branch_id: string
          buy_status?: Database["public"]["Enums"]["buy_status"] | null
          client_id: string
          created_at?: string
          crm_name?: string | null
          event_date: string
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          order_categories?: string[] | null
          product_requirement?: string | null
          reference_number?: string | null
          remark?: string | null
          salesperson_id?: string | null
          seen_categories?: string[] | null
        }
        Update: {
          bought_categories?: string[] | null
          branch_id?: string
          buy_status?: Database["public"]["Enums"]["buy_status"] | null
          client_id?: string
          created_at?: string
          crm_name?: string | null
          event_date?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          order_categories?: string[] | null
          product_requirement?: string | null
          reference_number?: string | null
          remark?: string | null
          salesperson_id?: string | null
          seen_categories?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "client_timeline_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_timeline_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_timeline_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_timeline_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          anniversary: string | null
          beverage: string | null
          billing_phone: string | null
          city: string | null
          city_other: string | null
          client_code: string
          client_id: string
          client_potential_category: string | null
          community: string | null
          community_other: string | null
          country: string | null
          dob: string | null
          first_visit_date: string | null
          gender: string | null
          gift_history: Json | null
          google_review_status: string | null
          high_potential_reason: string | null
          household_id: string | null
          instagram_status: string | null
          last_bought_categories: string[] | null
          last_branch_id: string | null
          last_buy_status: Database["public"]["Enums"]["buy_status"] | null
          last_crm_name: string | null
          last_order_categories: string[] | null
          last_product_requirement: string | null
          last_remark: string | null
          last_salesperson_id: string | null
          last_seen_categories: string[] | null
          last_visit_date: string | null
          lifecycle_stage: string
          next_visit_date: string | null
          other_known_phones: string[] | null
          other_names: string[] | null
          pincode: string | null
          primary_name: string
          primary_phone: string | null
          profile_updated_at: string
          profile_updated_by: string | null
          referral_code: string
          referral_relation: string | null
          referral_status: string | null
          referred_by_client_id: string | null
          secondary_phone: string | null
          snack: string | null
          state: string | null
          sugar: string | null
          testimonial_status: string | null
          total_non_purchase_visits: number
          total_order_visits: number
          total_purchase_visits: number
          total_repair_visits: number
          total_visits: number
        }
        Insert: {
          address?: string | null
          anniversary?: string | null
          beverage?: string | null
          billing_phone?: string | null
          city?: string | null
          city_other?: string | null
          client_code: string
          client_id?: string
          client_potential_category?: string | null
          community?: string | null
          community_other?: string | null
          country?: string | null
          dob?: string | null
          first_visit_date?: string | null
          gender?: string | null
          gift_history?: Json | null
          google_review_status?: string | null
          high_potential_reason?: string | null
          household_id?: string | null
          instagram_status?: string | null
          last_bought_categories?: string[] | null
          last_branch_id?: string | null
          last_buy_status?: Database["public"]["Enums"]["buy_status"] | null
          last_crm_name?: string | null
          last_order_categories?: string[] | null
          last_product_requirement?: string | null
          last_remark?: string | null
          last_salesperson_id?: string | null
          last_seen_categories?: string[] | null
          last_visit_date?: string | null
          lifecycle_stage?: string
          next_visit_date?: string | null
          other_known_phones?: string[] | null
          other_names?: string[] | null
          pincode?: string | null
          primary_name: string
          primary_phone?: string | null
          profile_updated_at?: string
          profile_updated_by?: string | null
          referral_code: string
          referral_relation?: string | null
          referral_status?: string | null
          referred_by_client_id?: string | null
          secondary_phone?: string | null
          snack?: string | null
          state?: string | null
          sugar?: string | null
          testimonial_status?: string | null
          total_non_purchase_visits?: number
          total_order_visits?: number
          total_purchase_visits?: number
          total_repair_visits?: number
          total_visits?: number
        }
        Update: {
          address?: string | null
          anniversary?: string | null
          beverage?: string | null
          billing_phone?: string | null
          city?: string | null
          city_other?: string | null
          client_code?: string
          client_id?: string
          client_potential_category?: string | null
          community?: string | null
          community_other?: string | null
          country?: string | null
          dob?: string | null
          first_visit_date?: string | null
          gender?: string | null
          gift_history?: Json | null
          google_review_status?: string | null
          high_potential_reason?: string | null
          household_id?: string | null
          instagram_status?: string | null
          last_bought_categories?: string[] | null
          last_branch_id?: string | null
          last_buy_status?: Database["public"]["Enums"]["buy_status"] | null
          last_crm_name?: string | null
          last_order_categories?: string[] | null
          last_product_requirement?: string | null
          last_remark?: string | null
          last_salesperson_id?: string | null
          last_seen_categories?: string[] | null
          last_visit_date?: string | null
          lifecycle_stage?: string
          next_visit_date?: string | null
          other_known_phones?: string[] | null
          other_names?: string[] | null
          pincode?: string | null
          primary_name?: string
          primary_phone?: string | null
          profile_updated_at?: string
          profile_updated_by?: string | null
          referral_code?: string
          referral_relation?: string | null
          referral_status?: string | null
          referred_by_client_id?: string | null
          secondary_phone?: string | null
          snack?: string | null
          state?: string | null
          sugar?: string | null
          testimonial_status?: string | null
          total_non_purchase_visits?: number
          total_order_visits?: number
          total_purchase_visits?: number
          total_repair_visits?: number
          total_visits?: number
        }
        Relationships: [
          {
            foreignKeyName: "clients_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_last_branch_id_fkey"
            columns: ["last_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_last_salesperson_id_fkey"
            columns: ["last_salesperson_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_profile_updated_by_fkey"
            columns: ["profile_updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_referred_by_client_id_fkey"
            columns: ["referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "clients_referred_by_client_id_fkey"
            columns: ["referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      crm_allocation: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          crm_name: string
          crm_user_id: string | null
          id: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          created_at?: string
          crm_name: string
          crm_user_id?: string | null
          id?: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          crm_name?: string
          crm_user_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_allocation_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_allocation_crm_user_id_fkey"
            columns: ["crm_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_daily_availability: {
        Row: {
          branch_id: string
          created_at: string
          crm_name: string
          date: string
          id: string
          is_available: boolean
        }
        Insert: {
          branch_id: string
          created_at?: string
          crm_name: string
          date: string
          id?: string
          is_available?: boolean
        }
        Update: {
          branch_id?: string
          created_at?: string
          crm_name?: string
          date?: string
          id?: string
          is_available?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crm_daily_availability_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_queue_round_robin: {
        Row: {
          branch_id: string
          last_index: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          last_index?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          last_index?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_queue_round_robin_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sso_access_audit: {
        Row: {
          action: string
          actor_crm_auth_user_id: string | null
          created_at: string
          grant_id: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_crm_auth_user_id?: string | null
          created_at?: string
          grant_id?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_crm_auth_user_id?: string | null
          created_at?: string
          grant_id?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_sso_access_audit_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "crm_sso_access_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sso_access_grants: {
        Row: {
          active: boolean
          created_at: string
          crm_auth_user_id: string | null
          id: string
          jewelos_user_id: string
          legacy_crm_user_id: string
          updated_at: string
          work_email: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          crm_auth_user_id?: string | null
          id?: string
          jewelos_user_id: string
          legacy_crm_user_id: string
          updated_at?: string
          work_email: string
        }
        Update: {
          active?: boolean
          created_at?: string
          crm_auth_user_id?: string | null
          id?: string
          jewelos_user_id?: string
          legacy_crm_user_id?: string
          updated_at?: string
          work_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sso_access_grants_legacy_crm_user_id_fkey"
            columns: ["legacy_crm_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          client_id: string
          client_timeline_id: string | null
          created_at: string
          file_name: string
          id: string
          mime_type: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          client_id: string
          client_timeline_id?: string | null
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          client_id?: string
          client_timeline_id?: string | null
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "documents_client_timeline_id_client_id_fkey"
            columns: ["client_timeline_id", "client_id"]
            isOneToOne: false
            referencedRelation: "client_timeline"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      entry_queue: {
        Row: {
          assigned_crm_name: string | null
          branch_id: string
          client_id: string | null
          client_is_new: boolean
          client_name: string
          created_at: string
          full_form_timestamp: string | null
          id: string
          mobile: string
          remark: string | null
          status: string
          token: string
        }
        Insert: {
          assigned_crm_name?: string | null
          branch_id: string
          client_id?: string | null
          client_is_new?: boolean
          client_name: string
          created_at?: string
          full_form_timestamp?: string | null
          id?: string
          mobile: string
          remark?: string | null
          status?: string
          token: string
        }
        Update: {
          assigned_crm_name?: string | null
          branch_id?: string
          client_id?: string | null
          client_is_new?: boolean
          client_name?: string
          created_at?: string
          full_form_timestamp?: string | null
          id?: string
          mobile?: string
          remark?: string | null
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "entry_queue_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entry_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "entry_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          created_by: string | null
          household_code: string
          id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          household_code?: string
          id?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          household_code?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "households_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_call_history: {
        Row: {
          call_duration_seconds: number | null
          call_response: Database["public"]["Enums"]["lead_call_response"]
          created_at: string
          entered_by: string
          id: string
          lead_id: string | null
          next_followup_date: string | null
          recording_storage_path: string | null
          recording_upload_status: Database["public"]["Enums"]["lead_recording_upload_status"]
          remark: string | null
        }
        Insert: {
          call_duration_seconds?: number | null
          call_response: Database["public"]["Enums"]["lead_call_response"]
          created_at?: string
          entered_by: string
          id?: string
          lead_id?: string | null
          next_followup_date?: string | null
          recording_storage_path?: string | null
          recording_upload_status?: Database["public"]["Enums"]["lead_recording_upload_status"]
          remark?: string | null
        }
        Update: {
          call_duration_seconds?: number | null
          call_response?: Database["public"]["Enums"]["lead_call_response"]
          created_at?: string
          entered_by?: string
          id?: string
          lead_id?: string | null
          next_followup_date?: string | null
          recording_storage_path?: string | null
          recording_upload_status?: Database["public"]["Enums"]["lead_recording_upload_status"]
          remark?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_call_history_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_call_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_form_field_options: {
        Row: {
          display_order: number
          field_id: string
          id: string
          option_value: string
          triggers_field_key: string | null
        }
        Insert: {
          display_order: number
          field_id: string
          id?: string
          option_value: string
          triggers_field_key?: string | null
        }
        Update: {
          display_order?: number
          field_id?: string
          id?: string
          option_value?: string
          triggers_field_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_form_field_options_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "lead_form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_form_field_options_triggers_field_key_fkey"
            columns: ["triggers_field_key"]
            isOneToOne: false
            referencedRelation: "lead_form_fields"
            referencedColumns: ["field_key"]
          },
        ]
      }
      lead_form_fields: {
        Row: {
          created_at: string
          display_order: number
          field_key: string
          field_type: Database["public"]["Enums"]["lead_field_type"]
          id: string
          is_hidden: boolean
          is_mandatory: boolean
          is_runo_synced: boolean
          label: string
          option_source: string | null
          parent_field_key: string | null
          runo_field_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order: number
          field_key: string
          field_type: Database["public"]["Enums"]["lead_field_type"]
          id?: string
          is_hidden?: boolean
          is_mandatory?: boolean
          is_runo_synced?: boolean
          label: string
          option_source?: string | null
          parent_field_key?: string | null
          runo_field_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          field_key?: string
          field_type?: Database["public"]["Enums"]["lead_field_type"]
          id?: string
          is_hidden?: boolean
          is_mandatory?: boolean
          is_runo_synced?: boolean
          label?: string
          option_source?: string | null
          parent_field_key?: string | null
          runo_field_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_form_fields_parent_field_key_fkey"
            columns: ["parent_field_key"]
            isOneToOne: false
            referencedRelation: "lead_form_fields"
            referencedColumns: ["field_key"]
          },
        ]
      }
      lead_stage_history: {
        Row: {
          changed_at: string
          changed_by: string
          id: string
          lead_id: string
          new_stage: Database["public"]["Enums"]["lead_source_channel"]
          notes: string | null
          old_stage: Database["public"]["Enums"]["lead_source_channel"] | null
        }
        Insert: {
          changed_at?: string
          changed_by: string
          id?: string
          lead_id: string
          new_stage: Database["public"]["Enums"]["lead_source_channel"]
          notes?: string | null
          old_stage?: Database["public"]["Enums"]["lead_source_channel"] | null
        }
        Update: {
          changed_at?: string
          changed_by?: string
          id?: string
          lead_id?: string
          new_stage?: Database["public"]["Enums"]["lead_source_channel"]
          notes?: string | null
          old_stage?: Database["public"]["Enums"]["lead_source_channel"] | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_stage_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          branch_id: string | null
          client_id: string | null
          converted_to_client_id: string | null
          created_at: string
          created_by: string
          created_via: Database["public"]["Enums"]["lead_created_via"]
          field_values: Json
          id: string
          name: string | null
          phone_number: string
          runo_customer_id: string | null
          runo_push_error: string | null
          runo_pushed: boolean
          source_channel: Database["public"]["Enums"]["lead_source_channel"]
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          client_id?: string | null
          converted_to_client_id?: string | null
          created_at?: string
          created_by: string
          created_via?: Database["public"]["Enums"]["lead_created_via"]
          field_values?: Json
          id?: string
          name?: string | null
          phone_number: string
          runo_customer_id?: string | null
          runo_push_error?: string | null
          runo_pushed?: boolean
          source_channel?: Database["public"]["Enums"]["lead_source_channel"]
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          client_id?: string | null
          converted_to_client_id?: string | null
          created_at?: string
          created_by?: string
          created_via?: Database["public"]["Enums"]["lead_created_via"]
          field_values?: Json
          id?: string
          name?: string | null
          phone_number?: string
          runo_customer_id?: string | null
          runo_push_error?: string | null
          runo_pushed?: boolean
          source_channel?: Database["public"]["Enums"]["lead_source_channel"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "leads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "leads_converted_to_client_id_fkey"
            columns: ["converted_to_client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "leads_converted_to_client_id_fkey"
            columns: ["converted_to_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_import_keys: {
        Row: {
          imported_at: string
          source_key: string
          target_id: string | null
          target_table: string
        }
        Insert: {
          imported_at?: string
          source_key: string
          target_id?: string | null
          target_table: string
        }
        Update: {
          imported_at?: string
          source_key?: string
          target_id?: string | null
          target_table?: string
        }
        Relationships: []
      }
      legacy_walkin_ingest_attempts: {
        Row: {
          created_at: string
          id: string
          outcome: string
          payload: Json
          payload_hash: string | null
          request_id: string
          result: Json
          source_ip: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          outcome: string
          payload: Json
          payload_hash?: string | null
          request_id: string
          result: Json
          source_ip?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          outcome?: string
          payload?: Json
          payload_hash?: string | null
          request_id?: string
          result?: Json
          source_ip?: string | null
        }
        Relationships: []
      }
      legacy_walkin_ingest_rate_limits: {
        Row: {
          bucket_start: string
          key_name: string
          request_count: number
        }
        Insert: {
          bucket_start: string
          key_name: string
          request_count?: number
        }
        Update: {
          bucket_start?: string
          key_name?: string
          request_count?: number
        }
        Relationships: []
      }
      lookup_beverages: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_cities: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_communities: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_gifts: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_not_bought_reasons: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_pincodes: {
        Row: {
          active: boolean
          city: string | null
          country: string | null
          id: string
          pincode: string
          state: string | null
        }
        Insert: {
          active?: boolean
          city?: string | null
          country?: string | null
          id?: string
          pincode: string
          state?: string | null
        }
        Update: {
          active?: boolean
          city?: string | null
          country?: string | null
          id?: string
          pincode?: string
          state?: string | null
        }
        Relationships: []
      }
      lookup_product_categories: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_relations: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_snacks: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_source_of_leads: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      lookup_sugar_options: {
        Row: {
          active: boolean
          id: string
          label: string
        }
        Insert: {
          active?: boolean
          id?: string
          label: string
        }
        Update: {
          active?: boolean
          id?: string
          label?: string
        }
        Relationships: []
      }
      not_bought_followups: {
        Row: {
          action_point: string | null
          branch_id: string | null
          call_response: string | null
          client_id: string
          created_at: string
          entered_by: string
          followup_count: number
          id: string
          next_followup_date: string | null
          reference_number: string | null
          remark: string | null
          source_timeline_id: string | null
          source_visit_form_id: string | null
          status: string
        }
        Insert: {
          action_point?: string | null
          branch_id?: string | null
          call_response?: string | null
          client_id: string
          created_at?: string
          entered_by: string
          followup_count?: number
          id?: string
          next_followup_date?: string | null
          reference_number?: string | null
          remark?: string | null
          source_timeline_id?: string | null
          source_visit_form_id?: string | null
          status: string
        }
        Update: {
          action_point?: string | null
          branch_id?: string | null
          call_response?: string | null
          client_id?: string
          created_at?: string
          entered_by?: string
          followup_count?: number
          id?: string
          next_followup_date?: string | null
          reference_number?: string | null
          remark?: string | null
          source_timeline_id?: string | null
          source_visit_form_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "not_bought_followups_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "not_bought_followups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "not_bought_followups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "not_bought_followups_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "not_bought_followups_source_timeline_id_fkey"
            columns: ["source_timeline_id"]
            isOneToOne: false
            referencedRelation: "client_timeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "not_bought_followups_source_visit_form_id_fkey"
            columns: ["source_visit_form_id"]
            isOneToOne: false
            referencedRelation: "visit_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      not_bought_history: {
        Row: {
          call_response: string | null
          created_at: string
          followup_id: string
          id: string
          previous_status: string | null
          remark: string | null
          status: string
          updated_by: string | null
        }
        Insert: {
          call_response?: string | null
          created_at?: string
          followup_id: string
          id?: string
          previous_status?: string | null
          remark?: string | null
          status: string
          updated_by?: string | null
        }
        Update: {
          call_response?: string | null
          created_at?: string
          followup_id?: string
          id?: string
          previous_status?: string | null
          remark?: string | null
          status?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "not_bought_history_followup_id_fkey"
            columns: ["followup_id"]
            isOneToOne: false
            referencedRelation: "not_bought_followups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "not_bought_history_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_calling: {
        Row: {
          action_point: string | null
          call_response: string | null
          converted_client_id: string | null
          created_at: string
          followup_count: number
          id: string
          next_followup_date: string | null
          referral_id: string
          remark: string | null
          status: string
        }
        Insert: {
          action_point?: string | null
          call_response?: string | null
          converted_client_id?: string | null
          created_at?: string
          followup_count?: number
          id?: string
          next_followup_date?: string | null
          referral_id: string
          remark?: string | null
          status: string
        }
        Update: {
          action_point?: string | null
          call_response?: string | null
          converted_client_id?: string | null
          created_at?: string
          followup_count?: number
          id?: string
          next_followup_date?: string | null
          referral_id?: string
          remark?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_calling_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "referral_calling_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "referral_calling_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_calling_history: {
        Row: {
          call_response: string | null
          created_at: string
          entered_by: string | null
          followup_date: string | null
          id: string
          next_followup_date: string | null
          previous_status: string | null
          referral_calling_id: string
          remark: string | null
          request_key: string | null
          source: string | null
          status: string
          updated_by: string | null
        }
        Insert: {
          call_response?: string | null
          created_at?: string
          entered_by?: string | null
          followup_date?: string | null
          id?: string
          next_followup_date?: string | null
          previous_status?: string | null
          referral_calling_id: string
          remark?: string | null
          request_key?: string | null
          source?: string | null
          status: string
          updated_by?: string | null
        }
        Update: {
          call_response?: string | null
          created_at?: string
          entered_by?: string | null
          followup_date?: string | null
          id?: string
          next_followup_date?: string | null
          previous_status?: string | null
          referral_calling_id?: string
          remark?: string | null
          request_key?: string | null
          source?: string | null
          status?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_calling_history_referral_calling_id_fkey"
            columns: ["referral_calling_id"]
            isOneToOne: false
            referencedRelation: "referral_calling"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_calling_history_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          assigned_doer: string | null
          best_time_to_call: string | null
          branch_id: string | null
          created_at: string
          crm_name: string | null
          given_by_client_id: string
          id: string
          referral_name: string
          referral_number: string
          referred_client_id: string | null
          relationship: string | null
          salesperson_id: string
          source_timeline_id: string | null
          source_visit_form_id: string | null
        }
        Insert: {
          assigned_doer?: string | null
          best_time_to_call?: string | null
          branch_id?: string | null
          created_at?: string
          crm_name?: string | null
          given_by_client_id: string
          id?: string
          referral_name: string
          referral_number: string
          referred_client_id?: string | null
          relationship?: string | null
          salesperson_id: string
          source_timeline_id?: string | null
          source_visit_form_id?: string | null
        }
        Update: {
          assigned_doer?: string | null
          best_time_to_call?: string | null
          branch_id?: string | null
          created_at?: string
          crm_name?: string | null
          given_by_client_id?: string
          id?: string
          referral_name?: string
          referral_number?: string
          referred_client_id?: string | null
          relationship?: string | null
          salesperson_id?: string
          source_timeline_id?: string | null
          source_visit_form_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_given_by_client_id_fkey"
            columns: ["given_by_client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "referrals_given_by_client_id_fkey"
            columns: ["given_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "referrals_referred_client_id_fkey"
            columns: ["referred_client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "referrals_referred_client_id_fkey"
            columns: ["referred_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "referrals_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_source_timeline_id_fkey"
            columns: ["source_timeline_id"]
            isOneToOne: false
            referencedRelation: "client_timeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_source_visit_form_id_fkey"
            columns: ["source_visit_form_id"]
            isOneToOne: false
            referencedRelation: "visit_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          active: boolean
          branch_id: string | null
          created_at: string
          email: string
          id: string
          name: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          email: string
          id: string
          name: string
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "users_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_forms: {
        Row: {
          additional_fields: Json
          bridal_or_non_bridal: string | null
          category_details: Json
          client_timeline_id: string
          client_type: string | null
          communication_preference: string | null
          companions: Json
          created_at: string
          did_buy: boolean | null
          feedback_form_asked: boolean | null
          feedback_form_no_reason: string | null
          feedback_form_proof_url: string | null
          google_review_asked: boolean | null
          google_review_no_reason: string | null
          google_review_proof_url: string | null
          id: string
          instagram_asked: boolean | null
          instagram_no_reason: string | null
          instagram_proof_url: string | null
          marketing_message_sent: string | null
          not_bought_other: string | null
          not_bought_reasons: string[]
          occupation: string | null
          occupation_other: string | null
          reference_name: string | null
          reference_phone: string | null
          referrals_asked: boolean | null
          referrals_no_reason: string | null
          referrals_proof_url: string | null
          repair_or_order_approach: string | null
          source_of_lead: string | null
          source_of_lead_other: string | null
          testimonial_asked: boolean | null
          testimonial_no_reason: string | null
          testimonial_proof_url: string | null
          thank_you_note_asked: boolean | null
          thank_you_note_no_reason: string | null
          thank_you_note_proof_url: string | null
          updated_at: string
          wedding_month: number | null
          wedding_year: number | null
        }
        Insert: {
          additional_fields?: Json
          bridal_or_non_bridal?: string | null
          category_details?: Json
          client_timeline_id: string
          client_type?: string | null
          communication_preference?: string | null
          companions?: Json
          created_at?: string
          did_buy?: boolean | null
          feedback_form_asked?: boolean | null
          feedback_form_no_reason?: string | null
          feedback_form_proof_url?: string | null
          google_review_asked?: boolean | null
          google_review_no_reason?: string | null
          google_review_proof_url?: string | null
          id?: string
          instagram_asked?: boolean | null
          instagram_no_reason?: string | null
          instagram_proof_url?: string | null
          marketing_message_sent?: string | null
          not_bought_other?: string | null
          not_bought_reasons?: string[]
          occupation?: string | null
          occupation_other?: string | null
          reference_name?: string | null
          reference_phone?: string | null
          referrals_asked?: boolean | null
          referrals_no_reason?: string | null
          referrals_proof_url?: string | null
          repair_or_order_approach?: string | null
          source_of_lead?: string | null
          source_of_lead_other?: string | null
          testimonial_asked?: boolean | null
          testimonial_no_reason?: string | null
          testimonial_proof_url?: string | null
          thank_you_note_asked?: boolean | null
          thank_you_note_no_reason?: string | null
          thank_you_note_proof_url?: string | null
          updated_at?: string
          wedding_month?: number | null
          wedding_year?: number | null
        }
        Update: {
          additional_fields?: Json
          bridal_or_non_bridal?: string | null
          category_details?: Json
          client_timeline_id?: string
          client_type?: string | null
          communication_preference?: string | null
          companions?: Json
          created_at?: string
          did_buy?: boolean | null
          feedback_form_asked?: boolean | null
          feedback_form_no_reason?: string | null
          feedback_form_proof_url?: string | null
          google_review_asked?: boolean | null
          google_review_no_reason?: string | null
          google_review_proof_url?: string | null
          id?: string
          instagram_asked?: boolean | null
          instagram_no_reason?: string | null
          instagram_proof_url?: string | null
          marketing_message_sent?: string | null
          not_bought_other?: string | null
          not_bought_reasons?: string[]
          occupation?: string | null
          occupation_other?: string | null
          reference_name?: string | null
          reference_phone?: string | null
          referrals_asked?: boolean | null
          referrals_no_reason?: string | null
          referrals_proof_url?: string | null
          repair_or_order_approach?: string | null
          source_of_lead?: string | null
          source_of_lead_other?: string | null
          testimonial_asked?: boolean | null
          testimonial_no_reason?: string | null
          testimonial_proof_url?: string | null
          thank_you_note_asked?: boolean | null
          thank_you_note_no_reason?: string | null
          thank_you_note_proof_url?: string | null
          updated_at?: string
          wedding_month?: number | null
          wedding_year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_forms_client_timeline_id_fkey"
            columns: ["client_timeline_id"]
            isOneToOne: false
            referencedRelation: "client_timeline"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      client_identity: {
        Row: {
          client_code: string | null
          client_id: string | null
          household_code: string | null
          household_id: string | null
          lifecycle_stage: string | null
          referral_code: string | null
          referral_id: string | null
          referral_person_id: string | null
          referred_by_client_code: string | null
          referred_by_client_id: string | null
          referred_by_name: string | null
          relation: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_referred_by_client_id_fkey"
            columns: ["referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "client_identity"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "clients_referred_by_client_id_fkey"
            columns: ["referred_by_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
    }
    Functions: {
      add_client_to_family: {
        Args: { p_client_id: string; p_member_client_id: string }
        Returns: string
      }
      assign_next_available_crm: {
        Args: { p_branch_id: string }
        Returns: string
      }
      browse_clients:
        | {
            Args: {
              page_offset: number
              result_limit: number
              search_text: string
            }
            Returns: {
              city: string
              client_code: string
              client_id: string
              last_buy_status: string
              last_visit_date: string
              primary_name: string
              primary_phone: string
              state: string
              total_visits: number
            }[]
          }
        | {
            Args: {
              page_offset: number
              potential_category: string
              result_limit: number
              search_text: string
            }
            Returns: {
              city: string
              client_code: string
              client_id: string
              client_potential_category: string
              last_buy_status: string
              last_visit_date: string
              primary_name: string
              primary_phone: string
              state: string
              total_visits: number
            }[]
          }
      consume_legacy_walkin_ingest_rate_limit: {
        Args: { p_key_name: string }
        Returns: boolean
      }
      convert_referral_to_client: {
        Args: { p_referral_calling_id: string }
        Returns: string
      }
      create_client_with_phone: {
        Args: {
          p_branch_id?: string
          p_gender?: string
          p_primary_name: string
          p_primary_phone: string
        }
        Returns: string
      }
      create_entry_queue: {
        Args: {
          p_assigned_crm_name?: string
          p_branch_id?: string
          p_client_id?: string
          p_client_name: string
          p_mobile: string
        }
        Returns: {
          client_code: string
          client_id: string
          client_type: string
          id: string
          token: string
        }[]
      }
      create_manual_referral:
        | {
            Args: {
              p_branch_id?: string
              p_client_id: string
              p_crm_name?: string
              p_referral_name: string
              p_referral_number: string
            }
            Returns: {
              assigned_doer: string | null
              best_time_to_call: string | null
              branch_id: string | null
              created_at: string
              crm_name: string | null
              given_by_client_id: string
              id: string
              referral_name: string
              referral_number: string
              referred_client_id: string | null
              relationship: string | null
              salesperson_id: string
              source_timeline_id: string | null
              source_visit_form_id: string | null
            }
            SetofOptions: {
              from: "*"
              to: "referrals"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_best_time_to_call: string
              p_branch_id: string
              p_client_id: string
              p_crm_name: string
              p_referral_name: string
              p_referral_number: string
              p_relationship: string
            }
            Returns: {
              assigned_doer: string | null
              best_time_to_call: string | null
              branch_id: string | null
              created_at: string
              crm_name: string | null
              given_by_client_id: string
              id: string
              referral_name: string
              referral_number: string
              referred_client_id: string | null
              relationship: string | null
              salesperson_id: string
              source_timeline_id: string | null
              source_visit_form_id: string | null
            }
            SetofOptions: {
              from: "*"
              to: "referrals"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      create_post_call_lead: {
        Args: {
          p_call_duration_seconds?: number
          p_call_response: Database["public"]["Enums"]["lead_call_response"]
          p_field_values: Json
          p_name: string
          p_next_followup_date?: string
          p_phone_number: string
          p_recording_upload_status?: Database["public"]["Enums"]["lead_recording_upload_status"]
          p_remark?: string
        }
        Returns: {
          branch_id: string | null
          client_id: string | null
          converted_to_client_id: string | null
          created_at: string
          created_by: string
          created_via: Database["public"]["Enums"]["lead_created_via"]
          field_values: Json
          id: string
          name: string | null
          phone_number: string
          runo_customer_id: string | null
          runo_push_error: string | null
          runo_pushed: boolean
          source_channel: Database["public"]["Enums"]["lead_source_channel"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_referral_calling_if_open: {
        Args: {
          p_name: string
          p_next_date: string
          p_number: string
          p_referral_id: string
        }
        Returns: undefined
      }
      crm_apply_staff_snapshot: {
        Args: { p_event_id: string; p_snapshot: Json }
        Returns: Json
      }
      crm_reconcile_staff_roster: {
        Args: { p_run_id: string; p_snapshots: Json }
        Returns: Json
      }
      crm_roster_candidates: {
        Args: { p_branch_id: string }
        Returns: {
          id: string
          name: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      crm_sync_health: { Args: never; Returns: Json }
      current_crm_user_id: { Args: never; Returns: string }
      current_user_branch_id: { Args: never; Returns: string }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      dedupe_category_array: { Args: { p_values: string[] }; Returns: string[] }
      get_my_profile: {
        Args: never
        Returns: {
          branch_name: string
          name: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      is_branch_manager: { Args: { row_branch_id: string }; Returns: boolean }
      is_branch_staff: { Args: { row_branch_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_user_in_current_branch: {
        Args: { row_user_id: string }
        Returns: boolean
      }
      legacy_call_outcome_status: {
        Args: { p_outcome: string }
        Returns: string
      }
      legacy_status_is_done: { Args: { p_status: string }; Returns: boolean }
      legacy_walkin_ingest_log_attempt: {
        Args: {
          p_outcome: string
          p_payload: Json
          p_payload_hash: string
          p_request_id: string
          p_result: Json
          p_source_ip: string
        }
        Returns: undefined
      }
      legacy_walkin_ingest_submit: {
        Args: {
          p_audit_payload: Json
          p_branch_name: string
          p_payload: Json
          p_payload_hash: string
          p_request_id: string
          p_source_ip: string
        }
        Returns: Json
      }
      lookup_client_by_phone: {
        Args: { p_phone: string }
        Returns: {
          address: string
          city: string
          client_code: string
          client_id: string
          community: string
          country: string
          dob: string
          gender: string
          pincode: string
          primary_name: string
          primary_phone: string
          state: string
        }[]
      }
      manage_crm_roster: {
        Args: {
          p_branch_id?: string
          p_crm_name?: string
          p_crm_user_id?: string
          p_operation: string
          p_roster_id?: string
          p_target_branch_id?: string
        }
        Returns: {
          active: boolean
          branch_id: string
          crm_name: string
          id: string
          message: string
        }[]
      }
      next_business_day: { Args: { p_date: string }; Returns: string }
      normalize_crm_roster_value: { Args: { value: string }; Returns: string }
      not_bought_followup_status_is_done: {
        Args: { p_status: string }
        Returns: boolean
      }
      reconcile_referral_calling_conversions: { Args: never; Returns: number }
      remove_client_from_family: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      save_not_bought_followup: {
        Args: {
          p_call_response: string
          p_followup_id: string
          p_followup_status: string
          p_next_followup_date?: string
          p_remark?: string
        }
        Returns: {
          action_point: string | null
          branch_id: string | null
          call_response: string | null
          client_id: string
          created_at: string
          entered_by: string
          followup_count: number
          id: string
          next_followup_date: string | null
          reference_number: string | null
          remark: string | null
          source_timeline_id: string | null
          source_visit_form_id: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "not_bought_followups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_referral_followup:
        | {
            Args: {
              p_call_response: string
              p_entered_by?: string
              p_followup_status: string
              p_next_followup_date?: string
              p_referral_calling_id: string
              p_remark?: string
            }
            Returns: {
              action_point: string | null
              call_response: string | null
              converted_client_id: string | null
              created_at: string
              followup_count: number
              id: string
              next_followup_date: string | null
              referral_id: string
              remark: string | null
              status: string
            }
            SetofOptions: {
              from: "*"
              to: "referral_calling"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_call_response: string
              p_entered_by?: string
              p_followup_status: string
              p_next_followup_date?: string
              p_referral_calling_id: string
              p_remark?: string
              p_request_key?: string
            }
            Returns: {
              action_point: string | null
              call_response: string | null
              converted_client_id: string | null
              created_at: string
              followup_count: number
              id: string
              next_followup_date: string | null
              referral_id: string
              remark: string | null
              status: string
            }
            SetofOptions: {
              from: "*"
              to: "referral_calling"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      search_clients: {
        Args: { result_limit?: number; search_text: string }
        Returns: {
          client_code: string
          client_id: string
          household_code: string
          last_branch_name: string
          last_buy_status: string
          last_visit_date: string
          matched_phone: string
          primary_name: string
          primary_phone: string
          referral_code: string
          total_visits: number
        }[]
      }
      submit_legacy_walkin_visit: {
        Args: { p_payload: Json }
        Returns: {
          client_id: string
          reference_number: string
          timeline_id: string
        }[]
      }
      submit_walkin_visit: {
        Args: { p_payload: Json }
        Returns: {
          client_id: string
          reference_number: string
          timeline_id: string
        }[]
      }
      sync_not_bought_followups: { Args: never; Returns: number }
      update_not_bought_followup: {
        Args: {
          p_call_response: string
          p_followup_id: string
          p_next_followup_date?: string
          p_remark?: string
        }
        Returns: {
          action_point: string | null
          branch_id: string | null
          call_response: string | null
          client_id: string
          created_at: string
          entered_by: string
          followup_count: number
          id: string
          next_followup_date: string | null
          reference_number: string | null
          remark: string | null
          source_timeline_id: string | null
          source_visit_form_id: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "not_bought_followups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_not_bought_reason: {
        Args: { p_followup_id: string; p_other?: string; p_reasons: string[] }
        Returns: undefined
      }
      update_referral_calling: {
        Args: {
          p_call_response: string
          p_next_followup_date?: string
          p_referral_calling_id: string
          p_remark?: string
        }
        Returns: {
          action_point: string | null
          call_response: string | null
          converted_client_id: string | null
          created_at: string
          followup_count: number
          id: string
          next_followup_date: string | null
          referral_id: string
          remark: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "referral_calling"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      buy_status:
        | "ORDER_PLACED"
        | "ORDER_PICKUP"
        | "REPAIR_PLACED"
        | "REPAIR_PICKUP"
        | "PRODUCT_RETURN"
        | "PRODUCT_EXCHANGE"
        | "STORE_VISIT"
        | "PRICE_CALCULATION"
        | "YES"
        | "NO"
        | "YES_AND_ORDER_PLACED"
        | "ORDER_PLACED_AND_BUYING_NEW_PRODUCT"
        | "ORDER_PLACED_AND_MAKING_NEW_ORDER"
        | "ORDER_PICKUP_AND_BUYING_NEW_PRODUCT"
        | "ORDER_PICKUP_AND_MAKING_NEW_ORDER"
        | "REPAIR_PLACED_AND_BUYING_NEW_PRODUCT"
        | "REPAIR_PLACED_AND_MAKING_NEW_ORDER"
        | "REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT"
        | "REPAIR_PICKUP_AND_MAKING_NEW_ORDER"
      event_type:
        | "UPSALE_VISIT"
        | "READY_PRODUCT_PURCHASE"
        | "ORDER_PLACED_VISIT"
        | "ORDER_PICKUP_VISIT"
        | "REPAIR_PLACED_VISIT"
        | "REPAIR_PICKUP_VISIT"
        | "PRODUCT_RETURN_VISIT"
        | "PRODUCT_EXCHANGE_VISIT"
        | "NON_PURCHASE_VISIT"
        | "STORE_VISIT"
        | "PRICE_CALCULATION_VISIT"
        | "VISIT"
      lead_call_response:
        | "CONNECTED"
        | "NOT PICKED"
        | "SWITCHED OFF"
        | "WHATSAPP ONLY"
        | "WRONG NUMBER"
      lead_created_via: "crm_desktop" | "mobile_post_call"
      lead_field_type: "text" | "number" | "dropdown" | "date" | "geo" | "file"
      lead_recording_upload_status:
        | "pending"
        | "uploaded"
        | "failed"
        | "not_found"
      lead_source_channel: "open" | "contacted" | "converted" | "lost"
      user_role: "super_admin" | "branch_manager" | "salesperson"
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
    Enums: {
      buy_status: [
        "ORDER_PLACED",
        "ORDER_PICKUP",
        "REPAIR_PLACED",
        "REPAIR_PICKUP",
        "PRODUCT_RETURN",
        "PRODUCT_EXCHANGE",
        "STORE_VISIT",
        "PRICE_CALCULATION",
        "YES",
        "NO",
        "YES_AND_ORDER_PLACED",
        "ORDER_PLACED_AND_BUYING_NEW_PRODUCT",
        "ORDER_PLACED_AND_MAKING_NEW_ORDER",
        "ORDER_PICKUP_AND_BUYING_NEW_PRODUCT",
        "ORDER_PICKUP_AND_MAKING_NEW_ORDER",
        "REPAIR_PLACED_AND_BUYING_NEW_PRODUCT",
        "REPAIR_PLACED_AND_MAKING_NEW_ORDER",
        "REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT",
        "REPAIR_PICKUP_AND_MAKING_NEW_ORDER",
      ],
      event_type: [
        "UPSALE_VISIT",
        "READY_PRODUCT_PURCHASE",
        "ORDER_PLACED_VISIT",
        "ORDER_PICKUP_VISIT",
        "REPAIR_PLACED_VISIT",
        "REPAIR_PICKUP_VISIT",
        "PRODUCT_RETURN_VISIT",
        "PRODUCT_EXCHANGE_VISIT",
        "NON_PURCHASE_VISIT",
        "STORE_VISIT",
        "PRICE_CALCULATION_VISIT",
        "VISIT",
      ],
      lead_call_response: [
        "CONNECTED",
        "NOT PICKED",
        "SWITCHED OFF",
        "WHATSAPP ONLY",
        "WRONG NUMBER",
      ],
      lead_created_via: ["crm_desktop", "mobile_post_call"],
      lead_field_type: ["text", "number", "dropdown", "date", "geo", "file"],
      lead_recording_upload_status: [
        "pending",
        "uploaded",
        "failed",
        "not_found",
      ],
      lead_source_channel: ["open", "contacted", "converted", "lost"],
      user_role: ["super_admin", "branch_manager", "salesperson"],
    },
  },
} as const
