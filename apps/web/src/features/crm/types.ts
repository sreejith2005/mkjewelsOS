export type CrmClientSummary = {
  id: string; first_name: string; last_name: string | null; phone: string; email: string | null;
  branch_id: string | null; assigned_crm_id: string | null; client_type_id: string | null; source_id: string | null;
  potential_category: string | null; total_visits: number; last_visit_date: string | null; next_visit_date: string | null;
  record_version: number; updated_at: string; next_cursor: string;
};

export type CrmTimeline = { id: string; event_type: string; subject: string | null; outcome: string | null; summary: string | null; occurred_at: string; created_by: string | null; ref_id: string | null };
export type CrmWalkin = { id: string; visit_date: string; branch_id: string; product_bought: boolean | null; buy_status: string | null; crm_id: string | null; salesperson_id: string | null; remark: string | null };
export type CrmFollowup = { id: string; client_id: string; client_display?: string; assigned_to: string | null; branch_id: string | null; due_date: string; status: "open" | "completed" | "cancelled"; subject: string | null; outcome: string | null; cancel_reason: string | null; record_version: number; bucket?: "today" | "overdue" | "upcoming" | "completed" | "cancelled"; next_cursor?: string };
export type CrmDocument = { id: string; parent_type: string; parent_id: string; original_filename: string; mime_type: string; size_bytes: number; uploaded_by: string; created_at: string };
export type CrmLink = { id: string; title?: string; status: string; planned_datetime?: string; form_template_id?: string; submitted_at?: string; reference_number?: string };
export type CrmClient = CrmClientSummary & { billing_phone: string | null; gender: string | null; date_of_birth: string | null; anniversary_date: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; tags: string[]; status: string; communication_preference: string | null; communication_consent: boolean | null; merged_into_client_id: string | null };
export type CrmClientDetail = { client: CrmClient; timeline: CrmTimeline[]; walkins: CrmWalkin[]; followups: CrmFollowup[]; documents: CrmDocument[]; tasks: CrmLink[]; forms: CrmLink[]; fms: CrmLink[] };
export type CrmOption = { id: string; label: string; value?: string; branch_id?: string; user_role?: string; master_type?: string };
export type CrmOptions = { branches: CrmOption[]; profiles: CrmOption[]; dropdowns: CrmOption[] };
