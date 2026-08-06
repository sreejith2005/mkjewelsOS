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
    PostgrestVersion: "14.15"
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
            foreignKeyName: "buddy_assignments_original_assignee_id_fkey"
            columns: ["original_assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
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
      client_followups: {
        Row: {
          assigned_to: string | null
          client_id: string
          created_at: string | null
          due_date: string
          id: string
          notes: string | null
          status: string | null
        }
        Insert: {
          assigned_to?: string | null
          client_id: string
          created_at?: string | null
          due_date: string
          id?: string
          notes?: string | null
          status?: string | null
        }
        Update: {
          assigned_to?: string | null
          client_id?: string
          created_at?: string | null
          due_date?: string
          id?: string
          notes?: string | null
          status?: string | null
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
            foreignKeyName: "client_followups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_timeline: {
        Row: {
          client_id: string
          created_at: string | null
          created_by: string | null
          event_type: string
          id: string
          ref_id: string | null
          summary: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          created_by?: string | null
          event_type: string
          id?: string
          ref_id?: string | null
          summary?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          event_type?: string
          id?: string
          ref_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_timeline_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          assigned_crm_id: string | null
          billing_phone: string | null
          branch_id: string | null
          city: string | null
          client_type_id: string | null
          created_at: string | null
          first_name: string | null
          gender: string | null
          id: string
          last_name: string | null
          last_visit_date: string | null
          next_visit_date: string | null
          phone: string
          pincode: string | null
          potential_category: string | null
          source_id: string | null
          state: string | null
          tenant_id: string
          total_visits: number | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          assigned_crm_id?: string | null
          billing_phone?: string | null
          branch_id?: string | null
          city?: string | null
          client_type_id?: string | null
          created_at?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          last_visit_date?: string | null
          next_visit_date?: string | null
          phone: string
          pincode?: string | null
          potential_category?: string | null
          source_id?: string | null
          state?: string | null
          tenant_id: string
          total_visits?: number | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          assigned_crm_id?: string | null
          billing_phone?: string | null
          branch_id?: string | null
          city?: string | null
          client_type_id?: string | null
          created_at?: string | null
          first_name?: string | null
          gender?: string | null
          id?: string
          last_name?: string | null
          last_visit_date?: string | null
          next_visit_date?: string | null
          phone?: string
          pincode?: string | null
          potential_category?: string | null
          source_id?: string | null
          state?: string | null
          tenant_id?: string
          total_visits?: number | null
          updated_at?: string | null
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
          created_at: string | null
          export_type: string
          file_url: string | null
          filters: Json | null
          id: string
          tenant_id: string
          user_profile_id: string | null
        }
        Insert: {
          created_at?: string | null
          export_type: string
          file_url?: string | null
          filters?: Json | null
          id?: string
          tenant_id: string
          user_profile_id?: string | null
        }
        Update: {
          created_at?: string | null
          export_type?: string
          file_url?: string | null
          filters?: Json | null
          id?: string
          tenant_id?: string
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
        ]
      }
      fms_branch_rules: {
        Row: {
          condition_field: string
          condition_operator: string
          condition_value: string
          fms_stage_id: string
          id: string
          label: string | null
          next_flow_id: string | null
          next_stage_id: string | null
          sort_order: number | null
        }
        Insert: {
          condition_field: string
          condition_operator: string
          condition_value: string
          fms_stage_id: string
          id?: string
          label?: string | null
          next_flow_id?: string | null
          next_stage_id?: string | null
          sort_order?: number | null
        }
        Update: {
          condition_field?: string
          condition_operator?: string
          condition_value?: string
          fms_stage_id?: string
          id?: string
          label?: string | null
          next_flow_id?: string | null
          next_stage_id?: string | null
          sort_order?: number | null
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
      fms_flows: {
        Row: {
          branch_id: string | null
          created_at: string | null
          created_by: string
          department_id: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          published_by: string | null
          status: Database["public"]["Enums"]["fms_flow_status"]
          tenant_id: string
          trigger_type: string | null
          updated_at: string | null
          usage_count: number
          version: number
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          created_by: string
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          published_by?: string | null
          status?: Database["public"]["Enums"]["fms_flow_status"]
          tenant_id: string
          trigger_type?: string | null
          updated_at?: string | null
          usage_count?: number
          version?: number
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          published_by?: string | null
          status?: Database["public"]["Enums"]["fms_flow_status"]
          tenant_id?: string
          trigger_type?: string | null
          updated_at?: string | null
          usage_count?: number
          version?: number
        }
        Relationships: [
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
        ]
      }
      fms_instance_stages: {
        Row: {
          actual_datetime: string | null
          assigned_to: string[] | null
          created_at: string | null
          delay_minutes: number | null
          fms_instance_id: string
          fms_stage_id: string
          form_submission_id: string | null
          id: string
          next_doer_ids: string[] | null
          outcome: string | null
          planned_datetime: string | null
          remark: string | null
          sla_breached: boolean | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string | null
        }
        Insert: {
          actual_datetime?: string | null
          assigned_to?: string[] | null
          created_at?: string | null
          delay_minutes?: number | null
          fms_instance_id: string
          fms_stage_id: string
          form_submission_id?: string | null
          id?: string
          next_doer_ids?: string[] | null
          outcome?: string | null
          planned_datetime?: string | null
          remark?: string | null
          sla_breached?: boolean | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string | null
        }
        Update: {
          actual_datetime?: string | null
          assigned_to?: string[] | null
          created_at?: string | null
          delay_minutes?: number | null
          fms_instance_id?: string
          fms_stage_id?: string
          form_submission_id?: string | null
          id?: string
          next_doer_ids?: string[] | null
          outcome?: string | null
          planned_datetime?: string | null
          remark?: string | null
          sla_breached?: boolean | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string | null
        }
        Relationships: [
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
        ]
      }
      fms_instances: {
        Row: {
          branch_id: string | null
          completed_at: string | null
          context: Json
          created_at: string | null
          fms_flow_id: string
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
          completed_at?: string | null
          context?: Json
          created_at?: string | null
          fms_flow_id: string
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
          completed_at?: string | null
          context?: Json
          created_at?: string | null
          fms_flow_id?: string
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
            foreignKeyName: "fms_instances_fms_flow_id_fkey"
            columns: ["fms_flow_id"]
            isOneToOne: false
            referencedRelation: "fms_flows"
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
          assignee_type: string
          fms_stage_id: string
          id: string
          is_start_stage_entry_user: boolean | null
          role_value: Database["public"]["Enums"]["user_role"] | null
          user_profile_id: string | null
        }
        Insert: {
          assignee_type: string
          fms_stage_id: string
          id?: string
          is_start_stage_entry_user?: boolean | null
          role_value?: Database["public"]["Enums"]["user_role"] | null
          user_profile_id?: string | null
        }
        Update: {
          assignee_type?: string
          fms_stage_id?: string
          id?: string
          is_start_stage_entry_user?: boolean | null
          role_value?: Database["public"]["Enums"]["user_role"] | null
          user_profile_id?: string | null
        }
        Relationships: [
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
          completion_rule:
            | Database["public"]["Enums"]["fms_completion_rule"]
            | null
          created_at: string | null
          fms_flow_id: string
          form_template_id: string | null
          id: string
          is_parallel_group: boolean | null
          is_required: boolean | null
          join_required_stage_ids: string[] | null
          join_rule: Database["public"]["Enums"]["fms_join_rule"] | null
          method: string | null
          name: string
          parallel_group_key: string | null
          planned_time_rule: Json
          requires_checklist: boolean | null
          requires_next_doer_handoff: boolean | null
          requires_remark: boolean | null
          requires_upload: boolean | null
          sort_order: number
          split_to_flow_id: string | null
          step_type: Database["public"]["Enums"]["fms_step_type"]
        }
        Insert: {
          allow_multiple_doers?: boolean | null
          can_escalate?: boolean | null
          can_move_backward?: boolean | null
          can_reject?: boolean | null
          can_request_revision?: boolean | null
          completion_rule?:
            | Database["public"]["Enums"]["fms_completion_rule"]
            | null
          created_at?: string | null
          fms_flow_id: string
          form_template_id?: string | null
          id?: string
          is_parallel_group?: boolean | null
          is_required?: boolean | null
          join_required_stage_ids?: string[] | null
          join_rule?: Database["public"]["Enums"]["fms_join_rule"] | null
          method?: string | null
          name: string
          parallel_group_key?: string | null
          planned_time_rule?: Json
          requires_checklist?: boolean | null
          requires_next_doer_handoff?: boolean | null
          requires_remark?: boolean | null
          requires_upload?: boolean | null
          sort_order: number
          split_to_flow_id?: string | null
          step_type?: Database["public"]["Enums"]["fms_step_type"]
        }
        Update: {
          allow_multiple_doers?: boolean | null
          can_escalate?: boolean | null
          can_move_backward?: boolean | null
          can_reject?: boolean | null
          can_request_revision?: boolean | null
          completion_rule?:
            | Database["public"]["Enums"]["fms_completion_rule"]
            | null
          created_at?: string | null
          fms_flow_id?: string
          form_template_id?: string | null
          id?: string
          is_parallel_group?: boolean | null
          is_required?: boolean | null
          join_required_stage_ids?: string[] | null
          join_rule?: Database["public"]["Enums"]["fms_join_rule"] | null
          method?: string | null
          name?: string
          parallel_group_key?: string | null
          planned_time_rule?: Json
          requires_checklist?: boolean | null
          requires_next_doer_handoff?: boolean | null
          requires_remark?: boolean | null
          requires_upload?: boolean | null
          sort_order?: number
          split_to_flow_id?: string | null
          step_type?: Database["public"]["Enums"]["fms_step_type"]
        }
        Relationships: [
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
      form_fields: {
        Row: {
          conditional_logic: Json | null
          created_at: string | null
          field_name: string
          field_type: string
          form_template_id: string
          group_name: string | null
          id: string
          initial_value: string | null
          is_editable: boolean | null
          is_required: boolean | null
          is_shown: boolean | null
          options: Json | null
          sort_order: number | null
        }
        Insert: {
          conditional_logic?: Json | null
          created_at?: string | null
          field_name: string
          field_type: string
          form_template_id: string
          group_name?: string | null
          id?: string
          initial_value?: string | null
          is_editable?: boolean | null
          is_required?: boolean | null
          is_shown?: boolean | null
          options?: Json | null
          sort_order?: number | null
        }
        Update: {
          conditional_logic?: Json | null
          created_at?: string | null
          field_name?: string
          field_type?: string
          form_template_id?: string
          group_name?: string | null
          id?: string
          initial_value?: string | null
          is_editable?: boolean | null
          is_required?: boolean | null
          is_shown?: boolean | null
          options?: Json | null
          sort_order?: number | null
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
      form_submissions: {
        Row: {
          branch_id: string | null
          data: Json
          department_id: string | null
          form_template_id: string
          id: string
          linked_module: string | null
          linked_record_id: string | null
          submitted_at: string | null
          submitted_by: string | null
          tenant_id: string
        }
        Insert: {
          branch_id?: string | null
          data?: Json
          department_id?: string | null
          form_template_id: string
          id?: string
          linked_module?: string | null
          linked_record_id?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          tenant_id: string
        }
        Update: {
          branch_id?: string | null
          data?: Json
          department_id?: string | null
          form_template_id?: string
          id?: string
          linked_module?: string | null
          linked_record_id?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          tenant_id?: string
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
            foreignKeyName: "form_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
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
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          permissions: Json | null
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          permissions?: Json | null
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          permissions?: Json | null
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          channel: string
          created_at: string | null
          id: string
          notification_id: string | null
          provider_response: Json | null
          status: string
        }
        Insert: {
          channel: string
          created_at?: string | null
          id?: string
          notification_id?: string | null
          provider_response?: Json | null
          status: string
        }
        Update: {
          channel?: string
          created_at?: string | null
          id?: string
          notification_id?: string | null
          provider_response?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_rules: {
        Row: {
          channels: string[] | null
          conditions: Json | null
          event_type: string
          id: string
          is_active: boolean | null
          template_id: string | null
          tenant_id: string | null
        }
        Insert: {
          channels?: string[] | null
          conditions?: Json | null
          event_type: string
          id?: string
          is_active?: boolean | null
          template_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          channels?: string[] | null
          conditions?: Json | null
          event_type?: string
          id?: string
          is_active?: boolean | null
          template_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
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
        ]
      }
      notification_templates: {
        Row: {
          body_template: string
          channel: string
          event_type: string
          id: string
          is_active: boolean | null
          tenant_id: string | null
          title_template: string
        }
        Insert: {
          body_template: string
          channel: string
          event_type: string
          id?: string
          is_active?: boolean | null
          tenant_id?: string | null
          title_template: string
        }
        Update: {
          body_template?: string
          channel?: string
          event_type?: string
          id?: string
          is_active?: boolean | null
          tenant_id?: string | null
          title_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: string | null
          created_at: string | null
          delivered_status: string | null
          event_type: string
          id: string
          is_read: boolean | null
          link_url: string | null
          message: string
          read_at: string | null
          retry_count: number | null
          tenant_id: string
          title: string
          user_profile_id: string
        }
        Insert: {
          channel?: string | null
          created_at?: string | null
          delivered_status?: string | null
          event_type: string
          id?: string
          is_read?: boolean | null
          link_url?: string | null
          message: string
          read_at?: string | null
          retry_count?: number | null
          tenant_id: string
          title: string
          user_profile_id: string
        }
        Update: {
          channel?: string | null
          created_at?: string | null
          delivered_status?: string | null
          event_type?: string
          id?: string
          is_read?: boolean | null
          link_url?: string | null
          message?: string
          read_at?: string | null
          retry_count?: number | null
          tenant_id?: string
          title?: string
          user_profile_id?: string
        }
        Relationships: [
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
            foreignKeyName: "resignations_replacement_buddy_id_fkey"
            columns: ["replacement_buddy_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
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
        ]
      }
      task_assignees: {
        Row: {
          completed_at: string | null
          id: string
          is_original: boolean | null
          role_at_task: string | null
          task_instance_id: string
          user_profile_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          is_original?: boolean | null
          role_at_task?: string | null
          task_instance_id: string
          user_profile_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
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
        ]
      }
      task_instances: {
        Row: {
          actual_datetime: string | null
          branch_id: string | null
          created_at: string | null
          created_by: string
          delay_minutes: number | null
          department_id: string | null
          description: string | null
          id: string
          planned_datetime: string
          priority: Database["public"]["Enums"]["task_priority"] | null
          revised_datetime: string | null
          source: string | null
          source_ref_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_template_id: string | null
          task_type: Database["public"]["Enums"]["task_type"]
          tenant_id: string
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          actual_datetime?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by: string
          delay_minutes?: number | null
          department_id?: string | null
          description?: string | null
          id?: string
          planned_datetime: string
          priority?: Database["public"]["Enums"]["task_priority"] | null
          revised_datetime?: string | null
          source?: string | null
          source_ref_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_template_id?: string | null
          task_type: Database["public"]["Enums"]["task_type"]
          tenant_id: string
          title: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          actual_datetime?: string | null
          branch_id?: string | null
          created_at?: string | null
          created_by?: string
          delay_minutes?: number | null
          department_id?: string | null
          description?: string | null
          id?: string
          planned_datetime?: string
          priority?: Database["public"]["Enums"]["task_priority"] | null
          revised_datetime?: string | null
          source?: string | null
          source_ref_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_template_id?: string | null
          task_type?: Database["public"]["Enums"]["task_type"]
          tenant_id?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
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
            foreignKeyName: "task_instances_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
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
          branch_id: string | null
          created_at: string | null
          created_by: string | null
          department_id: string | null
          description: string | null
          form_template_id: string | null
          id: string
          is_active: boolean | null
          planned_time: string | null
          recurrence_rule: string | null
          requires_form: boolean | null
          requires_remark: boolean | null
          requires_upload: boolean | null
          task_type: Database["public"]["Enums"]["task_type"]
          tenant_id: string
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          form_template_id?: string | null
          id?: string
          is_active?: boolean | null
          planned_time?: string | null
          recurrence_rule?: string | null
          requires_form?: boolean | null
          requires_remark?: boolean | null
          requires_upload?: boolean | null
          task_type?: Database["public"]["Enums"]["task_type"]
          tenant_id: string
          title: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          form_template_id?: string | null
          id?: string
          is_active?: boolean | null
          planned_time?: string | null
          recurrence_rule?: string | null
          requires_form?: boolean | null
          requires_remark?: boolean | null
          requires_upload?: boolean | null
          task_type?: Database["public"]["Enums"]["task_type"]
          tenant_id?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
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
        ]
      }
      tenants: {
        Row: {
          created_at: string | null
          currency: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          slug: string
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          slug: string
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
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
        ]
      }
      user_profiles: {
        Row: {
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
          id: string
          is_login_enabled: boolean | null
          official_mobile: string | null
          personal_mobile: string
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
          week_off: string[]
          working_status: Database["public"]["Enums"]["working_status"]
        }
        Insert: {
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
          id?: string
          is_login_enabled?: boolean | null
          official_mobile?: string | null
          personal_mobile: string
          tenant_id: string
          updated_at?: string | null
          updated_by?: string | null
          user_role?: Database["public"]["Enums"]["user_role"]
          week_off?: string[]
          working_status?: Database["public"]["Enums"]["working_status"]
        }
        Update: {
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
          id?: string
          is_login_enabled?: boolean | null
          official_mobile?: string | null
          personal_mobile?: string
          tenant_id?: string
          updated_at?: string | null
          updated_by?: string | null
          user_role?: Database["public"]["Enums"]["user_role"]
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
      walkin_entries: {
        Row: {
          branch_id: string
          buy_status: string | null
          client_id: string
          client_type_id: string | null
          companions: number | null
          created_at: string | null
          created_by: string | null
          crm_id: string | null
          google_review_asked: boolean | null
          id: string
          instagram_asked: boolean | null
          next_visit_date: string | null
          not_bought_reason: string | null
          potential_category: string | null
          product_bought: boolean | null
          product_categories: string[] | null
          product_requirement: string | null
          referral_asked: boolean | null
          remark: string | null
          salesperson_id: string | null
          tenant_id: string
          visit_date: string
        }
        Insert: {
          branch_id: string
          buy_status?: string | null
          client_id: string
          client_type_id?: string | null
          companions?: number | null
          created_at?: string | null
          created_by?: string | null
          crm_id?: string | null
          google_review_asked?: boolean | null
          id?: string
          instagram_asked?: boolean | null
          next_visit_date?: string | null
          not_bought_reason?: string | null
          potential_category?: string | null
          product_bought?: boolean | null
          product_categories?: string[] | null
          product_requirement?: string | null
          referral_asked?: boolean | null
          remark?: string | null
          salesperson_id?: string | null
          tenant_id: string
          visit_date?: string
        }
        Update: {
          branch_id?: string
          buy_status?: string | null
          client_id?: string
          client_type_id?: string | null
          companions?: number | null
          created_at?: string | null
          created_by?: string | null
          crm_id?: string | null
          google_review_asked?: boolean | null
          id?: string
          instagram_asked?: boolean | null
          next_visit_date?: string | null
          not_bought_reason?: string | null
          potential_category?: string | null
          product_bought?: boolean | null
          product_categories?: string[] | null
          product_requirement?: string | null
          referral_asked?: boolean | null
          remark?: string | null
          salesperson_id?: string | null
          tenant_id?: string
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
            foreignKeyName: "walkin_entries_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walkin_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      walkin_uploads: {
        Row: {
          created_at: string | null
          file_url: string
          id: string
          walkin_entry_id: string
        }
        Insert: {
          created_at?: string | null
          file_url: string
          id?: string
          walkin_entry_id: string
        }
        Update: {
          created_at?: string | null
          file_url?: string
          id?: string
          walkin_entry_id?: string
        }
        Relationships: [
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
          delay_minutes: number | null
          department_id: string | null
          id: string | null
          planned_datetime: string | null
          priority: Database["public"]["Enums"]["task_priority"] | null
          source: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_type: Database["public"]["Enums"]["task_type"] | null
          tenant_id: string | null
          title: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      change_dropdown_with_audit: {
        Args: {
          p_is_active?: boolean
          p_label?: string
          p_master_type?: string
          p_operation: string
          p_record_id?: string | null
          p_sort_order?: number
          p_value?: string
        }
        Returns: Database["public"]["Tables"]["dropdown_masters"]["Row"]
      }
      current_branch_id: { Args: never; Returns: string }
      current_profile: {
        Args: never
        Returns: {
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
          id: string
          is_login_enabled: boolean | null
          official_mobile: string | null
          personal_mobile: string
          tenant_id: string
          updated_at: string | null
          updated_by: string | null
          user_role: Database["public"]["Enums"]["user_role"]
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
      current_role_level: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      current_tenant_id: { Args: never; Returns: string }
      invite_profile_with_audit: {
        Args: {
          p_auth_user_id: string
          p_branch_id: string
          p_buddy_id: string
          p_creator_profile_id: string
          p_department_id: string
          p_designation_id: string | null
          p_email: string
          p_employee_code: string
          p_employee_name: string
          p_official_mobile: string | null
          p_personal_mobile: string
          p_user_role: Database["public"]["Enums"]["user_role"]
          p_week_off: string[]
        }
        Returns: string
      }
      is_super_admin: { Args: never; Returns: boolean }
      review_resignation_with_audit: {
        Args: { p_decision: string; p_resignation_id: string }
        Returns: Database["public"]["Tables"]["resignations"]["Row"]
      }
      submit_resignation_with_audit: {
        Args: {
          p_profile_changes: Json
          p_profile_id: string
          p_resignation: Json
        }
        Returns: Database["public"]["Tables"]["resignations"]["Row"]
      }
      update_user_profile_with_audit: {
        Args: { p_changes: Json; p_profile_id: string }
        Returns: Database["public"]["Tables"]["user_profiles"]["Row"]
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
