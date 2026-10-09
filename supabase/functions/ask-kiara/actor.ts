import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorClient } from "./tools/index.ts";

/**
 * The caller's client: a supabase-js client built from the anon key and the
 * caller's JWT (never the service role), so every read runs under RLS and the
 * section RPCs' own checks. Used by the function and by the local integration
 * test, so both exercise the same read path.
 */
export function createActorClient(client: SupabaseClient): ActorClient {
  return {
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args ?? {});
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    // Reads under the caller's RLS. Filter values travel as PostgREST
    // parameters; nothing typed by a user becomes filter syntax.
    select: async (table, query) => {
      let builder = client.from(table).select(query.columns, query.count ? { count: "exact" } : undefined);
      for (const filter of query.filters ?? []) {
        if ("values" in filter) {
          if (filter.op === "in") builder = builder.in(filter.column, [...filter.values]);
          else if (filter.op === "contains") builder = builder.contains(filter.column, [...filter.values]);
          else {
            // Only fixed status words reach here; anything else is refused rather than quoted.
            if (!filter.values.every((value) => /^[a-z_]+$/.test(value))) throw new Error("Unsupported notIn value");
            builder = builder.not(filter.column, "in", `(${filter.values.join(",")})`);
          }
        } else if (filter.op === "ilike") builder = builder.ilike(filter.column, filter.value);
        else builder = builder.filter(filter.column, filter.op, filter.value);
      }
      for (const order of query.order ?? []) builder = builder.order(order.column, { ascending: order.ascending });
      const { data, error, count } = await builder.limit(query.limit);
      return { data, count: count ?? null, error: error ? { code: error.code, message: error.message } : null };
    },
  };
}
