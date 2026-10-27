/** Audited, explicit-selection historical reconciliation. Defaults to dry run.
 * Supply JEWELOS_URL, JEWELOS_ANON_KEY and a signed-in administrator's
 * JEWELOS_ACCESS_TOKEN through the environment; never a service-role key.
 * deno run --allow-env=JEWELOS_URL,JEWELOS_ANON_KEY,JEWELOS_ACCESS_TOKEN --allow-read --allow-net scripts/crm-fms-reconcile.ts manifest.json
 * Manifest: {mappingId,submissionIds:[...],expectedDigest?}. --apply requires the digest from the reviewed dry run.
 */
export function reconciliationManifest(value:unknown,apply:boolean):{p_mapping_id:string;p_ids:string[];p_apply:boolean;p_expected_digest:string|null}{
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid reconciliation manifest");
 const row=value as Record<string,unknown>;
 if(typeof row.mappingId!=="string"||!uuid.test(row.mappingId)||!Array.isArray(row.submissionIds)||!row.submissionIds.length||row.submissionIds.length>200||!row.submissionIds.every((id):id is string=>typeof id==="string"&&uuid.test(id))||new Set(row.submissionIds).size!==row.submissionIds.length)throw new Error("Select 1–200 distinct source submissions and one reviewed mapping");
 const digest=typeof row.expectedDigest==="string"&&/^[0-9a-f]{64}$/.test(row.expectedDigest)?row.expectedDigest:null;
 if(apply&&!digest)throw new Error("Apply requires the sourceDigest from a reviewed dry run");
 return {p_mapping_id:row.mappingId,p_ids:row.submissionIds,p_apply:apply,p_expected_digest:digest};
}
if(import.meta.main){
 const path=Deno.args.find(value=>!value.startsWith("--"));if(!path)throw new Error("Provide a reconciliation manifest; default is dry run");
 const body=reconciliationManifest(JSON.parse(await Deno.readTextFile(path)),Deno.args.includes("--apply"));
 const url=Deno.env.get("JEWELOS_URL"),anon=Deno.env.get("JEWELOS_ANON_KEY"),token=Deno.env.get("JEWELOS_ACCESS_TOKEN");
 if(!url||!anon||!token)throw new Error("Administrator session and public project configuration are required");
 const response=await fetch(new URL("/rest/v1/rpc/reconcile_customer_submissions",url),{method:"POST",headers:{apikey:anon,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
 if(!response.ok)throw new Error(`Reconciliation refused (${response.status}); review authorization or source drift`);
 const value:unknown=await response.json();if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid reconciliation result");
 const result=value as Record<string,unknown>;
 // Print only approved counts and the review fingerprint. Never source answers or identifiers.
 console.log(JSON.stringify(Object.fromEntries(["dryRun","selected","eligible","existing","invalid","emitted","unmapped","sourceDigest"].map(key=>[key,result[key]])),null,2));
}
