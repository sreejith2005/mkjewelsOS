export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string | null
          id: string
          ip_address: string | null
          module: string
          new_value: Json | null
          old_value: Json | null
          record_id: string | null
          tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          module: string
          new_value?: Json | null
          old_value?: Json | null
          record_id?: string | null
          tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string | null
          id?: string
          ip_address?: string | null
          module?: string
          new_value?: Json | null
          old_value?: Json | null
          record_id?: string | null
          tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          city: string | null
          code: string
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          manager_id: string | null
          name: string
          pincode: string | null
          settings: Json
          settings_version: number
          state: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          manager_id?: string | null
          name: string
          pincode?: string | null
          settings?: Json
          settings_version?: number
          state?: string | null
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          manager_id?: string | null
          name?: string
          pincode?: string | null
          settings?: Json
          settings_version?: number
          state?: string | null
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_manager"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_branch_manager"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      buddy_assignments: {
        Row: {
          buddy_id: string
          created_at: string | null
          date: string
          escalated_to_manager: boolean | null
          id: string
          original_assignee_id: string
          task_instance_id: string | null
          tenant_id: string
        }
        Insert: {
          buddy_id: string
          created_at?: string | null
          date: string
          escalated_to_manager?: boolean | null
          id?: string
          original_assignee_id: string
          task_instance_id?: string | null
          tenant_id: string
        }
        Update: {
          buddy_id?: string
          created_at?: string | null
          date?: string
          escalated_to_manager?: boolean | null
          id?: string
          original_assignee_id?: string
          task_instance_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "buddy_assignments_buddy_id_fkey"
            columns: ["buddy_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buddy_assignments_buddy_id_fkey"
            columns: ["buddy_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buddy_assignments_original_assignee_id_fkey"
            columns: ["original_assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buddy_assignments_original_assignee_id_fkey"
            columns: ["original_assignee_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "buddy_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_buddy_task"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          branch_id: string
          client_id: string
          ended_at: string | null
          ended_by: string | null
          id: string
          is_active: boolean
          tenant_id: string
          user_profile_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          branch_id: string
          client_id: string
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          is_active?: boolean
          tenant_id: string
          user_profile_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          branch_id?: string
          client_id?: string
          ended_at?: string | null
          ended_by?: string | null
          id?: string
          is_active?: boolean
          tenant_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_ended_by_fkey"
            columns: ["ended_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_assignments_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contact_aliases: {
        Row: {
          alias_type: string
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          normalized_phone: string
          tenant_id: string
        }
        Insert: {
          alias_type: string
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          normalized_phone: string
          tenant_id: string
        }
        Update: {
          alias_type?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          normalized_phone?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_contact_aliases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contact_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contact_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contact_aliases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_followups: {
        Row: {
          assigned_to: string | null
          branch_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string
          completed_at: string | null
          completed_by: string | null
          coverage_original_assignee_id: string | null
          coverage_resolution: string | null
          coverage_resolved_for_date: string | null
          coverage_status: string | null
          created_at: string | null
          created_by: string | null
          due_date: string
          id: string
          notes: string | null
          outcome: string | null
          record_version: number
          status: string | null
          subject: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workflow_key: string | null
        }
        Insert: {
          assigned_to?: string | null
          branch_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id: string
          completed_at?: string | null
          completed_by?: string | null
          coverage_original_assignee_id?: string | null
          coverage_resolution?: string | null
          coverage_resolved_for_date?: string | null
          coverage_status?: string | null
          created_at?: string | null
          created_by?: string | null
          due_date: string
          id?: string
          notes?: string | null
          outcome?: string | null
          record_version?: number
          status?: string | null
          subject?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workflow_key?: string | null
        }
        Update: {
          assigned_to?: string | null
          branch_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string
          completed_at?: string | null
          completed_by?: string | null
          coverage_original_assignee_id?: string | null
          coverage_resolution?: string | null
          coverage_resolved_for_date?: string | null
          coverage_status?: string | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string
          id?: string
          notes?: string | null
          outcome?: string | null
          record_version?: number
          status?: string | null
          subject?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workflow_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_followups_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_coverage_original_assignee_id_fkey"
            columns: ["coverage_original_assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_coverage_original_assignee_id_fkey"
            columns: ["coverage_original_assignee_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_followups_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_timeline: {
        Row: {
          branch_id: string | null
          client_id: string
          correction_of_id: string | null
          created_at: string | null
          created_by: string | null
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          outcome: string | null
          ref_id: string | null
          subject: string | null
          summary: string | null
          tenant_id: string
        }
        Insert: {
          branch_id?: string | null
          client_id: string
          correction_of_id?: string | null
          created_at?: string | null
          created_by?: string | null
          event_type: string
          id?: string
          metadata?: Json
          occurred_at: string
          outcome?: string | null
          ref_id?: string | null
          subject?: string | null
          summary?: string | null
          tenant_id: string
        }
        Update: {
          branch_id?: string | null
          client_id?: string
          correction_of_id?: string | null
          created_at?: string | null
          created_by?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          outcome?: string | null
          ref_id?: string | null
          subject?: string | null
          summary?: string | null
          tenant_id?: string
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
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_timeline_correction_of_id_fkey"
            columns: ["correction_of_id"]
            isOneToOne: false
            referencedRelation: "client_timeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_timeline_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          anniversary_date: string | null
          assigned_crm_id: string | null
          billing_phone: string | null
          branch_id: string | null
          city: string | null
          client_type_id: string | null
          communication_consent: boolean | null
          communication_preference: string | null
          created_at: string | null
          created_by: string | null
          date_of_birth: string | null
          email: string | null
          first_name: string | null
          gender: string | null
          id: string
          last_name: string | null
          last_visit_date: string | null
          merged_into_client_id: string | null
          next_visit_date: string | null
          normalized_billing_phone: string | null
          normalized_phone: string | null
          phone: string
          pincode: string | null
          potential_category: string | null
          record_version: number
          source_id: string | null
          state: string | null
          status: string
          tags: string[]
          tenant_id: string
          total_visits: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          anniversary_date?: string | null
          assigned_crm_id?: string | null
          billing_phone?: string | null
          branch_id?: string | null
          city?: string | null
          client_type_id?: string | null
          communication_consent?: boolean | null
          communication_preference?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          last_visit_date?: string | null
          merged_into_client_id?: string | null
          next_visit_date?: string | null
          normalized_billing_phone?: string | null
          normalized_phone?: string | null
          phone: string
          pincode?: string | null
          potential_category?: string | null
          record_version?: number
          source_id?: string | null
          state?: string | null
          status?: string
          tags?: string[]
          tenant_id: string
          total_visits?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          anniversary_date?: string | null
          assigned_crm_id?: string | null
          billing_phone?: string | null
          branch_id?: string | null
          city?: string | null
          client_type_id?: string | null
          communication_consent?: boolean | null
          communication_preference?: string | null
          created_at?: string | null
          created_by?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          last_visit_date?: string | null
          merged_into_client_id?: string | null
          next_visit_date?: string | null
          normalized_billing_phone?: string | null
          normalized_phone?: string | null
          phone?: string
          pincode?: string | null
          potential_category?: string | null
          record_version?: number
          source_id?: string | null
          state?: string | null
          status?: string
          tags?: string[]
          tenant_id?: string
          total_visits?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_assigned_crm_id_fkey"
            columns: ["assigned_crm_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_assigned_crm_id_fkey"
            columns: ["assigned_crm_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_client_type_id_fkey"
            columns: ["client_type_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_merged_into_client_id_fkey"
            columns: ["merged_into_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_branch_mappings: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          external_branch_id: string
          id: string
          metadata: Json
          source_system_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          external_branch_id: string
          id?: string
          metadata?: Json
          source_system_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          external_branch_id?: string
          id?: string
          metadata?: Json
          source_system_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_branch_mappings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_branch_mappings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_branch_mappings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_branch_mappings_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_branch_mappings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_branch_mappings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_custom_field_values: {
        Row: {
          created_at: string
          created_by: string
          definition_id: string
          definition_revision_id: string
          entity_type: string
          id: string
          record_id: string
          tenant_id: string
          updated_at: string
          updated_by: string
          value: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          definition_id: string
          definition_revision_id: string
          entity_type: string
          id?: string
          record_id: string
          tenant_id: string
          updated_at?: string
          updated_by: string
          value: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          definition_id?: string
          definition_revision_id?: string
          entity_type?: string
          id?: string
          record_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_custom_field_values_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "crm_field_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_definition_revision_id_fkey"
            columns: ["definition_revision_id"]
            isOneToOne: false
            referencedRelation: "crm_field_definition_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_custom_field_values_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_documents: {
        Row: {
          branch_id: string | null
          client_id: string
          created_at: string
          id: string
          mime_type: string
          original_filename: string
          parent_id: string
          parent_type: string
          removal_reason: string | null
          removed_at: string | null
          removed_by: string | null
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string
        }
        Insert: {
          branch_id?: string | null
          client_id: string
          created_at?: string
          id?: string
          mime_type: string
          original_filename: string
          parent_id: string
          parent_type: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string
        }
        Update: {
          branch_id?: string | null
          client_id?: string
          created_at?: string
          id?: string
          mime_type?: string
          original_filename?: string
          parent_id?: string
          parent_type?: string
          removal_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_documents_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_field_definition_revisions: {
        Row: {
          created_at: string
          created_by: string
          definition_id: string
          field_type: string
          id: string
          is_required: boolean
          label: string
          options: Json
          revision_number: number
          validation: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          definition_id: string
          field_type: string
          id?: string
          is_required?: boolean
          label: string
          options?: Json
          revision_number: number
          validation?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          definition_id?: string
          field_type?: string
          id?: string
          is_required?: boolean
          label?: string
          options?: Json
          revision_number?: number
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_field_definition_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_field_definition_revisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_field_definition_revisions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "crm_field_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_field_definitions: {
        Row: {
          active_revision_id: string | null
          created_at: string
          created_by: string
          entity_type: string
          field_key: string
          id: string
          is_active: boolean
          tenant_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          active_revision_id?: string | null
          created_at?: string
          created_by: string
          entity_type: string
          field_key: string
          id?: string
          is_active?: boolean
          tenant_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          active_revision_id?: string | null
          created_at?: string
          created_by?: string
          entity_type?: string
          field_key?: string
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_field_definitions_active_revision_fkey"
            columns: ["active_revision_id"]
            isOneToOne: false
            referencedRelation: "crm_field_definition_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_field_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_field_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_field_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_field_definitions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_field_definitions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_identity_review: {
        Row: {
          created_at: string
          id: string
          reason_code: string
          resolution_reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_record_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason_code: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_record_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          reason_code?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_record_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_identity_review_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_identity_review_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_identity_review_source_record_id_fkey"
            columns: ["source_record_id"]
            isOneToOne: false
            referencedRelation: "crm_source_records"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_import_exceptions: {
        Row: {
          created_at: string
          details: Json
          exception_code: string
          id: string
          import_record_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json
          exception_code: string
          id?: string
          import_record_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json
          exception_code?: string
          id?: string
          import_record_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_import_exceptions_import_record_id_fkey"
            columns: ["import_record_id"]
            isOneToOne: false
            referencedRelation: "crm_import_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_import_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_import_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_import_records: {
        Row: {
          created_at: string
          entity_type: string
          external_id: string
          id: string
          import_run_id: string | null
          import_status: string
          payload: Json
          source_checksum: string
          source_system_id: string
          target_record_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          external_id: string
          id?: string
          import_run_id?: string | null
          import_status?: string
          payload: Json
          source_checksum: string
          source_system_id: string
          target_record_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          external_id?: string
          id?: string
          import_run_id?: string | null
          import_status?: string
          payload?: Json
          source_checksum?: string
          source_system_id?: string
          target_record_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_import_records_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "crm_import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_import_records_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_import_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          entity_type: string
          id: string
          mode: string
          source_checksum: string | null
          source_system_id: string
          started_by: string
          status: string
          summary: Json
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          entity_type: string
          id?: string
          mode: string
          source_checksum?: string | null
          source_system_id: string
          started_by: string
          status: string
          summary?: Json
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          entity_type?: string
          id?: string
          mode?: string
          source_checksum?: string | null
          source_system_id?: string
          started_by?: string
          status?: string
          summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_import_runs_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_import_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_import_runs_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_legacy_people: {
        Row: {
          created_at: string
          display_name: string | null
          external_person_id: string
          id: string
          link_status: string
          linked_user_profile_id: string | null
          metadata: Json
          source_system_id: string
          updated_at: string
          work_email_hash: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          external_person_id: string
          id?: string
          link_status?: string
          linked_user_profile_id?: string | null
          metadata?: Json
          source_system_id: string
          updated_at?: string
          work_email_hash?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          external_person_id?: string
          id?: string
          link_status?: string
          linked_user_profile_id?: string | null
          metadata?: Json
          source_system_id?: string
          updated_at?: string
          work_email_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_legacy_people_linked_user_profile_id_fkey"
            columns: ["linked_user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_legacy_people_linked_user_profile_id_fkey"
            columns: ["linked_user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_legacy_people_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_legacy_timeline_details: {
        Row: {
          created_at: string
          external_timeline_id: string
          source_checksum: string
          source_system_id: string
          timeline_id: string
          updated_at: string
          visit_form_payload: Json
        }
        Insert: {
          created_at?: string
          external_timeline_id: string
          source_checksum: string
          source_system_id: string
          timeline_id: string
          updated_at?: string
          visit_form_payload: Json
        }
        Update: {
          created_at?: string
          external_timeline_id?: string
          source_checksum?: string
          source_system_id?: string
          timeline_id?: string
          updated_at?: string
          visit_form_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crm_legacy_timeline_details_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_legacy_timeline_details_timeline_id_fkey"
            columns: ["timeline_id"]
            isOneToOne: true
            referencedRelation: "client_timeline"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_mutation_keys: {
        Row: {
          actor_id: string
          created_at: string
          operation: string
          request_key: string
          result: Json
          result_id: string | null
          tenant_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          operation: string
          request_key: string
          result?: Json
          result_id?: string | null
          tenant_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          operation?: string
          request_key?: string
          result?: Json
          result_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_mutation_keys_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_mutation_keys_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_mutation_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_source_records: {
        Row: {
          created_at: string
          id: string
          observed_at: string | null
          payload: Json
          run_id: string
          scope_key: string
          source_checksum: string
          source_locator: string
          source_row_key: string
          source_system_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          observed_at?: string | null
          payload: Json
          run_id: string
          scope_key: string
          source_checksum: string
          source_locator: string
          source_row_key: string
          source_system_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          observed_at?: string | null
          payload?: Json
          run_id?: string
          scope_key?: string
          source_checksum?: string
          source_locator?: string
          source_row_key?: string
          source_system_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_source_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crm_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_source_records_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_source_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_source_systems: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          source_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          source_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          source_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_staff_mappings: {
        Row: {
          created_at: string
          created_by: string
          external_staff_id: string
          id: string
          metadata: Json
          source_system_id: string
          updated_at: string
          updated_by: string
          user_profile_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          external_staff_id: string
          id?: string
          metadata?: Json
          source_system_id: string
          updated_at?: string
          updated_by: string
          user_profile_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          external_staff_id?: string
          id?: string
          metadata?: Json
          source_system_id?: string
          updated_at?: string
          updated_by?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_staff_mappings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_staff_mappings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_staff_mappings_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_staff_mappings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_staff_mappings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_staff_mappings_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_staff_mappings_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sync_checkpoints: {
        Row: {
          checkpoint: Json
          run_id: string
          scope_key: string
          source_system_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          checkpoint: Json
          run_id: string
          scope_key: string
          source_system_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          checkpoint?: Json
          run_id?: string
          scope_key?: string
          source_system_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sync_checkpoints_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crm_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sync_checkpoints_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sync_checkpoints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sync_operation_requests: {
        Row: {
          created_at: string
          id: string
          operation: string
          request_fingerprint: string
          request_key: string
          response: Json
          run_id: string
          tenant_id: string
          worker_assertion_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          operation: string
          request_fingerprint: string
          request_key: string
          response: Json
          run_id: string
          tenant_id: string
          worker_assertion_id: string
        }
        Update: {
          created_at?: string
          id?: string
          operation?: string
          request_fingerprint?: string
          request_key?: string
          response?: Json
          run_id?: string
          tenant_id?: string
          worker_assertion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sync_operation_requests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "crm_sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sync_operation_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sync_operation_requests_worker_assertion_id_fkey"
            columns: ["worker_assertion_id"]
            isOneToOne: false
            referencedRelation: "crm_sync_worker_assertions"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sync_runs: {
        Row: {
          checkpoint: Json | null
          completed_at: string | null
          id: string
          request_key: string
          scope_key: string
          source_system_id: string
          started_at: string
          status: string
          summary: Json
          tenant_id: string
        }
        Insert: {
          checkpoint?: Json | null
          completed_at?: string | null
          id?: string
          request_key: string
          scope_key: string
          source_system_id: string
          started_at?: string
          status: string
          summary?: Json
          tenant_id: string
        }
        Update: {
          checkpoint?: Json | null
          completed_at?: string | null
          id?: string
          request_key?: string
          scope_key?: string
          source_system_id?: string
          started_at?: string
          status?: string
          summary?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sync_runs_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sync_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_sync_worker_assertions: {
        Row: {
          assertion_hash: string
          created_at: string
          expires_at: string
          id: string
          revoked_at: string | null
          scope_pattern: string
          source_system_id: string
          tenant_id: string
        }
        Insert: {
          assertion_hash: string
          created_at?: string
          expires_at: string
          id?: string
          revoked_at?: string | null
          scope_pattern?: string
          source_system_id: string
          tenant_id: string
        }
        Update: {
          assertion_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          revoked_at?: string | null
          scope_pattern?: string
          source_system_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_sync_worker_assertions_source_system_id_fkey"
            columns: ["source_system_id"]
            isOneToOne: false
            referencedRelation: "crm_source_systems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_sync_worker_assertions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_checklist_acknowledgements: {
        Row: {
          acknowledged_at: string
          acknowledgement_date: string
          checklist_id: string
          checklist_items: Json
          checklist_revision: number
          checklist_title: string
          confirmation_text: string
          created_at: string
          created_by: string
          designation_id: string
          id: string
          tenant_id: string
          updated_at: string
          updated_by: string
          user_profile_id: string
        }
        Insert: {
          acknowledged_at?: string
          acknowledgement_date: string
          checklist_id: string
          checklist_items: Json
          checklist_revision: number
          checklist_title: string
          confirmation_text: string
          created_at?: string
          created_by: string
          designation_id: string
          id?: string
          tenant_id: string
          updated_at?: string
          updated_by: string
          user_profile_id: string
        }
        Update: {
          acknowledged_at?: string
          acknowledgement_date?: string
          checklist_id?: string
          checklist_items?: Json
          checklist_revision?: number
          checklist_title?: string
          confirmation_text?: string
          created_at?: string
          created_by?: string
          designation_id?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_checklist_acknowledgements_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "designation_daily_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklist_acknowledgements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklist_acknowledgements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklist_acknowledgements_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklist_acknowledgements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklist_acknowledgements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklist_acknowledgements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklist_acknowledgements_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_checklist_acknowledgements_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          branch_id: string | null
          code: string
          created_at: string | null
          created_by: string | null
          head_id: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          branch_id?: string | null
          code: string
          created_at?: string | null
          created_by?: string | null
          head_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          branch_id?: string | null
          code?: string
          created_at?: string | null
          created_by?: string | null
          head_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_dept_head"
            columns: ["head_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_dept_head"
            columns: ["head_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      designation_daily_checklists: {
        Row: {
          confirmation_text: string
          created_at: string
          created_by: string
          designation_id: string
          id: string
          instruction: string | null
          is_active: boolean
          items: Json
          revision: number
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          confirmation_text: string
          created_at?: string
          created_by: string
          designation_id: string
          id?: string
          instruction?: string | null
          is_active?: boolean
          items: Json
          revision?: number
          tenant_id: string
          title: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          confirmation_text?: string
          created_at?: string
          created_by?: string
          designation_id?: string
          id?: string
          instruction?: string | null
          is_active?: boolean
          items?: Json
          revision?: number
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "designation_daily_checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designation_daily_checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designation_daily_checklists_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designation_daily_checklists_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designation_daily_checklists_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designation_daily_checklists_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      dropdown_master_categories: {
        Row: {
          category_key: string
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean
          is_key_locked: boolean
          is_system: boolean
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category_key: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name: string
          id?: string
          is_active?: boolean
          is_key_locked?: boolean
          is_system?: boolean
          sort_order?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category_key?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_name?: string
          id?: string
          is_active?: boolean
          is_key_locked?: boolean
          is_system?: boolean
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dropdown_master_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropdown_master_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropdown_master_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropdown_master_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropdown_master_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      dropdown_masters: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          label: string
          master_type: string
          sort_order: number | null
          tenant_id: string | null
          updated_at: string | null
          updated_by: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          master_type: string
          sort_order?: number | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          master_type?: string
          sort_order?: number | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "dropdown_masters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      export_logs: {
        Row: {
          attempt_count: number
          cancelled_at: string | null
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          cleaned_at: string | null
          completed_at: string | null
          expires_at: string | null
          failed_at: string | null
          filter_snapshot: Json | null
          format: string
          id: string
          max_attempts: number
          object_path: string | null
          progress_percent: number
          report_key: string
          request_key: string
          requested_at: string
          requester_role: Database["public"]["Enums"]["user_role"]
          row_count: number | null
          sanitized_error: string | null
          scope_snapshot: Json
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_profile_id: string | null
        }
        Insert: {
          attempt_count?: number
          cancelled_at?: string | null
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          cleaned_at?: string | null
          completed_at?: string | null
          expires_at?: string | null
          failed_at?: string | null
          filter_snapshot?: Json | null
          format?: string
          id?: string
          max_attempts?: number
          object_path?: string | null
          progress_percent?: number
          report_key: string
          request_key: string
          requested_at?: string
          requester_role?: Database["public"]["Enums"]["user_role"]
          row_count?: number | null
          sanitized_error?: string | null
          scope_snapshot?: Json
          started_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          user_profile_id?: string | null
        }
        Update: {
          attempt_count?: number
          cancelled_at?: string | null
          claim_expires_at?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          cleaned_at?: string | null
          completed_at?: string | null
          expires_at?: string | null
          failed_at?: string | null
          filter_snapshot?: Json | null
          format?: string
          id?: string
          max_attempts?: number
          object_path?: string | null
          progress_percent?: number
          report_key?: string
          request_key?: string
          requested_at?: string
          requester_role?: Database["public"]["Enums"]["user_role"]
          row_count?: number | null
          sanitized_error?: string | null
          scope_snapshot?: Json
          started_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          user_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "export_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_logs_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_logs_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_branch_rules: {
        Row: {
          condition_field: string
          condition_operator: string
          condition_value: string | null
          fms_stage_id: string
          id: string
          label: string | null
          next_flow_id: string | null
          next_stage_id: string | null
          sort_order: number | null
          source_key: string | null
          source_type: string
        }
        Insert: {
          condition_field: string
          condition_operator: string
          condition_value?: string | null
          fms_stage_id: string
          id?: string
          label?: string | null
          next_flow_id?: string | null
          next_stage_id?: string | null
          sort_order?: number | null
          source_key?: string | null
          source_type?: string
        }
        Update: {
          condition_field?: string
          condition_operator?: string
          condition_value?: string | null
          fms_stage_id?: string
          id?: string
          label?: string | null
          next_flow_id?: string | null
          next_stage_id?: string | null
          sort_order?: number | null
          source_key?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_branch_rules_fms_stage_id_fkey"
            columns: ["fms_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_branch_rules_next_flow_id_fkey"
            columns: ["next_flow_id"]
            isOneToOne: false
            referencedRelation: "fms_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_branch_rules_next_stage_id_fkey"
            columns: ["next_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_context_assignee_defaults: {
        Row: {
          created_at: string
          created_by: string
          id: string
          module_context: string
          tenant_id: string
          updated_at: string
          updated_by: string
          user_profile_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          module_context: string
          tenant_id: string
          updated_at?: string
          updated_by: string
          user_profile_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          module_context?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_context_assignee_defaults_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_context_assignee_defaults_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_context_assignee_defaults_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_context_assignee_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_context_assignee_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_context_assignee_defaults_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_context_assignee_defaults_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_evidence: {
        Row: {
          created_at: string
          fms_instance_stage_id: string
          id: string
          mime_type: string
          original_filename: string
          removed_at: string | null
          removed_by: string | null
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          fms_instance_stage_id: string
          id?: string
          mime_type: string
          original_filename: string
          removed_at?: string | null
          removed_by?: string | null
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          fms_instance_stage_id?: string
          id?: string
          mime_type?: string
          original_filename?: string
          removed_at?: string | null
          removed_by?: string | null
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_evidence_fms_instance_stage_id_fkey"
            columns: ["fms_instance_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_instance_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_evidence_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_evidence_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_evidence_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_evidence_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_evidence_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_flows: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          branch_id: string | null
          created_at: string | null
          created_by: string
          department_id: string | null
          description: string | null
          family_id: string
          id: string
          is_active: boolean | null
          module_context: string | null
          name: string
          published_by: string | null
          scope_type: string
          status: Database["public"]["Enums"]["fms_flow_status"]
          tenant_id: string
          trigger_type: string | null
          updated_at: string | null
          updated_by: string | null
          usage_count: number
          version: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by: string
          department_id?: string | null
          description?: string | null
          family_id?: string
          id?: string
          is_active?: boolean | null
          module_context?: string | null
          name: string
          published_by?: string | null
          scope_type?: string
          status?: Database["public"]["Enums"]["fms_flow_status"]
          tenant_id: string
          trigger_type?: string | null
          updated_at?: string | null
          updated_by?: string | null
          usage_count?: number
          version?: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by?: string
          department_id?: string | null
          description?: string | null
          family_id?: string
          id?: string
          is_active?: boolean | null
          module_context?: string | null
          name?: string
          published_by?: string | null
          scope_type?: string
          status?: Database["public"]["Enums"]["fms_flow_status"]
          tenant_id?: string
          trigger_type?: string | null
          updated_at?: string | null
          updated_by?: string | null
          usage_count?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "fms_flows_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_flows_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_flows_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_flows_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_flows_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_flows_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_flows_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_instance_checklist_items: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          fms_instance_stage_id: string
          id: string
          is_completed: boolean
          is_required: boolean
          item_key: string
          label: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          fms_instance_stage_id: string
          id?: string
          is_completed?: boolean
          is_required?: boolean
          item_key: string
          label: string
          sort_order: number
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          fms_instance_stage_id?: string
          id?: string
          is_completed?: boolean
          is_required?: boolean
          item_key?: string
          label?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_instance_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_checklist_items_fms_instance_stage_id_fkey"
            columns: ["fms_instance_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_instance_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_checklist_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_instance_stage_assignees: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          claimed_at: string | null
          completed_at: string | null
          fms_instance_stage_id: string
          id: string
          is_active: boolean
          outcome: string | null
          remark: string | null
          status: string
          tenant_id: string
          user_profile_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          fms_instance_stage_id: string
          id?: string
          is_active?: boolean
          outcome?: string | null
          remark?: string | null
          status?: string
          tenant_id: string
          user_profile_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          claimed_at?: string | null
          completed_at?: string | null
          fms_instance_stage_id?: string
          id?: string
          is_active?: boolean
          outcome?: string | null
          remark?: string | null
          status?: string
          tenant_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_instance_stage_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stage_assignees_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stage_assignees_fms_instance_stage_id_fkey"
            columns: ["fms_instance_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_instance_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stage_assignees_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stage_assignees_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stage_assignees_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_instance_stages: {
        Row: {
          activated_at: string | null
          actual_datetime: string | null
          assigned_to: string[] | null
          branch_rule_id: string | null
          completed_by: string | null
          coverage_original_assignee_id: string | null
          coverage_resolution: string | null
          coverage_resolved_for_date: string | null
          coverage_status: string | null
          created_at: string | null
          delay_minutes: number | null
          escalation_count: number
          fms_instance_id: string
          fms_stage_id: string
          form_submission_id: string | null
          id: string
          last_escalated_at: string | null
          next_doer_ids: string[] | null
          outcome: string | null
          planned_datetime: string | null
          previous_instance_stage_id: string | null
          remark: string | null
          revision_of_id: string | null
          sla_breached: boolean | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string | null
        }
        Insert: {
          activated_at?: string | null
          actual_datetime?: string | null
          assigned_to?: string[] | null
          branch_rule_id?: string | null
          completed_by?: string | null
          coverage_original_assignee_id?: string | null
          coverage_resolution?: string | null
          coverage_resolved_for_date?: string | null
          coverage_status?: string | null
          created_at?: string | null
          delay_minutes?: number | null
          escalation_count?: number
          fms_instance_id: string
          fms_stage_id: string
          form_submission_id?: string | null
          id?: string
          last_escalated_at?: string | null
          next_doer_ids?: string[] | null
          outcome?: string | null
          planned_datetime?: string | null
          previous_instance_stage_id?: string | null
          remark?: string | null
          revision_of_id?: string | null
          sla_breached?: boolean | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string | null
        }
        Update: {
          activated_at?: string | null
          actual_datetime?: string | null
          assigned_to?: string[] | null
          branch_rule_id?: string | null
          completed_by?: string | null
          coverage_original_assignee_id?: string | null
          coverage_resolution?: string | null
          coverage_resolved_for_date?: string | null
          coverage_status?: string | null
          created_at?: string | null
          delay_minutes?: number | null
          escalation_count?: number
          fms_instance_id?: string
          fms_stage_id?: string
          form_submission_id?: string | null
          id?: string
          last_escalated_at?: string | null
          next_doer_ids?: string[] | null
          outcome?: string | null
          planned_datetime?: string | null
          previous_instance_stage_id?: string | null
          remark?: string | null
          revision_of_id?: string | null
          sla_breached?: boolean | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_instance_stages_branch_rule_id_fkey"
            columns: ["branch_rule_id"]
            isOneToOne: false
            referencedRelation: "fms_branch_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_coverage_original_assignee_id_fkey"
            columns: ["coverage_original_assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_coverage_original_assignee_id_fkey"
            columns: ["coverage_original_assignee_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_fms_instance_id_fkey"
            columns: ["fms_instance_id"]
            isOneToOne: false
            referencedRelation: "fms_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_fms_stage_id_fkey"
            columns: ["fms_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_form_submission_id_fkey"
            columns: ["form_submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_previous_instance_stage_id_fkey"
            columns: ["previous_instance_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_instance_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instance_stages_revision_of_id_fkey"
            columns: ["revision_of_id"]
            isOneToOne: false
            referencedRelation: "fms_instance_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_instances: {
        Row: {
          branch_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          completed_at: string | null
          context: Json
          created_at: string | null
          department_id: string | null
          flow_family_id: string
          flow_version: number
          fms_flow_id: string
          held_at: string | null
          held_by: string | null
          hold_reason: string | null
          id: string
          parent_instance_id: string | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          reference_number: string
          related_entity: string | null
          related_record_id: string | null
          started_at: string | null
          started_by: string
          status: Database["public"]["Enums"]["fms_instance_status"]
          tenant_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          context?: Json
          created_at?: string | null
          department_id?: string | null
          flow_family_id: string
          flow_version: number
          fms_flow_id: string
          held_at?: string | null
          held_by?: string | null
          hold_reason?: string | null
          id?: string
          parent_instance_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"] | null
          reference_number: string
          related_entity?: string | null
          related_record_id?: string | null
          started_at?: string | null
          started_by: string
          status?: Database["public"]["Enums"]["fms_instance_status"]
          tenant_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          completed_at?: string | null
          context?: Json
          created_at?: string | null
          department_id?: string | null
          flow_family_id?: string
          flow_version?: number
          fms_flow_id?: string
          held_at?: string | null
          held_by?: string | null
          hold_reason?: string | null
          id?: string
          parent_instance_id?: string | null
          priority?: Database["public"]["Enums"]["task_priority"] | null
          reference_number?: string
          related_entity?: string | null
          related_record_id?: string | null
          started_at?: string | null
          started_by?: string
          status?: Database["public"]["Enums"]["fms_instance_status"]
          tenant_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_instances_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_fms_flow_id_fkey"
            columns: ["fms_flow_id"]
            isOneToOne: false
            referencedRelation: "fms_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_held_by_fkey"
            columns: ["held_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_held_by_fkey"
            columns: ["held_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_parent_instance_id_fkey"
            columns: ["parent_instance_id"]
            isOneToOne: false
            referencedRelation: "fms_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_stage_assignees: {
        Row: {
          allow_next_selection: boolean
          assignee_type: string
          fallback_user_profile_id: string | null
          fms_stage_id: string
          id: string
          is_start_stage_entry_user: boolean | null
          role_value: Database["public"]["Enums"]["user_role"] | null
          sort_order: number
          user_profile_id: string | null
        }
        Insert: {
          allow_next_selection?: boolean
          assignee_type: string
          fallback_user_profile_id?: string | null
          fms_stage_id: string
          id?: string
          is_start_stage_entry_user?: boolean | null
          role_value?: Database["public"]["Enums"]["user_role"] | null
          sort_order?: number
          user_profile_id?: string | null
        }
        Update: {
          allow_next_selection?: boolean
          assignee_type?: string
          fallback_user_profile_id?: string | null
          fms_stage_id?: string
          id?: string
          is_start_stage_entry_user?: boolean | null
          role_value?: Database["public"]["Enums"]["user_role"] | null
          sort_order?: number
          user_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fms_stage_assignees_fallback_user_profile_id_fkey"
            columns: ["fallback_user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stage_assignees_fallback_user_profile_id_fkey"
            columns: ["fallback_user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stage_assignees_fms_stage_id_fkey"
            columns: ["fms_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stage_assignees_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stage_assignees_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_stage_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string | null
          details: Json | null
          fms_instance_stage_id: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string | null
          details?: Json | null
          fms_instance_stage_id: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string | null
          details?: Json | null
          fms_instance_stage_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_stage_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stage_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stage_logs_fms_instance_stage_id_fkey"
            columns: ["fms_instance_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_instance_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_stages: {
        Row: {
          allow_multiple_doers: boolean | null
          can_escalate: boolean | null
          can_move_backward: boolean | null
          can_reject: boolean | null
          can_request_revision: boolean | null
          canvas_position: Json | null
          checklist_definition: Json
          completion_rule:
            | Database["public"]["Enums"]["fms_completion_rule"]
            | null
          created_at: string | null
          default_next_stage_id: string | null
          fms_flow_id: string
          form_template_id: string | null
          id: string
          is_parallel_group: boolean | null
          is_required: boolean | null
          join_required_stage_ids: string[] | null
          join_rule: Database["public"]["Enums"]["fms_join_rule"] | null
          method: string | null
          name: string
          notification_config: Json
          parallel_group_key: string | null
          parallel_target_stage_ids: string[]
          planned_time_rule: Json
          requires_checklist: boolean | null
          requires_next_doer_handoff: boolean | null
          requires_remark: boolean | null
          requires_upload: boolean | null
          sort_order: number
          split_to_flow_id: string | null
          stage_key: string
          step_type: Database["public"]["Enums"]["fms_step_type"]
        }
        Insert: {
          allow_multiple_doers?: boolean | null
          can_escalate?: boolean | null
          can_move_backward?: boolean | null
          can_reject?: boolean | null
          can_request_revision?: boolean | null
          canvas_position?: Json | null
          checklist_definition?: Json
          completion_rule?:
            | Database["public"]["Enums"]["fms_completion_rule"]
            | null
          created_at?: string | null
          default_next_stage_id?: string | null
          fms_flow_id: string
          form_template_id?: string | null
          id?: string
          is_parallel_group?: boolean | null
          is_required?: boolean | null
          join_required_stage_ids?: string[] | null
          join_rule?: Database["public"]["Enums"]["fms_join_rule"] | null
          method?: string | null
          name: string
          notification_config?: Json
          parallel_group_key?: string | null
          parallel_target_stage_ids?: string[]
          planned_time_rule?: Json
          requires_checklist?: boolean | null
          requires_next_doer_handoff?: boolean | null
          requires_remark?: boolean | null
          requires_upload?: boolean | null
          sort_order: number
          split_to_flow_id?: string | null
          stage_key?: string
          step_type?: Database["public"]["Enums"]["fms_step_type"]
        }
        Update: {
          allow_multiple_doers?: boolean | null
          can_escalate?: boolean | null
          can_move_backward?: boolean | null
          can_reject?: boolean | null
          can_request_revision?: boolean | null
          canvas_position?: Json | null
          checklist_definition?: Json
          completion_rule?:
            | Database["public"]["Enums"]["fms_completion_rule"]
            | null
          created_at?: string | null
          default_next_stage_id?: string | null
          fms_flow_id?: string
          form_template_id?: string | null
          id?: string
          is_parallel_group?: boolean | null
          is_required?: boolean | null
          join_required_stage_ids?: string[] | null
          join_rule?: Database["public"]["Enums"]["fms_join_rule"] | null
          method?: string | null
          name?: string
          notification_config?: Json
          parallel_group_key?: string | null
          parallel_target_stage_ids?: string[]
          planned_time_rule?: Json
          requires_checklist?: boolean | null
          requires_next_doer_handoff?: boolean | null
          requires_remark?: boolean | null
          requires_upload?: boolean | null
          sort_order?: number
          split_to_flow_id?: string | null
          stage_key?: string
          step_type?: Database["public"]["Enums"]["fms_step_type"]
        }
        Relationships: [
          {
            foreignKeyName: "fms_stages_default_next_stage_id_fkey"
            columns: ["default_next_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stages_fms_flow_id_fkey"
            columns: ["fms_flow_id"]
            isOneToOne: false
            referencedRelation: "fms_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stages_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_stages_split_to_flow_id_fkey"
            columns: ["split_to_flow_id"]
            isOneToOne: false
            referencedRelation: "fms_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_starter_assignments: {
        Row: {
          assigned_by: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          fms_flow_id: string
          fms_stage_id: string
          form_template_id: string
          id: string
          status: string
          tenant_id: string
          user_profile_id: string
        }
        Insert: {
          assigned_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          fms_flow_id: string
          fms_stage_id: string
          form_template_id: string
          id?: string
          status?: string
          tenant_id: string
          user_profile_id: string
        }
        Update: {
          assigned_by?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          fms_flow_id?: string
          fms_stage_id?: string
          form_template_id?: string
          id?: string
          status?: string
          tenant_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_starter_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_fms_flow_id_fkey"
            columns: ["fms_flow_id"]
            isOneToOne: false
            referencedRelation: "fms_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_fms_stage_id_fkey"
            columns: ["fms_stage_id"]
            isOneToOne: false
            referencedRelation: "fms_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_starter_assignments_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      fms_workflow_mutation_keys: {
        Row: {
          actor_id: string
          completed_at: string | null
          created_at: string
          id: string
          linked_module: string
          linked_record_id: string
          mutation_key: string
          response: Json | null
          tenant_id: string
        }
        Insert: {
          actor_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          linked_module: string
          linked_record_id: string
          mutation_key: string
          response?: Json | null
          tenant_id: string
        }
        Update: {
          actor_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          linked_module?: string
          linked_record_id?: string
          mutation_key?: string
          response?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fms_workflow_mutation_keys_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_workflow_mutation_keys_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fms_workflow_mutation_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      form_fields: {
        Row: {
          branch_logic: Json | null
          conditional_logic: Json | null
          created_at: string | null
          dropdown_master_type: string | null
          dropdown_option_snapshot: Json | null
          field_key: string
          field_name: string
          field_type: string
          form_template_id: string
          group_name: string | null
          helper_text: string | null
          id: string
          initial_value: string | null
          is_editable: boolean
          is_required: boolean
          is_shown: boolean
          option_source: string | null
          options: Json | null
          placeholder: string | null
          rule_definition: Json | null
          sort_order: number
          updated_at: string
          validation: Json
        }
        Insert: {
          branch_logic?: Json | null
          conditional_logic?: Json | null
          created_at?: string | null
          dropdown_master_type?: string | null
          dropdown_option_snapshot?: Json | null
          field_key?: string
          field_name: string
          field_type: string
          form_template_id: string
          group_name?: string | null
          helper_text?: string | null
          id?: string
          initial_value?: string | null
          is_editable?: boolean
          is_required?: boolean
          is_shown?: boolean
          option_source?: string | null
          options?: Json | null
          placeholder?: string | null
          rule_definition?: Json | null
          sort_order?: number
          updated_at?: string
          validation?: Json
        }
        Update: {
          branch_logic?: Json | null
          conditional_logic?: Json | null
          created_at?: string | null
          dropdown_master_type?: string | null
          dropdown_option_snapshot?: Json | null
          field_key?: string
          field_name?: string
          field_type?: string
          form_template_id?: string
          group_name?: string | null
          helper_text?: string | null
          id?: string
          initial_value?: string | null
          is_editable?: boolean
          is_required?: boolean
          is_shown?: boolean
          option_source?: string | null
          options?: Json | null
          placeholder?: string | null
          rule_definition?: Json | null
          sort_order?: number
          updated_at?: string
          validation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_links: {
        Row: {
          created_at: string | null
          created_by: string | null
          form_template_id: string
          id: string
          linked_module: string
          linked_reference_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          form_template_id: string
          id?: string
          linked_module: string
          linked_reference_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          form_template_id?: string
          id?: string
          linked_module?: string
          linked_reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_links_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submission_files: {
        Row: {
          created_at: string
          field_key: string
          form_submission_id: string | null
          form_template_id: string
          id: string
          mime_type: string
          original_filename: string
          removed_at: string | null
          removed_by: string | null
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          field_key: string
          form_submission_id?: string | null
          form_template_id: string
          id?: string
          mime_type: string
          original_filename: string
          removed_at?: string | null
          removed_by?: string | null
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          field_key?: string
          form_submission_id?: string | null
          form_template_id?: string
          id?: string
          mime_type?: string
          original_filename?: string
          removed_at?: string | null
          removed_by?: string | null
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submission_files_form_submission_id_fkey"
            columns: ["form_submission_id"]
            isOneToOne: false
            referencedRelation: "form_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submission_files_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submission_files_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submission_files_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submission_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submission_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submission_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          branch_id: string | null
          data: Json
          department_id: string | null
          form_template_id: string | null
          id: string
          linked_module: string | null
          linked_record_id: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["form_submission_status"]
          submitted_at: string | null
          submitted_by: string | null
          template_snapshot: Json | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          data?: Json
          department_id?: string | null
          form_template_id?: string | null
          id?: string
          linked_module?: string | null
          linked_record_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["form_submission_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_snapshot?: Json | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          data?: Json
          department_id?: string | null
          form_template_id?: string | null
          id?: string
          linked_module?: string | null
          linked_record_id?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["form_submission_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          template_snapshot?: Json | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          branch_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          family_id: string
          id: string
          is_active: boolean | null
          lifecycle: Database["public"]["Enums"]["form_template_lifecycle"]
          name: string
          permissions: Json
          published_at: string | null
          published_by: string | null
          sections: Json
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          version: number
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          family_id?: string
          id?: string
          is_active?: boolean | null
          lifecycle?: Database["public"]["Enums"]["form_template_lifecycle"]
          name: string
          permissions?: Json
          published_at?: string | null
          published_by?: string | null
          sections?: Json
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          family_id?: string
          id?: string
          is_active?: boolean | null
          lifecycle?: Database["public"]["Enums"]["form_template_lifecycle"]
          name?: string
          permissions?: Json
          published_at?: string | null
          published_by?: string | null
          sections?: Json
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_templates_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempt_count: number
          backoff_minutes: number
          channel: string
          created_at: string
          delivered_at: string | null
          error_category: string | null
          event_id: string
          id: string
          lease_expires_at: string | null
          max_attempts: number
          next_attempt_at: string
          priority: Database["public"]["Enums"]["task_priority"]
          processing_started_at: string | null
          provider_identifier: string | null
          recipient_profile_id: string
          resolved_body: string
          resolved_link_url: string | null
          resolved_title: string
          rule_id: string
          scheduled_at: string
          state: string
          template_id: string
          tenant_id: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempt_count?: number
          backoff_minutes?: number
          channel: string
          created_at?: string
          delivered_at?: string | null
          error_category?: string | null
          event_id: string
          id?: string
          lease_expires_at?: string | null
          max_attempts?: number
          next_attempt_at?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          processing_started_at?: string | null
          provider_identifier?: string | null
          recipient_profile_id: string
          resolved_body: string
          resolved_link_url?: string | null
          resolved_title: string
          rule_id: string
          scheduled_at?: string
          state?: string
          template_id: string
          tenant_id: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempt_count?: number
          backoff_minutes?: number
          channel?: string
          created_at?: string
          delivered_at?: string | null
          error_category?: string | null
          event_id?: string
          id?: string
          lease_expires_at?: string | null
          max_attempts?: number
          next_attempt_at?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          processing_started_at?: string | null
          provider_identifier?: string | null
          recipient_profile_id?: string
          resolved_body?: string
          resolved_link_url?: string | null
          resolved_title?: string
          rule_id?: string
          scheduled_at?: string
          state?: string
          template_id?: string
          tenant_id?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          actor_profile_id: string | null
          branch_id: string | null
          created_at: string
          department_id: string | null
          error_category: string | null
          event_type: string
          id: string
          idempotency_key: string
          occurred_at: string
          payload: Json
          processed_at: string | null
          processing_started_at: string | null
          source_module: string
          source_record_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          actor_profile_id?: string | null
          branch_id?: string | null
          created_at?: string
          department_id?: string | null
          error_category?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
          processing_started_at?: string | null
          source_module: string
          source_record_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          actor_profile_id?: string | null
          branch_id?: string | null
          created_at?: string
          department_id?: string | null
          error_category?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
          processing_started_at?: string | null
          source_module?: string
          source_record_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          attempt_number: number | null
          channel: string
          created_at: string | null
          delivery_id: string | null
          error_category: string | null
          finished_at: string | null
          id: string
          notification_id: string | null
          provider_identifier: string | null
          provider_response: Json | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          attempt_number?: number | null
          channel: string
          created_at?: string | null
          delivery_id?: string | null
          error_category?: string | null
          finished_at?: string | null
          id?: string
          notification_id?: string | null
          provider_identifier?: string | null
          provider_response?: Json | null
          status: string
          tenant_id?: string | null
        }
        Update: {
          attempt_number?: number | null
          channel?: string
          created_at?: string | null
          delivery_id?: string | null
          error_category?: string | null
          finished_at?: string | null
          id?: string
          notification_id?: string | null
          provider_identifier?: string | null
          provider_response?: Json | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "notification_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_provider_configuration: {
        Row: {
          channel: string
          is_available: boolean
          provider_identifier: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          channel: string
          is_available?: boolean
          provider_identifier?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          is_available?: boolean
          provider_identifier?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_provider_configuration_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_rules: {
        Row: {
          backoff_minutes: number
          channel_templates: Json
          channels: string[] | null
          conditions: Json | null
          cooldown_minutes: number
          created_at: string
          created_by: string | null
          delay_minutes: number
          event_type: string
          id: string
          is_active: boolean | null
          lifecycle: string
          max_attempts: number
          name: string
          priority: Database["public"]["Enums"]["task_priority"]
          recipient_rules: Json
          template_id: string | null
          tenant_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          backoff_minutes?: number
          channel_templates?: Json
          channels?: string[] | null
          conditions?: Json | null
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          event_type: string
          id?: string
          is_active?: boolean | null
          lifecycle?: string
          max_attempts?: number
          name?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          recipient_rules?: Json
          template_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          backoff_minutes?: number
          channel_templates?: Json
          channels?: string[] | null
          conditions?: Json | null
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          delay_minutes?: number
          event_type?: string
          id?: string
          is_active?: boolean | null
          lifecycle?: string
          max_attempts?: number
          name?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          recipient_rules?: Json
          template_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body_template: string
          channel: string
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          is_active: boolean | null
          lifecycle: string
          link_url: string | null
          name: string
          tenant_id: string | null
          title_template: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body_template: string
          channel: string
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          is_active?: boolean | null
          lifecycle?: string
          link_url?: string | null
          name?: string
          tenant_id?: string | null
          title_template: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body_template?: string
          channel?: string
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          is_active?: boolean | null
          lifecycle?: string
          link_url?: string | null
          name?: string
          tenant_id?: string | null
          title_template?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          branch_id: string | null
          channel: string | null
          created_at: string | null
          delivered_at: string | null
          delivered_status: string | null
          delivery_id: string | null
          department_id: string | null
          event_type: string
          id: string
          is_read: boolean | null
          link_url: string | null
          message: string
          priority: Database["public"]["Enums"]["task_priority"]
          read_at: string | null
          retry_count: number | null
          source_module: string | null
          source_record_id: string | null
          tenant_id: string
          title: string
          user_profile_id: string
        }
        Insert: {
          branch_id?: string | null
          channel?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivered_status?: string | null
          delivery_id?: string | null
          department_id?: string | null
          event_type: string
          id?: string
          is_read?: boolean | null
          link_url?: string | null
          message: string
          priority?: Database["public"]["Enums"]["task_priority"]
          read_at?: string | null
          retry_count?: number | null
          source_module?: string | null
          source_record_id?: string | null
          tenant_id: string
          title: string
          user_profile_id: string
        }
        Update: {
          branch_id?: string | null
          channel?: string | null
          created_at?: string | null
          delivered_at?: string | null
          delivered_status?: string | null
          delivery_id?: string | null
          department_id?: string | null
          event_type?: string
          id?: string
          is_read?: boolean | null
          link_url?: string | null
          message?: string
          priority?: Database["public"]["Enums"]["task_priority"]
          read_at?: string | null
          retry_count?: number | null
          source_module?: string | null
          source_record_id?: string | null
          tenant_id?: string
          title?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: true
            referencedRelation: "notification_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_snapshots: {
        Row: {
          avg_delay_minutes: number | null
          branch_id: string | null
          created_at: string | null
          department_id: string | null
          id: string
          on_time_completed: number | null
          overdue_count: number | null
          period_end: string
          period_start: string
          tasks_assigned: number | null
          tasks_completed: number | null
          tenant_id: string
          user_profile_id: string | null
        }
        Insert: {
          avg_delay_minutes?: number | null
          branch_id?: string | null
          created_at?: string | null
          department_id?: string | null
          id?: string
          on_time_completed?: number | null
          overdue_count?: number | null
          period_end: string
          period_start: string
          tasks_assigned?: number | null
          tasks_completed?: number | null
          tenant_id: string
          user_profile_id?: string | null
        }
        Update: {
          avg_delay_minutes?: number | null
          branch_id?: string | null
          created_at?: string | null
          department_id?: string | null
          id?: string
          on_time_completed?: number | null
          overdue_count?: number | null
          period_end?: string
          period_start?: string
          tasks_assigned?: number | null
          tasks_completed?: number | null
          tenant_id?: string
          user_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_snapshots_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_snapshots_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_snapshots_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_snapshots_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      production_demo_data_retirements: {
        Row: {
          actor_profile_id: string
          backup_reference: string
          created_at: string
          executed_at: string | null
          expires_at: string
          id: string
          maintenance_acknowledged: boolean
          manifest: Json
          manifest_hash: string
          removed_counts: Json | null
          state: string
          tenant_id: string
        }
        Insert: {
          actor_profile_id: string
          backup_reference: string
          created_at?: string
          executed_at?: string | null
          expires_at: string
          id?: string
          maintenance_acknowledged?: boolean
          manifest: Json
          manifest_hash: string
          removed_counts?: Json | null
          state: string
          tenant_id: string
        }
        Update: {
          actor_profile_id?: string
          backup_reference?: string
          created_at?: string
          executed_at?: string | null
          expires_at?: string
          id?: string
          maintenance_acknowledged?: boolean
          manifest?: Json
          manifest_hash?: string
          removed_counts?: Json | null
          state?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_demo_data_retirements_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_demo_data_retirements_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_demo_data_retirements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      resignations: {
        Row: {
          company_assets_returned: boolean
          created_at: string | null
          created_by: string | null
          email_access_remove_date: string
          final_settlement_status: string | null
          handover_completed: boolean
          handover_given_to: string | null
          hr_remark: string | null
          id: string
          last_working_date: string
          manager_approval_status: string | null
          notice_period_served: boolean
          official_mobile_returned: boolean | null
          pending_tasks_reassigned: boolean
          replacement_buddy_id: string | null
          resignation_date: string
          resignation_reason_id: string | null
          super_admin_approval_status: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_profile_id: string
        }
        Insert: {
          company_assets_returned?: boolean
          created_at?: string | null
          created_by?: string | null
          email_access_remove_date: string
          final_settlement_status?: string | null
          handover_completed?: boolean
          handover_given_to?: string | null
          hr_remark?: string | null
          id?: string
          last_working_date: string
          manager_approval_status?: string | null
          notice_period_served: boolean
          official_mobile_returned?: boolean | null
          pending_tasks_reassigned?: boolean
          replacement_buddy_id?: string | null
          resignation_date: string
          resignation_reason_id?: string | null
          super_admin_approval_status?: string | null
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
          user_profile_id: string
        }
        Update: {
          company_assets_returned?: boolean
          created_at?: string | null
          created_by?: string | null
          email_access_remove_date?: string
          final_settlement_status?: string | null
          handover_completed?: boolean
          handover_given_to?: string | null
          hr_remark?: string | null
          id?: string
          last_working_date?: string
          manager_approval_status?: string | null
          notice_period_served?: boolean
          official_mobile_returned?: boolean | null
          pending_tasks_reassigned?: boolean
          replacement_buddy_id?: string | null
          resignation_date?: string
          resignation_reason_id?: string | null
          super_admin_approval_status?: string | null
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resignations_handover_given_to_fkey"
            columns: ["handover_given_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resignations_handover_given_to_fkey"
            columns: ["handover_given_to"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resignations_replacement_buddy_id_fkey"
            columns: ["replacement_buddy_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resignations_replacement_buddy_id_fkey"
            columns: ["replacement_buddy_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resignations_resignation_reason_id_fkey"
            columns: ["resignation_reason_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resignations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resignations_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resignations_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      settings_mutation_keys: {
        Row: {
          actor_id: string
          created_at: string
          operation: string
          request_key: string
          result: Json
          tenant_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          operation: string
          request_key: string
          result: Json
          tenant_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          operation?: string
          request_key?: string
          result?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_mutation_keys_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_mutation_keys_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_mutation_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          completed_at: string | null
          id: string
          is_active: boolean
          is_original: boolean | null
          role_at_task: string | null
          task_instance_id: string
          user_profile_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          is_active?: boolean
          is_original?: boolean | null
          role_at_task?: string | null
          task_instance_id: string
          user_profile_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          is_active?: boolean
          is_original?: boolean | null
          role_at_task?: string | null
          task_instance_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string | null
          file_url: string
          id: string
          task_instance_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          file_url: string
          id?: string
          task_instance_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          file_url?: string
          id?: string
          task_instance_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklists: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          id: string
          is_completed: boolean | null
          is_required: boolean | null
          item_text: string
          sort_order: number | null
          task_instance_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          id?: string
          is_completed?: boolean | null
          is_required?: boolean | null
          item_text: string
          sort_order?: number | null
          task_instance_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          id?: string
          is_completed?: boolean | null
          is_required?: boolean | null
          item_text?: string
          sort_order?: number | null
          task_instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklists_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklists_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklists_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          comment: string
          created_at: string | null
          id: string
          task_instance_id: string
          user_profile_id: string
        }
        Insert: {
          comment: string
          created_at?: string | null
          id?: string
          task_instance_id: string
          user_profile_id: string
        }
        Update: {
          comment?: string
          created_at?: string | null
          id?: string
          task_instance_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_import_batches: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          created_count: number
          error_count: number
          id: string
          import_hash: string
          initial_instance_count: number
          one_time_count: number
          outcome: string
          recurring_count: number
          rejected_count: number
          replayed_count: number
          requested_count: number
          safe_file_label: string | null
          source_headers: string[]
          tenant_id: string
          valid_count: number
          validated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          created_count?: number
          error_count?: number
          id?: string
          import_hash: string
          initial_instance_count?: number
          one_time_count?: number
          outcome?: string
          recurring_count?: number
          rejected_count?: number
          replayed_count?: number
          requested_count: number
          safe_file_label?: string | null
          source_headers: string[]
          tenant_id: string
          valid_count?: number
          validated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          created_count?: number
          error_count?: number
          id?: string
          import_hash?: string
          initial_instance_count?: number
          one_time_count?: number
          outcome?: string
          recurring_count?: number
          rejected_count?: number
          replayed_count?: number
          requested_count?: number
          safe_file_label?: string | null
          source_headers?: string[]
          tenant_id?: string
          valid_count?: number
          validated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_import_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_import_items: {
        Row: {
          batch_id: string
          created_at: string
          destination: string
          error_code: string | null
          id: string
          outcome: string
          row_hash: string
          source_row: number
          task_instance_id: string | null
          task_template_id: string | null
          tenant_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          destination: string
          error_code?: string | null
          id?: string
          outcome: string
          row_hash: string
          source_row: number
          task_instance_id?: string | null
          task_template_id?: string | null
          tenant_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          destination?: string
          error_code?: string | null
          id?: string
          outcome?: string
          row_hash?: string
          source_row?: number
          task_instance_id?: string | null
          task_template_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_import_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "task_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_import_items_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_import_items_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_import_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_import_row_registry: {
        Row: {
          business_fingerprint: string
          created_at: string
          first_batch_id: string
          id: string
          task_instance_id: string | null
          task_template_id: string | null
          tenant_id: string
        }
        Insert: {
          business_fingerprint: string
          created_at?: string
          first_batch_id: string
          id?: string
          task_instance_id?: string | null
          task_template_id?: string | null
          tenant_id: string
        }
        Update: {
          business_fingerprint?: string
          created_at?: string
          first_batch_id?: string
          id?: string
          task_instance_id?: string | null
          task_template_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_import_row_registry_first_batch_id_fkey"
            columns: ["first_batch_id"]
            isOneToOne: false
            referencedRelation: "task_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_import_row_registry_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_import_row_registry_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_import_row_registry_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_instances: {
        Row: {
          actual_datetime: string | null
          assignment_status: string
          branch_id: string | null
          buddy_assignment_allowed: boolean
          category_id: string | null
          completed_by: string | null
          completion_delay_minutes: number | null
          completion_mode: string | null
          completion_remark: string | null
          core_task_label: string | null
          coverage_original_assignee_id: string | null
          coverage_resolution: string | null
          coverage_resolved_for_date: string | null
          coverage_status: string | null
          created_at: string | null
          created_by: string
          delay_minutes: number | null
          department_id: string | null
          description: string | null
          due_datetime: string | null
          followup_count: number
          form_template_id: string | null
          id: string
          last_followup_at: string | null
          on_time_status: string | null
          planned_datetime: string
          priority: Database["public"]["Enums"]["task_priority"] | null
          requires_form: boolean
          requires_remark: boolean
          requires_upload: boolean
          revised_datetime: string | null
          scheduled_date: string | null
          source: string | null
          source_ref_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_template_id: string | null
          task_type: Database["public"]["Enums"]["task_type"]
          tenant_id: string
          title: string
          updated_at: string | null
          updated_by: string | null
          verification_note: string | null
          verification_status: string
          verified_at: string | null
          verified_by: string | null
          verifier_user_profile_id: string | null
        }
        Insert: {
          actual_datetime?: string | null
          assignment_status?: string
          branch_id?: string | null
          buddy_assignment_allowed?: boolean
          category_id?: string | null
          completed_by?: string | null
          completion_delay_minutes?: number | null
          completion_mode?: string | null
          completion_remark?: string | null
          core_task_label?: string | null
          coverage_original_assignee_id?: string | null
          coverage_resolution?: string | null
          coverage_resolved_for_date?: string | null
          coverage_status?: string | null
          created_at?: string | null
          created_by: string
          delay_minutes?: number | null
          department_id?: string | null
          description?: string | null
          due_datetime?: string | null
          followup_count?: number
          form_template_id?: string | null
          id?: string
          last_followup_at?: string | null
          on_time_status?: string | null
          planned_datetime: string
          priority?: Database["public"]["Enums"]["task_priority"] | null
          requires_form?: boolean
          requires_remark?: boolean
          requires_upload?: boolean
          revised_datetime?: string | null
          scheduled_date?: string | null
          source?: string | null
          source_ref_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_template_id?: string | null
          task_type: Database["public"]["Enums"]["task_type"]
          tenant_id: string
          title: string
          updated_at?: string | null
          updated_by?: string | null
          verification_note?: string | null
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          verifier_user_profile_id?: string | null
        }
        Update: {
          actual_datetime?: string | null
          assignment_status?: string
          branch_id?: string | null
          buddy_assignment_allowed?: boolean
          category_id?: string | null
          completed_by?: string | null
          completion_delay_minutes?: number | null
          completion_mode?: string | null
          completion_remark?: string | null
          core_task_label?: string | null
          coverage_original_assignee_id?: string | null
          coverage_resolution?: string | null
          coverage_resolved_for_date?: string | null
          coverage_status?: string | null
          created_at?: string | null
          created_by?: string
          delay_minutes?: number | null
          department_id?: string | null
          description?: string | null
          due_datetime?: string | null
          followup_count?: number
          form_template_id?: string | null
          id?: string
          last_followup_at?: string | null
          on_time_status?: string | null
          planned_datetime?: string
          priority?: Database["public"]["Enums"]["task_priority"] | null
          requires_form?: boolean
          requires_remark?: boolean
          requires_upload?: boolean
          revised_datetime?: string | null
          scheduled_date?: string | null
          source?: string | null
          source_ref_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_template_id?: string | null
          task_type?: Database["public"]["Enums"]["task_type"]
          tenant_id?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          verification_note?: string | null
          verification_status?: string
          verified_at?: string | null
          verified_by?: string | null
          verifier_user_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_instances_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_coverage_original_assignee_id_fkey"
            columns: ["coverage_original_assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_coverage_original_assignee_id_fkey"
            columns: ["coverage_original_assignee_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_task_template_id_fkey"
            columns: ["task_template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_verifier_user_profile_id_fkey"
            columns: ["verifier_user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_verifier_user_profile_id_fkey"
            columns: ["verifier_user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_revisions: {
        Row: {
          changed_by: string
          created_at: string | null
          id: string
          new_revised_datetime: string
          old_revised_datetime: string | null
          reason: string | null
          task_instance_id: string
        }
        Insert: {
          changed_by: string
          created_at?: string | null
          id?: string
          new_revised_datetime: string
          old_revised_datetime?: string | null
          reason?: string | null
          task_instance_id: string
        }
        Update: {
          changed_by?: string
          created_at?: string | null
          id?: string
          new_revised_datetime?: string
          old_revised_datetime?: string | null
          reason?: string | null
          task_instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_revisions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_revisions_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_revisions_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          assignment_status: string
          branch_id: string | null
          buddy_assignment_allowed: boolean
          category_id: string | null
          checklist_items: Json
          core_task_label: string | null
          created_at: string | null
          created_by: string | null
          default_assignee_role: Database["public"]["Enums"]["user_role"] | null
          default_assignee_type: string
          default_assignee_user_id: string | null
          department_id: string | null
          description: string | null
          due_time: string | null
          followup_enabled: boolean
          form_template_id: string | null
          id: string
          is_active: boolean | null
          personal_performance_enabled: boolean
          planned_time: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence_rule: string | null
          requires_form: boolean | null
          requires_remark: boolean | null
          requires_upload: boolean | null
          schedule_kind: string
          starts_on: string | null
          task_type: Database["public"]["Enums"]["task_type"]
          tenant_id: string
          title: string
          updated_at: string | null
          updated_by: string | null
          verification_required: boolean
          verifier_user_profile_id: string | null
        }
        Insert: {
          assignment_status?: string
          branch_id?: string | null
          buddy_assignment_allowed?: boolean
          category_id?: string | null
          checklist_items?: Json
          core_task_label?: string | null
          created_at?: string | null
          created_by?: string | null
          default_assignee_role?:
            | Database["public"]["Enums"]["user_role"]
            | null
          default_assignee_type?: string
          default_assignee_user_id?: string | null
          department_id?: string | null
          description?: string | null
          due_time?: string | null
          followup_enabled?: boolean
          form_template_id?: string | null
          id?: string
          is_active?: boolean | null
          personal_performance_enabled?: boolean
          planned_time?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_rule?: string | null
          requires_form?: boolean | null
          requires_remark?: boolean | null
          requires_upload?: boolean | null
          schedule_kind?: string
          starts_on?: string | null
          task_type?: Database["public"]["Enums"]["task_type"]
          tenant_id: string
          title: string
          updated_at?: string | null
          updated_by?: string | null
          verification_required?: boolean
          verifier_user_profile_id?: string | null
        }
        Update: {
          assignment_status?: string
          branch_id?: string | null
          buddy_assignment_allowed?: boolean
          category_id?: string | null
          checklist_items?: Json
          core_task_label?: string | null
          created_at?: string | null
          created_by?: string | null
          default_assignee_role?:
            | Database["public"]["Enums"]["user_role"]
            | null
          default_assignee_type?: string
          default_assignee_user_id?: string | null
          department_id?: string | null
          description?: string | null
          due_time?: string | null
          followup_enabled?: boolean
          form_template_id?: string | null
          id?: string
          is_active?: boolean | null
          personal_performance_enabled?: boolean
          planned_time?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence_rule?: string | null
          requires_form?: boolean | null
          requires_remark?: boolean | null
          requires_upload?: boolean | null
          schedule_kind?: string
          starts_on?: string | null
          task_type?: Database["public"]["Enums"]["task_type"]
          tenant_id?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          verification_required?: boolean
          verifier_user_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_default_assignee_user_id_fkey"
            columns: ["default_assignee_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_default_assignee_user_id_fkey"
            columns: ["default_assignee_user_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_form_template_id_fkey"
            columns: ["form_template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_verifier_user_profile_id_fkey"
            columns: ["verifier_user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_verifier_user_profile_id_fkey"
            columns: ["verifier_user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_watchers: {
        Row: {
          created_at: string
          created_by: string
          id: string
          task_instance_id: string
          tenant_id: string
          user_profile_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          task_instance_id: string
          tenant_id: string
          user_profile_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          task_instance_id?: string
          tenant_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_watchers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_task_instance_id_fkey"
            columns: ["task_instance_id"]
            isOneToOne: false
            referencedRelation: "task_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_realtime_events: {
        Row: {
          id: number
          occurred_at: string
          tenant_id: string
          topic: string
        }
        Insert: {
          id?: never
          occurred_at?: string
          tenant_id: string
          topic: string
        }
        Update: {
          id?: never
          occurred_at?: string
          tenant_id?: string
          topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_realtime_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_section_controls: {
        Row: {
          created_at: string
          developer_mode_enabled: boolean
          section_availability: Json
          settings_version: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          developer_mode_enabled?: boolean
          section_availability?: Json
          settings_version?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          developer_mode_enabled?: boolean
          section_availability?: Json
          settings_version?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_section_controls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_section_controls_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_section_controls_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string | null
          currency: string | null
          export_max_rows: number
          export_retention_days: number
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          settings: Json
          settings_version: number
          slug: string
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          export_max_rows?: number
          export_retention_days?: number
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          settings?: Json
          settings_version?: number
          slug: string
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          export_max_rows?: number
          export_retention_days?: number
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          settings?: Json
          settings_version?: number
          slug?: string
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_availability: {
        Row: {
          created_at: string | null
          date: string
          id: string
          logged_by: string | null
          reason: string | null
          source: string
          status: Database["public"]["Enums"]["availability_status"]
          tenant_id: string
          user_profile_id: string
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          logged_by?: string | null
          reason?: string | null
          source?: string
          status: Database["public"]["Enums"]["availability_status"]
          tenant_id: string
          user_profile_id: string
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          logged_by?: string | null
          reason?: string | null
          source?: string
          status?: Database["public"]["Enums"]["availability_status"]
          tenant_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_availability_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_availability_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_availability_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_availability_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_availability_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organization_history: {
        Row: {
          changed_by: string
          created_at: string
          effective_from: string
          id: string
          new_branch_id: string | null
          new_department_id: string | null
          new_designation_id: string | null
          new_reports_to_user_id: string | null
          old_branch_id: string | null
          old_department_id: string | null
          old_designation_id: string | null
          old_reports_to_user_id: string | null
          reason: string | null
          tenant_id: string
          user_profile_id: string
        }
        Insert: {
          changed_by: string
          created_at?: string
          effective_from?: string
          id?: string
          new_branch_id?: string | null
          new_department_id?: string | null
          new_designation_id?: string | null
          new_reports_to_user_id?: string | null
          old_branch_id?: string | null
          old_department_id?: string | null
          old_designation_id?: string | null
          old_reports_to_user_id?: string | null
          reason?: string | null
          tenant_id: string
          user_profile_id: string
        }
        Update: {
          changed_by?: string
          created_at?: string
          effective_from?: string
          id?: string
          new_branch_id?: string | null
          new_department_id?: string | null
          new_designation_id?: string | null
          new_reports_to_user_id?: string | null
          old_branch_id?: string | null
          old_department_id?: string | null
          old_designation_id?: string | null
          old_reports_to_user_id?: string | null
          reason?: string | null
          tenant_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organization_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_new_branch_id_fkey"
            columns: ["new_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_new_department_id_fkey"
            columns: ["new_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_new_designation_id_fkey"
            columns: ["new_designation_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_new_reports_to_user_id_fkey"
            columns: ["new_reports_to_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_new_reports_to_user_id_fkey"
            columns: ["new_reports_to_user_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_old_branch_id_fkey"
            columns: ["old_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_old_department_id_fkey"
            columns: ["old_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_old_designation_id_fkey"
            columns: ["old_designation_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_old_reports_to_user_id_fkey"
            columns: ["old_reports_to_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_old_reports_to_user_id_fkey"
            columns: ["old_reports_to_user_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organization_history_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          created_at: string
          id: string
          preferences: Json
          record_version: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preferences?: Json
          record_version?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          user_profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preferences?: Json
          record_version?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: true
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id: string
          designation_id?: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name?: string | null
          id?: string
          is_login_enabled?: boolean | null
          last_name?: string | null
          official_email?: string | null
          official_mobile?: string | null
          personal_email?: string | null
          personal_mobile?: string | null
          reports_to_user_id?: string | null
          secondary_buddy_id?: string | null
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
          user_role?: Database["public"]["Enums"]["user_role"]
          username?: string | null
          week_off?: string[]
          working_status?: Database["public"]["Enums"]["working_status"]
        }
        Update: {
          account_status?: Database["public"]["Enums"]["user_account_status"]
          auth_user_id?: string
          branch_id?: string
          buddy_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string
          designation_id?: string | null
          email?: string
          employee_code?: string
          employee_name?: string
          first_name?: string | null
          id?: string
          is_login_enabled?: boolean | null
          last_name?: string | null
          official_email?: string | null
          official_mobile?: string | null
          personal_email?: string | null
          personal_mobile?: string | null
          reports_to_user_id?: string | null
          secondary_buddy_id?: string | null
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
          user_role?: Database["public"]["Enums"]["user_role"]
          username?: string | null
          week_off?: string[]
          working_status?: Database["public"]["Enums"]["working_status"]
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_buddy_id_fkey"
            columns: ["buddy_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_buddy_id_fkey"
            columns: ["buddy_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reports_to_user_id_fkey"
            columns: ["reports_to_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reports_to_user_id_fkey"
            columns: ["reports_to_user_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_secondary_buddy_id_fkey"
            columns: ["secondary_buddy_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_secondary_buddy_id_fkey"
            columns: ["secondary_buddy_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      username_login_rate_limits: {
        Row: {
          attempts: number
          blocked_until: string | null
          rate_limit_key: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          attempts?: number
          blocked_until?: string | null
          rate_limit_key: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          attempts?: number
          blocked_until?: string | null
          rate_limit_key?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      walkin_entries: {
        Row: {
          branch_id: string
          buy_status: string | null
          buy_status_id: string | null
          client_id: string
          client_type_id: string | null
          companions: number | null
          created_at: string | null
          created_by: string | null
          crm_id: string | null
          followup_id: string | null
          google_review_asked: boolean | null
          id: string
          instagram_asked: boolean | null
          next_visit_date: string | null
          not_bought_reason: string | null
          not_bought_reason_id: string | null
          potential_category: string | null
          potential_category_id: string | null
          product_bought: boolean | null
          product_categories: string[] | null
          product_category_ids: string[]
          product_requirement: string | null
          referral_asked: boolean | null
          remark: string | null
          request_key: string | null
          salesperson_id: string | null
          tenant_id: string
          updated_at: string
          visit_date: string
        }
        Insert: {
          branch_id: string
          buy_status?: string | null
          buy_status_id?: string | null
          client_id: string
          client_type_id?: string | null
          companions?: number | null
          created_at?: string | null
          created_by?: string | null
          crm_id?: string | null
          followup_id?: string | null
          google_review_asked?: boolean | null
          id?: string
          instagram_asked?: boolean | null
          next_visit_date?: string | null
          not_bought_reason?: string | null
          not_bought_reason_id?: string | null
          potential_category?: string | null
          potential_category_id?: string | null
          product_bought?: boolean | null
          product_categories?: string[] | null
          product_category_ids?: string[]
          product_requirement?: string | null
          referral_asked?: boolean | null
          remark?: string | null
          request_key?: string | null
          salesperson_id?: string | null
          tenant_id: string
          updated_at?: string
          visit_date?: string
        }
        Update: {
          branch_id?: string
          buy_status?: string | null
          buy_status_id?: string | null
          client_id?: string
          client_type_id?: string | null
          companions?: number | null
          created_at?: string | null
          created_by?: string | null
          crm_id?: string | null
          followup_id?: string | null
          google_review_asked?: boolean | null
          id?: string
          instagram_asked?: boolean | null
          next_visit_date?: string | null
          not_bought_reason?: string | null
          not_bought_reason_id?: string | null
          potential_category?: string | null
          potential_category_id?: string | null
          product_bought?: boolean | null
          product_categories?: string[] | null
          product_category_ids?: string[]
          product_requirement?: string | null
          referral_asked?: boolean | null
          remark?: string | null
          request_key?: string | null
          salesperson_id?: string | null
          tenant_id?: string
          updated_at?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "walkin_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_buy_status_id_fkey"
            columns: ["buy_status_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_client_type_id_fkey"
            columns: ["client_type_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_crm_id_fkey"
            columns: ["crm_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_crm_id_fkey"
            columns: ["crm_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_not_bought_reason_id_fkey"
            columns: ["not_bought_reason_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_potential_category_id_fkey"
            columns: ["potential_category_id"]
            isOneToOne: false
            referencedRelation: "dropdown_masters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_followup_fk"
            columns: ["followup_id"]
            isOneToOne: false
            referencedRelation: "client_followups"
            referencedColumns: ["id"]
          },
        ]
      }
      walkin_uploads: {
        Row: {
          created_at: string | null
          id: string
          mime_type: string | null
          original_filename: string | null
          removed_at: string | null
          removed_by: string | null
          size_bytes: number | null
          storage_path: string
          tenant_id: string
          uploaded_by: string | null
          walkin_entry_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          removed_at?: string | null
          removed_by?: string | null
          size_bytes?: number | null
          storage_path: string
          tenant_id: string
          uploaded_by?: string | null
          walkin_entry_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          mime_type?: string | null
          original_filename?: string | null
          removed_at?: string | null
          removed_by?: string | null
          size_bytes?: number | null
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string | null
          walkin_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "walkin_uploads_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_uploads_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_uploads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_uploads_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_uploads_walkin_entry_id_fkey"
            columns: ["walkin_entry_id"]
            isOneToOne: false
            referencedRelation: "walkin_entries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_all_tasks: {
        Row: {
          actual_datetime: string | null
          assignee_id: string | null
          branch_id: string | null
          category_id: string | null
          checklist_completion_pct: number | null
          core_task_label: string | null
          created_by: string | null
          delay_minutes: number | null
          department_id: string | null
          description: string | null
          due_datetime: string | null
          form_template_id: string | null
          id: string | null
          planned_datetime: string | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          requires_form: boolean | null
          requires_remark: boolean | null
          requires_upload: boolean | null
          revised_datetime: string | null
          source: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_template_id: string | null
          task_type: Database["public"]["Enums"]["task_type"] | null
          tenant_id: string | null
          title: string | null
          verifier_user_profile_id: string | null
        }
        Relationships: []
      }
      v_task_users: {
        Row: {
          branch_id: string | null
          buddy_id: string | null
          department_id: string | null
          employee_code: string | null
          employee_name: string | null
          id: string | null
          tenant_id: string | null
          user_role: Database["public"]["Enums"]["user_role"] | null
          working_status: Database["public"]["Enums"]["working_status"] | null
        }
        Insert: {
          branch_id?: string | null
          buddy_id?: string | null
          department_id?: string | null
          employee_code?: string | null
          employee_name?: string | null
          id?: string | null
          tenant_id?: string | null
          user_role?: Database["public"]["Enums"]["user_role"] | null
          working_status?: Database["public"]["Enums"]["working_status"] | null
        }
        Update: {
          branch_id?: string | null
          buddy_id?: string | null
          department_id?: string | null
          employee_code?: string | null
          employee_name?: string | null
          id?: string | null
          tenant_id?: string | null
          user_role?: Database["public"]["Enums"]["user_role"] | null
          working_status?: Database["public"]["Enums"]["working_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_buddy_id_fkey"
            columns: ["buddy_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_buddy_id_fkey"
            columns: ["buddy_id"]
            isOneToOne: false
            referencedRelation: "v_task_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      acknowledge_daily_checklist_with_audit: {
        Args: {
          p_checked_item_ids: string[]
          p_checklist_id: string
          p_revision: number
        }
        Returns: Json
      }
      activate_fms_stage_internal: {
        Args: {
          p_guard?: number
          p_instance_id: string
          p_previous_instance_stage_id: string
          p_selected_user?: string
          p_stage_id: string
        }
        Returns: string
      }
      add_task_attachment_with_audit: {
        Args: { p_file_url: string; p_task_id: string }
        Returns: string
      }
      apply_authoritative_admin_roles: {
        Args: { p_profile_ids: string[] }
        Returns: number
      }
      apply_authoritative_production_roster: {
        Args: { p_retire_profile_ids?: string[]; p_roster: Json }
        Returns: number
      }
      apply_complete_authoritative_roster: {
        Args: { p_roster: Json }
        Returns: number
      }
      apply_work_identity_with_audit: {
        Args: { p_identities: Json }
        Returns: number
      }
      archive_fms_flow_with_audit: {
        Args: { p_flow_id: string; p_reason?: string }
        Returns: undefined
      }
      archive_form_with_audit: {
        Args: { p_template_id: string }
        Returns: string
      }
      archive_notification_rule: {
        Args: { p_rule_id: string }
        Returns: undefined
      }
      archive_notification_template: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      assert_active_crm_dropdown: {
        Args: {
          p_id: string
          p_required?: boolean
          p_tenant: string
          p_type: string
        }
        Returns: string
      }
      assert_crm_actor: {
        Args: never
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_crm_branch_user: {
        Args: {
          p_branch_id: string
          p_purpose: string
          p_tenant_id: string
          p_user_id: string
        }
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_crm_sync_worker: {
        Args: { p_assertion: Json; p_scope_key: string; p_source_key: string }
        Returns: {
          source_system_id: string
          tenant_id: string
          worker_assertion_id: string
        }[]
      }
      assert_direct_assignment_user: {
        Args: { p_purpose: string; p_tenant_id: string; p_user_id: string }
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_fms_flow_publishable: {
        Args: { p_flow_id: string }
        Returns: undefined
      }
      assert_form_publishable: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      assert_json_keys: {
        Args: { p_allowed: string[]; p_label: string; p_value: Json }
        Returns: undefined
      }
      assert_notification_admin: {
        Args: never
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assert_reporting_actor: {
        Args: never
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assign_imported_task_with_audit: {
        Args: {
          p_record_id: string
          p_record_kind: string
          p_user_profile_id: string
        }
        Returns: Json
      }
      assign_imported_task_with_audit_v0104: {
        Args: {
          p_record_id: string
          p_record_kind: string
          p_user_profile_id: string
        }
        Returns: Json
      }
      audit_super_admin_password_reset: {
        Args: { p_actor_auth_user_id: string; p_target_profile_id: string }
        Returns: undefined
      }
      authorize_super_admin_password_reset: {
        Args: { p_actor_auth_user_id: string; p_target_profile_id: string }
        Returns: string
      }
      begin_crm_sync_run: {
        Args: {
          p_request_key: string
          p_scope_key: string
          p_source_key: string
          p_worker_assertion: Json
        }
        Returns: Json
      }
      begin_task_bulk_import: {
        Args: {
          p_file_label: string
          p_import_hash: string
          p_requested_count: number
        }
        Returns: Json
      }
      bootstrap_initial_production_super_admin: {
        Args: { p_target_profile_id: string }
        Returns: undefined
      }
      can_access_form_template: {
        Args: { p_template_id: string }
        Returns: boolean
      }
      can_delete_crm_document_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_delete_unrecorded_task_attachment_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_manage_fms_flow: { Args: { p_flow_id?: string }; Returns: boolean }
      can_manage_form_template: {
        Args: { p_template_id: string }
        Returns: boolean
      }
      can_read_crm_client: { Args: { p_client_id: string }; Returns: boolean }
      can_read_crm_document_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_read_fms_evidence_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_read_fms_instance: {
        Args: { p_instance_id: string }
        Returns: boolean
      }
      can_read_form_submission: {
        Args: { p_submission_id: string }
        Returns: boolean
      }
      can_read_form_upload_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_read_report_export_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_read_task: { Args: { p_task_id: string }; Returns: boolean }
      can_read_task_attachment_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_start_fms_flow: {
        Args: {
          p_branch_id: string
          p_department_id: string
          p_flow_id: string
        }
        Returns: boolean
      }
      can_write_crm_document_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_write_fms_evidence_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_write_form_upload_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_write_task_attachment_object: {
        Args: { p_name: string }
        Returns: boolean
      }
      cancel_crm_followup: {
        Args: {
          p_expected_version: number
          p_followup_id: string
          p_reason: string
          p_request_key: string
        }
        Returns: number
      }
      cancel_fms_instance_with_audit: {
        Args: { p_instance_id: string; p_reason: string }
        Returns: undefined
      }
      cancel_report_export_with_audit: {
        Args: { p_export_id: string; p_request_key: string }
        Returns: {
          attempt_count: number
          cancelled_at: string | null
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          cleaned_at: string | null
          completed_at: string | null
          expires_at: string | null
          failed_at: string | null
          filter_snapshot: Json | null
          format: string
          id: string
          max_attempts: number
          object_path: string | null
          progress_percent: number
          report_key: string
          request_key: string
          requested_at: string
          requester_role: Database["public"]["Enums"]["user_role"]
          row_count: number | null
          sanitized_error: string | null
          scope_snapshot: Json
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_profile_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "export_logs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_task_bulk_import: { Args: { p_batch_id: string }; Returns: Json }
      change_dropdown_category_with_audit: {
        Args: {
          p_category_id?: string
          p_description?: string
          p_display_name?: string
          p_is_active?: boolean
          p_key?: string
          p_operation: string
          p_sort_order?: number
        }
        Returns: {
          category_key: string
          created_at: string
          created_by: string | null
          description: string | null
          display_name: string
          id: string
          is_active: boolean
          is_key_locked: boolean
          is_system: boolean
          sort_order: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "dropdown_master_categories"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      change_dropdown_with_audit: {
        Args: {
          p_is_active?: boolean
          p_label?: string
          p_master_type?: string
          p_operation: string
          p_record_id?: string
          p_sort_order?: number
          p_value?: string
        }
        Returns: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          label: string
          master_type: string
          sort_order: number | null
          tenant_id: string | null
          updated_at: string | null
          updated_by: string | null
          value: string
        }
        SetofOptions: {
          from: "*"
          to: "dropdown_masters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_fms_stage_with_audit: {
        Args: { p_instance_stage_id: string }
        Returns: undefined
      }
      claim_notification_deliveries: {
        Args: {
          p_lease_minutes?: number
          p_limit?: number
          p_worker_id?: string
        }
        Returns: {
          attempt_number: number
          channel: string
          id: string
          max_attempts: number
        }[]
      }
      claim_report_export_cleanup: {
        Args: { p_limit: number }
        Returns: {
          id: string
          object_path: string
        }[]
      }
      claim_report_exports: {
        Args: { p_lease_minutes?: number; p_limit: number; p_worker_id: string }
        Returns: {
          attempt_number: number
          filter_snapshot: Json
          id: string
          max_rows: number
          report_key: string
          tenant_id: string
          user_profile_id: string
        }[]
      }
      client_in_reporting_scope: {
        Args: {
          p_actor: Database["public"]["Tables"]["user_profiles"]["Row"]
          p_client_id: string
          p_context: Json
        }
        Returns: boolean
      }
      commit_task_bulk_import_chunk: {
        Args: { p_batch_id: string; p_rows: Json }
        Returns: Json
      }
      commit_task_bulk_import_chunk_v0104: {
        Args: { p_batch_id: string; p_rows: Json }
        Returns: Json
      }
      complete_crm_followup: {
        Args: {
          p_expected_version: number
          p_followup_id: string
          p_outcome: string
          p_request_key: string
        }
        Returns: number
      }
      complete_fms_stage_with_audit: {
        Args: {
          p_checklist?: Json
          p_instance_stage_id: string
          p_next_assignee_id?: string
          p_outcome?: string
          p_remark?: string
        }
        Returns: undefined
      }
      complete_recurring_task_with_image_with_audit: {
        Args: { p_file_url: string; p_task_id: string }
        Returns: undefined
      }
      configure_invited_profile_coverage_with_audit: {
        Args: {
          p_creator_profile_id: string
          p_profile_id: string
          p_reports_to_user_id: string
          p_secondary_buddy_id: string
        }
        Returns: undefined
      }
      consume_username_login_rate_limit: {
        Args: { p_rate_limit_key: string }
        Returns: boolean
      }
      correct_crm_interaction: {
        Args: {
          p_correction: Json
          p_interaction_id: string
          p_request_key: string
        }
        Returns: string
      }
      create_crm_client: {
        Args: { p_input: Json; p_request_key: string }
        Returns: string
      }
      create_crm_field_definition: {
        Args: {
          p_entity_type: string
          p_field_key: string
          p_field_type: string
          p_label: string
          p_options?: Json
          p_required?: boolean
          p_validation?: Json
        }
        Returns: string
      }
      create_crm_followup: {
        Args: { p_client_id: string; p_input: Json; p_request_key: string }
        Returns: string
      }
      create_delegation_task_with_audit: {
        Args: {
          p_checklist?: Json
          p_doer_ids: string[]
          p_payload: Json
          p_watcher_ids?: string[]
        }
        Returns: string
      }
      create_dropdown_list_with_audit: {
        Args: { p_master_type: string; p_options: Json }
        Returns: string
      }
      create_fms_revision_with_audit: {
        Args: { p_flow_id: string }
        Returns: string
      }
      create_form_revision_with_audit: {
        Args: { p_payload?: Json; p_source_template_id: string }
        Returns: string
      }
      create_recurring_task_instance: {
        Args: {
          p_assignments: Json
          p_target_date: string
          p_template_id: string
        }
        Returns: string
      }
      create_recurring_todo_instance: {
        Args: {
          p_original_assignee_ids: string[]
          p_target_date: string
          p_template_id: string
        }
        Returns: string
      }
      create_user_profile_with_coverage_and_audit: {
        Args: {
          p_auth_user_id: string
          p_branch_id: string
          p_buddy_id: string
          p_creator_profile_id: string
          p_department_id: string
          p_designation_id: string
          p_first_name: string
          p_last_name: string
          p_official_email: string
          p_official_mobile: string
          p_personal_email: string
          p_personal_mobile: string
          p_reports_to_user_id: string
          p_secondary_buddy_id: string
          p_user_role: Database["public"]["Enums"]["user_role"]
          p_week_off: string[]
        }
        Returns: string
      }
      crm_sync_record_operation: {
        Args: {
          p_assertion_id: string
          p_fingerprint: string
          p_operation: string
          p_request_key: string
          p_response: Json
          p_run_id: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      crm_sync_replay_operation: {
        Args: {
          p_assertion_id: string
          p_fingerprint: string
          p_operation: string
          p_request_key: string
          p_run_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      crm_sync_request_fingerprint: {
        Args: { p_operation: string; p_payload: Json }
        Returns: string
      }
      current_branch_id: { Args: never; Returns: string }
      current_profile: {
        Args: never
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_profile_is_active: { Args: never; Returns: boolean }
      current_role_level: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_tenant_id: { Args: never; Returns: string }
      default_section_availability: { Args: never; Returns: Json }
      delegate_task_with_audit: {
        Args: {
          p_from_user_id: string
          p_reason: string
          p_task_id: string
          p_to_user_id: string
        }
        Returns: undefined
      }
      delete_fms_flow_with_audit: {
        Args: { p_flow_id: string; p_reason?: string }
        Returns: undefined
      }
      delete_form_draft_with_audit: {
        Args: { p_template_id: string }
        Returns: string
      }
      delete_form_with_audit: { Args: { p_template_id: string }; Returns: Json }
      delete_recurring_todo_template_with_audit: {
        Args: { p_template_id: string }
        Returns: string
      }
      delete_task_template_with_audit: {
        Args: { p_template_id: string }
        Returns: Json
      }
      detect_crm_followup_events: {
        Args: { p_limit?: number; p_now?: string }
        Returns: {
          due_events: number
          overdue_events: number
        }[]
      }
      detect_scheduled_notification_events: {
        Args: { p_limit?: number; p_now?: string }
        Returns: {
          fms_sla_events: number
          task_overdue_events: number
        }[]
      }
      duplicate_form_with_audit: {
        Args: { p_name?: string; p_source_template_id: string }
        Returns: string
      }
      emit_tenant_realtime_event: {
        Args: { p_tenant_id: string; p_topic: string }
        Returns: undefined
      }
      enqueue_notification_event: {
        Args: {
          p_actor_profile_id: string
          p_branch_id: string
          p_department_id: string
          p_event_type: string
          p_idempotency_key: string
          p_occurred_at?: string
          p_payload: Json
          p_source_module: string
          p_source_record_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      enrich_legacy_crm_timeline_visit_form: {
        Args: {
          p_external_id: string
          p_payload: Json
          p_source_checksum: string
          p_source_key: string
        }
        Returns: string
      }
      escalate_fms_stage_with_audit: {
        Args: { p_instance_stage_id: string; p_reason: string }
        Returns: undefined
      }
      execute_production_demo_data_retirement: {
        Args: {
          p_actor_auth_user_id: string
          p_confirmation: string
          p_manifest_hash: string
          p_operation_id: string
        }
        Returns: Json
      }
      fail_crm_sync_run: {
        Args: {
          p_request_key: string
          p_run_id: string
          p_safe_error_code: string
          p_worker_assertion: Json
        }
        Returns: Json
      }
      finalize_crm_sync_run: {
        Args: {
          p_checkpoint: Json
          p_request_key: string
          p_run_id: string
          p_worker_assertion: Json
        }
        Returns: Json
      }
      finish_notification_delivery: {
        Args: {
          p_delivery_id: string
          p_error_category?: string
          p_outcome: string
          p_provider_identifier?: string
          p_retryable?: boolean
        }
        Returns: string
      }
      finish_report_export: {
        Args: {
          p_error_code?: string
          p_export_id: string
          p_object_path?: string
          p_outcome: string
          p_row_count?: number
          p_worker_id: string
        }
        Returns: string
      }
      fms_rule_matches: {
        Args: { p_actual: Json; p_expected: string; p_operator: string }
        Returns: boolean
      }
      fms_stage_deadline: {
        Args: { p_rule: Json; p_tenant_id: string }
        Returns: string
      }
      fms_stage_route_target: {
        Args: {
          p_instance_id: string
          p_instance_stage_id: string
          p_outcome: string
          p_stage_id: string
        }
        Returns: string
      }
      fms_stage_deadline_for_instance: {
        Args: { p_instance_id: string; p_rule: Json; p_tenant_id: string }
        Returns: string
      }
      fms_stage_in_reporting_scope: {
        Args: {
          p_actor: Database["public"]["Tables"]["user_profiles"]["Row"]
          p_context: Json
          p_stage_id: string
        }
        Returns: boolean
      }
      fms_status_condition_matches: {
        Args: { p_actual: string; p_expected: string; p_operator: string }
        Returns: boolean
      }
      form_answer_is_empty: { Args: { p_value: Json }; Returns: boolean }
      form_compare_values: {
        Args: { p_left: Json; p_right: Json }
        Returns: number
      }
      form_condition_matches: {
        Args: { p_answers: Json; p_condition: Json }
        Returns: boolean
      }
      form_deletion_impact: { Args: { p_template_id: string }; Returns: Json }
      form_field_option_values: {
        Args: { p_master_type: string; p_options: Json; p_tenant_id: string }
        Returns: Json
      }
      form_field_section_key: {
        Args: { p_group_name: string; p_sections: Json }
        Returns: string
      }
      form_option_values: { Args: { p_options: Json }; Returns: Json }
      form_reachable_sections: {
        Args: { p_answers: Json; p_template_id: string }
        Returns: string[]
      }
      form_value_contains: {
        Args: { p_expected: Json; p_source: Json }
        Returns: boolean
      }
      form_value_in: {
        Args: { p_expected: Json; p_source: Json }
        Returns: boolean
      }
      get_crm_client_detail: { Args: { p_client_id: string }; Returns: Json }
      get_crm_document_path: {
        Args: { p_document_id: string }
        Returns: string
      }
      get_crm_sync_checkpoint: {
        Args: {
          p_scope_key: string
          p_source_key: string
          p_worker_assertion: Json
        }
        Returns: Json
      }
      get_dashboard_metrics: { Args: { p_context?: Json }; Returns: Json }
      get_form_upload_path: { Args: { p_file_id: string }; Returns: string }
      get_home_summary: { Args: { p_context?: Json }; Returns: Json }
      get_my_daily_checklist_status: { Args: never; Returns: Json }
      get_my_fms_starter_assignments: {
        Args: never
        Returns: {
          assigned_at: string
          flow_name: string
          fms_flow_id: string
          form_template_id: string
          id: string
          stage_name: string
        }[]
      }
      get_notification_provider_availability: {
        Args: never
        Returns: {
          channel: string
          is_available: boolean
          provider_identifier: string
          status_reason: string
        }[]
      }
      get_recurring_todo_workspace: { Args: { p_filter?: Json }; Returns: Json }
      get_report_data: {
        Args: { p_filters?: Json; p_report_key: string }
        Returns: Json
      }
      get_report_export_batch: {
        Args: { p_export_id: string; p_limit: number; p_offset: number }
        Returns: Json
      }
      get_report_export_download_url: {
        Args: { p_export_id: string }
        Returns: Json
      }
      get_section_availability: { Args: never; Returns: Json }
      get_task_import_batch_status: {
        Args: { p_batch_id: string }
        Returns: Json
      }
      get_task_template_directory: { Args: { p_filter?: Json }; Returns: Json }
      hold_fms_instance_with_audit: {
        Args: { p_instance_id: string; p_reason: string }
        Returns: undefined
      }
      import_delegation_tasks_with_audit: {
        Args: { p_import_hash: string; p_rows: Json }
        Returns: Json
      }
      import_legacy_crm_client: {
        Args: {
          p_external_id: string
          p_import_run_id?: string
          p_payload: Json
          p_source_checksum: string
          p_source_key: string
        }
        Returns: string
      }
      import_legacy_crm_timeline: {
        Args: {
          p_client_external_id: string
          p_external_id: string
          p_import_run_id?: string
          p_payload: Json
          p_source_checksum: string
          p_source_key: string
        }
        Returns: string
      }
      import_task_bulk_with_audit: {
        Args: { p_file_label: string; p_import_hash: string; p_payload: Json }
        Returns: Json
      }
      ingest_crm_source_batch: {
        Args: {
          p_request_key: string
          p_rows: Json
          p_run_id: string
          p_scope_key: string
          p_source_key: string
          p_worker_assertion: Json
        }
        Returns: Json
      }
      invite_profile_with_audit: {
        Args: {
          p_auth_user_id: string
          p_branch_id: string
          p_buddy_id: string
          p_creator_profile_id: string
          p_department_id: string
          p_designation_id: string
          p_email: string
          p_employee_code: string
          p_employee_name: string
          p_official_mobile: string
          p_personal_mobile: string
          p_user_role: Database["public"]["Enums"]["user_role"]
          p_week_off: string[]
        }
        Returns: string
      }
      invite_profile_with_audit_v2: {
        Args: {
          p_auth_user_id: string
          p_branch_id: string
          p_buddy_id: string
          p_creator_profile_id: string
          p_department_id: string
          p_designation_id: string
          p_email: string
          p_employee_name: string
          p_official_mobile: string
          p_personal_mobile: string
          p_user_role: Database["public"]["Enums"]["user_role"]
          p_week_off: string[]
        }
        Returns: string
      }
      invite_profile_with_audit_v3: {
        Args: {
          p_auth_user_id: string
          p_branch_id: string
          p_buddy_id: string
          p_creator_profile_id: string
          p_department_id: string
          p_designation_id: string
          p_first_name: string
          p_last_name: string
          p_official_email: string
          p_official_mobile: string
          p_personal_email: string
          p_personal_mobile: string
          p_user_role: Database["public"]["Enums"]["user_role"]
          p_week_off: string[]
        }
        Returns: string
      }
      is_fms_instance_participant: {
        Args: { p_instance_id: string }
        Returns: boolean
      }
      is_reporting_descendant: {
        Args: { p_candidate_id: string; p_manager_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_supported_task_rrule: { Args: { p_rule: string }; Returns: boolean }
      is_task_participant: { Args: { p_task_id: string }; Returns: boolean }
      is_task_watcher: { Args: { p_task_id: string }; Returns: boolean }
      is_user_available_for_task: {
        Args: { p_target_date: string; p_user_profile_id: string }
        Returns: boolean
      }
      is_user_week_off_on_date: {
        Args: { p_target_date: string; p_user_profile_id: string }
        Returns: boolean
      }
      is_valid_fms_due_date: { Args: { p_value: string }; Returns: boolean }
      is_valid_fms_timing_rule: { Args: { p_rule: Json }; Returns: boolean }
      is_valid_form_date: { Args: { p_value: string }; Returns: boolean }
      is_valid_form_datetime: { Args: { p_value: string }; Returns: boolean }
      link_crm_record: {
        Args: {
          p_client_id: string
          p_module: string
          p_record_id: string
          p_request_key: string
        }
        Returns: string
      }
      list_assigning_left_tasks: { Args: never; Returns: Json }
      list_crm_followups: { Args: { p_filter?: Json }; Returns: Json[] }
      list_designation_daily_checklists: { Args: never; Returns: Json }
      list_notification_delivery_logs: {
        Args: {
          p_channel?: string
          p_event_type?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_state?: string
          p_to?: string
        }
        Returns: {
          attempt_count: number
          channel: string
          created_at: string
          delivered_at: string
          delivery_id: string
          error_category: string
          event_type: string
          max_attempts: number
          recipient_label: string
          scheduled_at: string
          state: string
        }[]
      }
      list_task_import_identity_candidates: {
        Args: never
        Returns: {
          branch_id: string
          department_id: string
          email: string
          employee_name: string
          id: string
          manager_id: string
        }[]
      }
      log_crm_interaction: {
        Args: { p_client_id: string; p_input: Json; p_request_key: string }
        Returns: string
      }
      lookup_crm_client_by_phone: {
        Args: { p_phone: string }
        Returns: {
          client_id: string
          match_kind: string
          record_version: number
        }[]
      }
      mark_all_notifications_read: { Args: never; Returns: number }
      mark_notification_read: {
        Args: { p_is_read?: boolean; p_notification_id: string }
        Returns: undefined
      }
      mark_report_export_cleaned: {
        Args: { p_export_id: string }
        Returns: boolean
      }
      merge_crm_clients: {
        Args: {
          p_duplicate_id: string
          p_request_key: string
          p_survivor_id: string
        }
        Returns: string
      }
      move_fms_stage_backward_with_audit: {
        Args: {
          p_assignee_id?: string
          p_instance_stage_id: string
          p_reason: string
          p_target_stage_id: string
        }
        Returns: string
      }
      next_employee_code: { Args: never; Returns: string }
      normalize_form_fields: {
        Args: { p_fields: Json; p_sections?: Json }
        Returns: Json
      }
      normalize_form_options: { Args: { p_options: Json }; Returns: Json }
      normalize_form_permissions: {
        Args: { p_permissions: Json }
        Returns: Json
      }
      normalize_form_rule: {
        Args: {
          p_depth?: number
          p_earlier: string[]
          p_field_key: string
          p_rule: Json
        }
        Returns: Json
      }
      normalize_form_sections: { Args: { p_sections: Json }; Returns: Json }
      normalize_indian_phone: { Args: { p_value: string }; Returns: string }
      normalize_task_checklist: { Args: { p_checklist: Json }; Returns: Json }
      notification_condition_matches: {
        Args: { p_condition: Json; p_now?: string; p_payload: Json }
        Returns: boolean
      }
      notification_event_variables: {
        Args: { p_event_type: string }
        Returns: string[]
      }
      notification_link_is_safe: { Args: { p_link: string }; Returns: boolean }
      notification_rule_matches: {
        Args: { p_conditions: Json; p_payload: Json }
        Returns: boolean
      }
      prepare_unused_user_deletion: {
        Args: { p_profile_id: string }
        Returns: string
      }
      preserve_legacy_crm_timeline_visit_form: {
        Args: {
          p_external_id: string
          p_payload: Json
          p_source_checksum: string
          p_source_key: string
        }
        Returns: string
      }
      preview_production_demo_data_retirement: {
        Args: {
          p_actor_auth_user_id: string
          p_backup_reference: string
          p_maintenance_acknowledged: boolean
        }
        Returns: Json
      }
      process_notification_events: {
        Args: { p_limit?: number }
        Returns: {
          deliveries_created: number
          events_failed: number
          events_processed: number
        }[]
      }
      production_demo_data_retirement_actor: {
        Args: { p_actor_auth_user_id: string }
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      production_demo_data_retirement_manifest: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      publish_fms_flow_with_audit: {
        Args: { p_flow_id: string }
        Returns: undefined
      }
      publish_form_with_audit: {
        Args: { p_template_id: string }
        Returns: string
      }
      queue_fms_starter_assignments: {
        Args: { p_assigned_by: string; p_flow_id: string }
        Returns: undefined
      }
      reassign_crm_client: {
        Args: {
          p_assigned_crm_id: string
          p_branch_id: string
          p_client_id: string
          p_expected_version: number
          p_request_key: string
        }
        Returns: number
      }
      reassign_fms_stage_with_audit: {
        Args: {
          p_from_user_id: string
          p_instance_stage_id: string
          p_reason: string
          p_to_user_id: string
        }
        Returns: undefined
      }
      reconcile_all_assignment_coverage_with_audit: {
        Args: { p_date: string; p_reason?: string; p_user_profile_id: string }
        Returns: Json
      }
      reconcile_duplicate_production_identity_profiles: {
        Args: never
        Returns: undefined
      }
      reconcile_production_login_emails: {
        Args: { p_changes: Json; p_retire_ids?: string[] }
        Returns: number
      }
      reconcile_short_deadline_coverage_with_audit: {
        Args: { p_date: string; p_reason?: string; p_user_profile_id: string }
        Returns: Json
      }
      record_availability_range_with_audit: {
        Args: {
          p_end_date: string
          p_reason: string
          p_start_date: string
          p_status: Database["public"]["Enums"]["availability_status"]
          p_user_profile_id: string
        }
        Returns: Json
      }
      record_availability_with_audit: {
        Args: {
          p_date: string
          p_reason: string
          p_status: Database["public"]["Enums"]["availability_status"]
          p_user_profile_id: string
        }
        Returns: string
      }
      record_crm_walkin: {
        Args: { p_input: Json; p_request_key: string }
        Returns: Json
      }
      refresh_crm_client_rollups: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      register_crm_document: {
        Args: {
          p_client_id: string
          p_mime_type: string
          p_original_filename: string
          p_parent_id: string
          p_parent_type: string
          p_request_key: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: string
      }
      register_fms_evidence_with_audit: {
        Args: {
          p_instance_stage_id: string
          p_mime_type: string
          p_original_filename: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: string
      }
      register_form_upload: {
        Args: {
          p_field_key: string
          p_form_template_id: string
          p_mime_type: string
          p_original_filename: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: string
      }
      remove_crm_document: {
        Args: { p_document_id: string; p_reason: string; p_request_key: string }
        Returns: string
      }
      render_notification_template: {
        Args: { p_payload: Json; p_template: string }
        Returns: string
      }
      repair_production_super_admin_identity: {
        Args: never
        Returns: undefined
      }
      replace_form_draft_fields: {
        Args: { p_fields: Json; p_template_id: string }
        Returns: undefined
      }
      report_allowed_for_role: {
        Args: {
          p_export?: boolean
          p_key: string
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: boolean
      }
      report_max_days: { Args: { p_key: string }; Returns: number }
      report_rows_for_profile: {
        Args: {
          p_filters: Json
          p_limit: number
          p_offset: number
          p_profile_id: string
          p_report_key: string
        }
        Returns: Json
      }
      reporting_context_for_actor: {
        Args: { p_actor_id: string; p_context?: Json }
        Returns: Json
      }
      request_fms_revision_with_audit: {
        Args: {
          p_assignee_id?: string
          p_instance_stage_id: string
          p_reason: string
          p_target_stage_id: string
        }
        Returns: string
      }
      request_report_export_with_audit: {
        Args: { p_filters: Json; p_report_key: string; p_request_key: string }
        Returns: {
          attempt_count: number
          cancelled_at: string | null
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          cleaned_at: string | null
          completed_at: string | null
          expires_at: string | null
          failed_at: string | null
          filter_snapshot: Json | null
          format: string
          id: string
          max_attempts: number
          object_path: string | null
          progress_percent: number
          report_key: string
          request_key: string
          requested_at: string
          requester_role: Database["public"]["Enums"]["user_role"]
          row_count: number | null
          sanitized_error: string | null
          scope_snapshot: Json
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_profile_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "export_logs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reschedule_crm_followup: {
        Args: {
          p_assigned_to: string
          p_due_date: string
          p_expected_version: number
          p_followup_id: string
          p_reason: string
          p_request_key: string
        }
        Returns: number
      }
      resolve_fms_stage_assignees: {
        Args: {
          p_instance_id: string
          p_selected_user?: string
          p_stage_id: string
        }
        Returns: string[]
      }
      resolve_notification_recipients: {
        Args: {
          p_event: Database["public"]["Tables"]["notification_events"]["Row"]
          p_rules: Json
        }
        Returns: {
          user_profile_id: string
        }[]
      }
      resolve_task_coverage: {
        Args: { p_original_assignee_id: string; p_target_date: string }
        Returns: {
          effective_assignee_id: string
          original_assignee_id: string
          resolution: string
        }[]
      }
      resume_fms_instance_with_audit: {
        Args: { p_instance_id: string; p_reason: string }
        Returns: undefined
      }
      retry_notification_delivery: {
        Args: { p_delivery_id: string }
        Returns: undefined
      }
      retry_report_export_with_audit: {
        Args: { p_export_id: string; p_request_key: string }
        Returns: {
          attempt_count: number
          cancelled_at: string | null
          claim_expires_at: string | null
          claimed_at: string | null
          claimed_by: string | null
          cleaned_at: string | null
          completed_at: string | null
          expires_at: string | null
          failed_at: string | null
          filter_snapshot: Json | null
          format: string
          id: string
          max_attempts: number
          object_path: string | null
          progress_percent: number
          report_key: string
          request_key: string
          requested_at: string
          requester_role: Database["public"]["Enums"]["user_role"]
          row_count: number | null
          sanitized_error: string | null
          scope_snapshot: Json
          started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_profile_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "export_logs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_fms_stage_with_audit: {
        Args: {
          p_decision: string
          p_instance_stage_id: string
          p_next_assignee_id?: string
          p_remark?: string
        }
        Returns: undefined
      }
      review_form_submission_with_audit: {
        Args: {
          p_decision: string
          p_review_notes?: string
          p_submission_id: string
        }
        Returns: string
      }
      review_resignation_with_audit: {
        Args: { p_decision: string; p_resignation_id: string }
        Returns: {
          company_assets_returned: boolean
          created_at: string | null
          created_by: string | null
          email_access_remove_date: string
          final_settlement_status: string | null
          handover_completed: boolean
          handover_given_to: string | null
          hr_remark: string | null
          id: string
          last_working_date: string
          manager_approval_status: string | null
          notice_period_served: boolean
          official_mobile_returned: boolean | null
          pending_tasks_reassigned: boolean
          replacement_buddy_id: string | null
          resignation_date: string
          resignation_reason_id: string | null
          super_admin_approval_status: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "resignations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      revise_task_datetime_with_audit: {
        Args: {
          p_reason: string
          p_revised_datetime: string
          p_task_id: string
        }
        Returns: undefined
      }
      run_recurring_todo_template_now_with_audit: {
        Args: { p_target_date: string; p_template_id: string }
        Returns: string
      }
      save_branch_settings_with_audit: {
        Args: {
          p_branch_id: string
          p_expected_version: number
          p_request_key: string
          p_settings: Json
        }
        Returns: {
          address: string | null
          city: string | null
          code: string
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          manager_id: string | null
          name: string
          pincode: string | null
          settings: Json
          settings_version: number
          state: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "branches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_designation_daily_checklist_with_audit: {
        Args: {
          p_checklist_id: string
          p_confirmation_text: string
          p_designation_id: string
          p_expected_revision: number
          p_instruction: string
          p_is_active: boolean
          p_items: Json
          p_title: string
        }
        Returns: Json
      }
      save_fms_context_assignee_default_with_audit: {
        Args: { p_module_context: string; p_user_profile_id: string }
        Returns: undefined
      }
      save_fms_flow_draft_with_audit: {
        Args: { p_flow_id: string; p_metadata: Json; p_stages: Json }
        Returns: string
      }
      save_form_draft_with_audit: {
        Args: { p_fields: Json; p_payload: Json; p_template_id: string }
        Returns: string
      }
      save_notification_rule: {
        Args: {
          p_backoff_minutes?: number
          p_channel_templates: Json
          p_conditions: Json
          p_cooldown_minutes?: number
          p_delay_minutes?: number
          p_event_type: string
          p_is_enabled?: boolean
          p_max_attempts?: number
          p_name: string
          p_priority?: Database["public"]["Enums"]["task_priority"]
          p_recipient_rules: Json
          p_rule_id: string
        }
        Returns: string
      }
      save_notification_template: {
        Args: {
          p_body_template: string
          p_channel: string
          p_event_type: string
          p_is_active?: boolean
          p_link_url?: string
          p_name: string
          p_template_id: string
          p_title_template: string
        }
        Returns: string
      }
      save_published_form_with_audit: {
        Args: { p_fields: Json; p_payload: Json; p_template_id: string }
        Returns: string
      }
      save_recurring_todo_template_with_audit: {
        Args: { p_payload: Json; p_template_id: string }
        Returns: string
      }
      save_section_availability_with_audit: {
        Args: {
          p_developer_mode_enabled: boolean
          p_expected_version: number
          p_request_key: string
          p_section_availability: Json
        }
        Returns: Json
      }
      save_task_template_with_audit: {
        Args: { p_payload: Json; p_template_id: string }
        Returns: string
      }
      save_tenant_settings_with_audit: {
        Args: {
          p_expected_version: number
          p_request_key: string
          p_settings: Json
        }
        Returns: {
          created_at: string | null
          currency: string | null
          export_max_rows: number
          export_retention_days: number
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          settings: Json
          settings_version: number
          slug: string
          timezone: string | null
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_user_preferences_with_audit: {
        Args: { p_preferences: Json }
        Returns: {
          created_at: string
          id: string
          preferences: Json
          record_version: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          user_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_preferences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_crm_clients: { Args: { p_filter?: Json }; Returns: Json[] }
      seed_default_notification_rules: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      send_recurring_followup_with_audit: {
        Args: { p_message: string; p_task_id: string }
        Returns: undefined
      }
      set_fms_flow_context_with_audit: {
        Args: { p_flow_id: string; p_module_context?: string }
        Returns: undefined
      }
      set_fms_instance_status_with_audit: {
        Args: { p_action: string; p_instance_id: string; p_reason: string }
        Returns: undefined
      }
      set_new_user_work_identity_with_audit: {
        Args: {
          p_personal_email: string
          p_profile_id: string
          p_username: string
        }
        Returns: undefined
      }
      set_notification_rule_enabled: {
        Args: { p_enabled: boolean; p_rule_id: string }
        Returns: undefined
      }
      set_recurring_todo_template_active_with_audit: {
        Args: { p_active: boolean; p_template_id: string }
        Returns: boolean
      }
      set_task_template_schedule_with_audit: {
        Args: { p_starts_on: string; p_template_id: string }
        Returns: Json
      }
      start_fms_from_form_submission_with_audit: {
        Args: { p_submission_id: string }
        Returns: {
          instance_id: string
          reference_number: string
        }[]
      }
      start_fms_instance_with_audit: {
        Args: {
          p_branch_id?: string
          p_context?: Json
          p_department_id?: string
          p_first_assignee_id?: string
          p_flow_id: string
          p_priority?: Database["public"]["Enums"]["task_priority"]
          p_title: string
        }
        Returns: {
          instance_id: string
          reference_number: string
        }[]
      }
      submit_fms_form_and_progress_with_audit: {
        Args: {
          p_answers: Json
          p_checklist?: Json
          p_form_template_id: string
          p_idempotency_key: string
          p_linked_module: string
          p_linked_record_id: string
          p_next_assignee_id?: string
          p_outcome?: string
          p_remark?: string
        }
        Returns: Json
      }
      submit_form_base_with_audit: {
        Args: {
          p_answers: Json
          p_form_template_id: string
          p_linked_module?: string
          p_linked_record_id?: string
        }
        Returns: string
      }
      submit_form_locked_with_audit: {
        Args: {
          p_answers: Json
          p_form_template_id: string
          p_linked_module?: string
          p_linked_record_id?: string
        }
        Returns: string
      }
      submit_form_with_audit: {
        Args: {
          p_answers: Json
          p_form_template_id: string
          p_linked_module?: string
          p_linked_record_id?: string
        }
        Returns: string
      }
      submit_resignation_with_audit: {
        Args: {
          p_profile_changes: Json
          p_profile_id: string
          p_resignation: Json
        }
        Returns: {
          company_assets_returned: boolean
          created_at: string | null
          created_by: string | null
          email_access_remove_date: string
          final_settlement_status: string | null
          handover_completed: boolean
          handover_given_to: string | null
          hr_remark: string | null
          id: string
          last_working_date: string
          manager_approval_status: string | null
          notice_period_served: boolean
          official_mobile_returned: boolean | null
          pending_tasks_reassigned: boolean
          replacement_buddy_id: string | null
          resignation_date: string
          resignation_reason_id: string | null
          super_admin_approval_status: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "resignations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_crm_contacts: {
        Args: { p_actor: string; p_client_id: string }
        Returns: undefined
      }
      task_bulk_import_validation: {
        Args: { p_hash: string; p_payload: Json }
        Returns: Json
      }
      task_effective_due_datetime: {
        Args: { p_task: Database["public"]["Tables"]["task_instances"]["Row"] }
        Returns: string
      }
      task_import_actor: {
        Args: never
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      task_import_business_fingerprint: {
        Args: { p_row: Json }
        Returns: string
      }
      task_in_reporting_scope: {
        Args: {
          p_actor: Database["public"]["Tables"]["user_profiles"]["Row"]
          p_context: Json
          p_task: Database["public"]["Tables"]["task_instances"]["Row"]
        }
        Returns: boolean
      }
      update_crm_client: {
        Args: {
          p_changes: Json
          p_client_id: string
          p_expected_version: number
          p_request_key: string
        }
        Returns: number
      }
      update_fms_checklist_item_with_audit: {
        Args: { p_completed: boolean; p_item_id: string }
        Returns: undefined
      }
      update_report_export_progress: {
        Args: {
          p_export_id: string
          p_progress: number
          p_row_count: number
          p_worker_id: string
        }
        Returns: boolean
      }
      update_task_with_audit: {
        Args: {
          p_action: string
          p_checklist_id?: string
          p_completed?: boolean
          p_remark?: string
          p_task_id: string
        }
        Returns: undefined
      }
      update_user_profile_with_audit: {
        Args: { p_changes: Json; p_profile_id: string }
        Returns: {
          account_status: Database["public"]["Enums"]["user_account_status"]
          auth_user_id: string
          branch_id: string
          buddy_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string
          designation_id: string | null
          email: string
          employee_code: string
          employee_name: string
          first_name: string | null
          id: string
          is_login_enabled: boolean | null
          last_name: string | null
          official_email: string | null
          official_mobile: string | null
          personal_email: string | null
          personal_mobile: string | null
          reports_to_user_id: string | null
          secondary_buddy_id: string | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          username: string | null
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        SetofOptions: {
          from: "*"
          to: "user_profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_crm_branch_mapping: {
        Args: {
          p_branch_id: string
          p_external_branch_id: string
          p_metadata?: Json
          p_source_key: string
        }
        Returns: string
      }
      upsert_crm_staff_mapping: {
        Args: {
          p_external_staff_id: string
          p_metadata?: Json
          p_source_key: string
          p_user_profile_id: string
        }
        Returns: string
      }
      use_task_template_with_audit: {
        Args: { p_planned_datetime: string; p_template_id: string }
        Returns: string
      }
      user_role_hierarchy_rank: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: number
      }
      validate_daily_checklist_items: { Args: { p_items: Json }; Returns: Json }
      validate_notification_template_text: {
        Args: { p_body: string; p_event_type: string; p_title: string }
        Returns: undefined
      }
      validate_task_bulk_import: {
        Args: { p_import_hash: string; p_payload: Json }
        Returns: Json
      }
      validated_section_availability: {
        Args: { p_availability: Json }
        Returns: Json
      }
      validated_user_preferences: {
        Args: { p_preferences: Json }
        Returns: Json
      }
      verify_recurring_task_with_audit: {
        Args: { p_decision: string; p_note?: string; p_task_id: string }
        Returns: undefined
      }
    }
    Enums: {
      availability_status: "present" | "absent" | "half_day" | "remote"
      fms_completion_rule: "all_doers" | "any_doer" | "manager_approval"
      fms_flow_status: "draft" | "published" | "archived"
      fms_instance_status:
        | "active"
        | "completed"
        | "cancelled"
        | "on_hold"
        | "overdue"
      fms_join_rule: "all" | "any" | "specific"
      fms_step_type:
        | "task"
        | "approval"
        | "form"
        | "notification"
        | "branch"
        | "parallel_start"
        | "parallel_join"
        | "end"
      form_submission_status: "submitted" | "approved" | "rejected"
      form_template_lifecycle: "draft" | "published" | "archived"
      task_priority: "high" | "medium" | "low"
      task_status:
        | "pending"
        | "in_progress"
        | "in_review"
        | "completed"
        | "rejected"
        | "blocked"
        | "overdue"
      task_type: "checklist" | "fms" | "delegation"
      user_account_status:
        | "active"
        | "invited"
        | "inactive"
        | "suspended"
        | "left"
      user_role:
        | "super_admin"
        | "admin"
        | "manager"
        | "hr"
        | "crm"
        | "staff"
        | "doer"
        | "housekeeping"
      working_status:
        | "active"
        | "inactive"
        | "on_leave"
        | "half_day"
        | "resigned"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      availability_status: ["present", "absent", "half_day", "remote"],
      fms_completion_rule: ["all_doers", "any_doer", "manager_approval"],
      fms_flow_status: ["draft", "published", "archived"],
      fms_instance_status: [
        "active",
        "completed",
        "cancelled",
        "on_hold",
        "overdue",
      ],
      fms_join_rule: ["all", "any", "specific"],
      fms_step_type: [
        "task",
        "approval",
        "form",
        "notification",
        "branch",
        "parallel_start",
        "parallel_join",
        "end",
      ],
      form_submission_status: ["submitted", "approved", "rejected"],
      form_template_lifecycle: ["draft", "published", "archived"],
      task_priority: ["high", "medium", "low"],
      task_status: [
        "pending",
        "in_progress",
        "in_review",
        "completed",
        "rejected",
        "blocked",
        "overdue",
      ],
      task_type: ["checklist", "fms", "delegation"],
      user_account_status: [
        "active",
        "invited",
        "inactive",
        "suspended",
        "left",
      ],
      user_role: [
        "super_admin",
        "admin",
        "manager",
        "hr",
        "crm",
        "staff",
        "doer",
        "housekeeping",
      ],
      working_status: [
        "active",
        "inactive",
        "on_leave",
        "half_day",
        "resigned",
      ],
    },
  },
} as const

