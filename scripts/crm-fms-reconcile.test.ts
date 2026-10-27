import {assertEquals,assertThrows} from "jsr:@std/assert@1";
import {reconciliationManifest} from "./crm-fms-reconcile.ts";
const id="20261027-0000-4000-8000-000000000001";
Deno.test("historical reconciliation defaults to explicit bounded dry run",()=>{
 assertEquals(reconciliationManifest({mappingId:id,submissionIds:[id]},false),{p_mapping_id:id,p_ids:[id],p_apply:false,p_expected_digest:null});
 assertThrows(()=>reconciliationManifest({mappingId:id,submissionIds:[id,id]},false));
 assertThrows(()=>reconciliationManifest({mappingId:id,submissionIds:[]},false));
});
Deno.test("historical apply requires the reviewed source fingerprint",()=>{
 assertThrows(()=>reconciliationManifest({mappingId:id,submissionIds:[id]},true));
 assertEquals(reconciliationManifest({mappingId:id,submissionIds:[id],expectedDigest:"a".repeat(64)},true).p_apply,true);
});
