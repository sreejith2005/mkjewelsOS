import type { Json } from "../database.types";

/** Public signatures of migration 0354; kept separate from generated bulk types. */
export type CustomerIntegrationFunctions = {
 request_customer_export:{Args:{p_key:string;p_filters:Json;p_request_key:string};Returns:Json};
 save_customer_export_layout:{Args:{p_name:string;p_configuration:Json};Returns:string};
 get_customer_export_layouts:{Args:Record<never,never>;Returns:Json};
 customer_export_options:{Args:{p_flow?:string|null};Returns:Json};
 save_historical_customer_mapping: { Args: { p_submission_id: string; p_config: Json }; Returns: Json };
 save_form_customer_mapping: { Args: { p_template_id: string; p_config: Json }; Returns: Json };
 get_form_customer_mapping: { Args: { p_template_id: string }; Returns: Json };
 customer_integration_health: { Args: Record<never, never>; Returns: Json };
 retry_customer_events: { Args: { p_ids: string[] }; Returns: number };
 get_fms_customer_link: { Args: { p_instance_id: string }; Returns: string | null };
 reconcile_customer_submissions: { Args: { p_mapping_id: string; p_ids: string[]; p_apply?: boolean; p_expected_digest?: string | null }; Returns: Json };
 export_customer_stage_answers: { Args: { p_filters?: Json; p_before?: string | null; p_before_id?: string | null; p_limit?: number }; Returns: Json };
};

type ReadOnlyTable<Row>={Row:Row;Insert:never;Update:never;Relationships:[]};
export type CustomerIntegrationTables={
 form_customer_mapping_versions:ReadOnlyTable<{id:string;tenant_id:string;template_id:string;version:number;descriptor:Json;digest:string;enabled:boolean;created_by:string;created_at:string}>;
 customer_export_layouts:ReadOnlyTable<{id:string;tenant_id:string;name:string;version:number;configuration:Json;created_by:string;created_at:string}>;
};
