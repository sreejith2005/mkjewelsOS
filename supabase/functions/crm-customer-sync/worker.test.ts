import { assertEquals } from "@std/assert";
import { handleCustomerSync, type CustomerSyncDeps, type CustomerDeliveryEvent } from "./worker.ts";
const event: CustomerDeliveryEvent = { id: "e1", lease_token: "lease1", mapping_id: "m1", mapping_digest: "digest", descriptor: {}, payload: { eventId: "jewelos.form.source1" } };
function fixture(response: unknown = { results: [{ event_id: "jewelos.form.source1", ok: true, outcome: "accepted", client_id: "client1" }] }) {
 const finished: unknown[] = [];const sent: unknown[] = [];let claimed = false;
 const deps: CustomerSyncDeps = { secret: "test", gateway: { claim: () => Promise.resolve(claimed ? [] : (claimed=true,[event])), finish: (_id,_lease,result,error) => { finished.push({ result,error });return Promise.resolve(error ? "retry" : result?.outcome === "review" ? "review" : "delivered"); } },
  receiver: { post: body => { sent.push(body);return Promise.resolve({ status: 200,body:body.kind==="customer.mappings" ? { results:[{mapping_id:"m1",ok:true}] } : response }); } } };
 return { deps,finished,sent };
}
const request = (secret="test") => new Request("https://local.test",{method:"POST",headers:{"x-cron-secret":secret}});
Deno.test("unauthorized sender cannot claim work",async()=>{const f=fixture();assertEquals((await handleCustomerSync(request("bad"),f.deps)).status,401);assertEquals(f.sent.length,0);});
Deno.test("mapping registration precedes immutable event delivery",async()=>{const f=fixture();const response=await handleCustomerSync(request(),f.deps);assertEquals(response.status,200);assertEquals(f.sent.map(x=>(x as {kind:string}).kind),["customer.mappings","customer.events"]);assertEquals(f.finished,[{result:{event_id:"jewelos.form.source1",ok:true,outcome:"accepted",client_id:"client1"},error:null}]);});
Deno.test("missing destination result never acknowledges delivery",async()=>{const f=fixture({results:[]});await handleCustomerSync(request(),f.deps);assertEquals(f.finished,[{result:null,error:"no_result"}]);});
Deno.test("accepted response must include customer identity",async()=>{const f=fixture({results:[{event_id:"jewelos.form.source1",ok:true,outcome:"accepted"}]});await handleCustomerSync(request(),f.deps);assertEquals(f.finished,[{result:null,error:"invalid_ack"}]);});
Deno.test("review is durable and does not masquerade as delivery",async()=>{const f=fixture({results:[{event_id:"jewelos.form.source1",ok:true,outcome:"review",reason:"ambiguous_phone"}]});const body=await(await handleCustomerSync(request(),f.deps)).json();assertEquals(body.review,1);assertEquals(body.delivered,0);});
Deno.test("network timeout keeps leased source event for retry",async()=>{const f=fixture();f.deps.receiver!.post=()=>Promise.reject(new Error("synthetic network failure"));await handleCustomerSync(request(),f.deps);assertEquals(f.finished,[{result:null,error:"network"}]);});
Deno.test("unconfigured sender fails without consuming work",async()=>{assertEquals((await handleCustomerSync(request(),{secret:"test",gateway:null,receiver:null})).status,503);});
Deno.test("stage delivered before its starter is retried automatically",async()=>{const f=fixture({results:[{event_id:"jewelos.form.source1",ok:true,outcome:"retry",reason:"journey_pending"}]});await handleCustomerSync(request(),f.deps);assertEquals(f.finished,[{result:null,error:"dependency_pending"}]);});
