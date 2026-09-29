"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { ExistingClientWalkinAction } from "@/components/existing-client-walkin-action";
import { displayDate, nullable, phoneDigits, stringArray } from "@/lib/clients";
import { isPotentialCategory, POTENTIAL_CATEGORIES, potentialStars } from "@/lib/client-potential";
import type { Json } from "@/lib/supabase/database.types";
import type { Client } from "@/lib/supabase/app-types";
const schema = z.object({
  primary_name: z.string().trim().min(1).max(160),
  primary_phone: z
    .string()
    .refine(
      (value) => phoneDigits(value).length === 10,
      "Enter a 10-digit phone",
    ),
  secondary_phone: z.string(),
  billing_phone: z.string(),
  other_names: z.string(),
  other_known_phones: z.string(),
  gender: z.string(),
  country: z.string(),
  state: z.string(),
  city: z.string(),
  city_other: z.string(),
  pincode: z.string(),
  address: z.string(),
  community: z.string(),
  community_other: z.string(),
  dob: z.string(),
  anniversary: z.string(),
  beverage: z.string(),
  sugar: z.string(),
  snack: z.string(),
  gift_history: z.string(),
  // The control below only allows the fixed tiers. Keep a retained unmatched
  // legacy value parseable until staff deliberately replace it from that list.
  client_potential_category: z.string(),
  high_potential_reason: z.string(),
  instagram_status: z.string(),
  google_review_status: z.string(),
  testimonial_status: z.string(),
  referral_status: z.string(),
  next_visit_date: z.string(),
});
type Form = z.infer<typeof schema>;
const fieldGroups: { title: string; fields: (keyof Form)[] }[] = [
  {
    title: "PERSONAL DETAILS",
    fields: [
      "primary_name",
      "other_names",
      "gender",
      "dob",
      "anniversary",
      "community",
      "community_other",
    ],
  },
  {
    title: "ADDRESS",
    fields: [
      "country",
      "state",
      "city",
      "city_other",
      "pincode",
      "address",
    ],
  },
  {
    title: "CONTACT",
    fields: [
      "primary_phone",
      "secondary_phone",
      "billing_phone",
      "other_known_phones",
    ],
  },
  {
    title: "PREFERENCES",
    fields: [
      "beverage",
      "sugar",
      "snack",
      "gift_history",
    ],
  },
  {
    title: "CRM ACTIONS",
    fields: [
      "instagram_status",
      "google_review_status",
      "testimonial_status",
      "referral_status",
      "next_visit_date",
    ],
  },
  {
    title: "POTENTIAL",
    fields: [
      "client_potential_category",
      "high_potential_reason",
    ],
  },
];
function initial(client: Client): Form {
  return {
    primary_name: client.primary_name,
    primary_phone: client.primary_phone,
    other_names: (client.other_names ?? []).join(", "),
    secondary_phone: client.secondary_phone ?? "",
    billing_phone: client.billing_phone ?? "",
    other_known_phones: (client.other_known_phones ?? []).join(", "),
    gender: client.gender ?? "",
    country: client.country ?? "",
    state: client.state ?? "",
    city: client.city ?? "",
    city_other: client.city_other ?? "",
    pincode: client.pincode ?? "",
    address: client.address ?? "",
    community: client.community ?? "",
    community_other: client.community_other ?? "",
    dob: client.dob ?? "",
    anniversary: client.anniversary ?? "",
    beverage: client.beverage ?? "",
    sugar: client.sugar ?? "",
    snack: client.snack ?? "",
    gift_history: client.gift_history
      ? JSON.stringify(client.gift_history)
      : "",
    client_potential_category: client.client_potential_category ?? "",
    high_potential_reason: client.high_potential_reason ?? "",
    instagram_status: client.instagram_status ?? "",
    google_review_status: client.google_review_status ?? "",
    testimonial_status: client.testimonial_status ?? "",
    referral_status: client.referral_status ?? "",
    next_visit_date: client.next_visit_date ?? "",
  };
}
function label(field: string) {
  return field.replaceAll("_", " ");
}
function LegacyProfileCard({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return <section className="legacy-client-card"><h2>{title}</h2><div className="legacy-client-rows">{rows.map(([name, value]) => <div className="legacy-client-row" key={name}><span>{name}</span><b>{value || "NA"}</b></div>)}</div></section>;
}
export function ClientProfile({
  client,
  timeline,
  audit,
  lookups,
  walkinContext,
  lastBranchName,
  lastSalespersonName,
}: {
  client: Client;
  timeline: Array<{
    id: string;
    created_at: string;
    event_date: string;
    event_type: string;
    buy_status: string | null;
    crm_name: string | null;
    remark: string | null;
    branch: string | null;
    salesperson: string | null;
    seen_categories: string[];
    bought_categories: string[];
    order_categories: string[];
    product_requirement: string | null;
    reference_number: string | null;
  }>;
  audit: Array<{
    id: number;
    field_name: string;
    old_value: Json | null;
    new_value: Json | null;
    created_at: string;
    editor: string | null;
  }>;
  lookups: { beverages: string[]; snacks: string[]; sugars?: string[]; communities?: string[]; gifts?: string[] };
  walkinContext: { role: string; branchId: string | null; branches: { id: string; name: string }[] };
  lastBranchName?: string | null;
  lastSalespersonName?: string | null;
}) {
  const [values, setValues] = useState(() => initial(client));
  const [tab, setTab] = useState<"profile" | "timeline" | "audit">("profile");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = schema.parse(values);
      let gift: Json | null = null;
      if (parsed.gift_history) {
        try {
          gift = JSON.parse(parsed.gift_history) as Json;
        } catch {
          throw new Error("Gift history must be valid JSON.");
        }
      }
      const patch = {
        ...Object.fromEntries(
          Object.entries(parsed)
            .filter(
              ([key]) =>
                ![
                  "other_names",
                  "other_known_phones",
                  "gift_history",
                  "primary_phone",
                ].includes(key),
            )
            .map(([key, value]) => [
              key,
              key === "dob" ||
              key === "anniversary" ||
              key === "next_visit_date"
                ? nullable(value)
                : nullable(value),
            ]),
        ),
        primary_phone: phoneDigits(parsed.primary_phone),
        other_names: stringArray(parsed.other_names),
        other_known_phones: stringArray(parsed.other_known_phones).map(
          phoneDigits,
        ),
        gift_history: gift,
      };
      const { data, error } = await createClient()
        .from("clients")
        .update(patch)
        .eq("client_id", client.client_id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async () => {
      setMessage("Saving…");
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["client", client.client_id], updated);
      setMessage("Saved");
      setValues(initial(updated));
      setEditing(false);
    },
    onError: () => setMessage("Could not save the profile. Check the entered values and try again."),
  });
  if (!editing) {
    const timelineRows = timeline.map((item) => <tr key={item.id}><td>{displayDate(item.created_at)}</td><td>{displayDate(item.event_date)}</td><td>{item.event_type}</td><td>{item.buy_status ?? "NA"}</td><td>{item.branch ?? "NA"}</td><td>{item.crm_name ?? "NA"}</td><td>{item.salesperson ?? "NA"}</td><td>{item.seen_categories.join(", ") || "NA"}</td><td>{item.bought_categories.join(", ") || "NA"}</td><td>{item.order_categories.join(", ") || "NA"}</td><td>{item.product_requirement ?? "NA"}</td><td>{item.remark ?? "NA"}</td><td>{item.reference_number ?? "NO REF"}</td></tr>);
    return <main className="legacy-client-profile mx-auto max-w-7xl px-5 py-7">
      <div className="legacy-profile-grid">
        <aside className="legacy-profile-left">
          <section className="legacy-client-hero"><h1>{client.primary_name}</h1><div className="legacy-client-badges"><span>{client.client_code}</span><span>{client.last_buy_status ?? "NA"}</span><span>{client.city ?? "NA"}</span></div><div className="legacy-client-hero-actions"><ExistingClientWalkinAction clientId={client.client_id} primaryName={client.primary_name} primaryPhone={client.primary_phone} role={walkinContext.role} branchId={walkinContext.branchId} branches={walkinContext.branches} /><button type="button" onClick={() => setEditing(true)}>EDIT PROFILE</button></div></section>
          <LegacyProfileCard title="CONTACT" rows={[["PRIMARY PHONE", client.primary_phone], ["SECONDARY PHONE", client.secondary_phone ?? ""], ["BILLING PHONE", client.billing_phone ?? ""], ["OTHER KNOWN PHONES", client.other_known_phones?.join(", ") ?? ""]]} />
          <LegacyProfileCard title="PREFERENCES" rows={[["BEVERAGE", client.beverage ?? ""], ["SUGAR", client.sugar ?? ""], ["SNACK", client.snack ?? ""], ["GIFT HISTORY", client.gift_history ? JSON.stringify(client.gift_history) : ""]]} />
          <LegacyProfileCard title="CRM ACTIONS" rows={[["INSTAGRAM STATUS", client.instagram_status ?? ""], ["GOOGLE REVIEW STATUS", client.google_review_status ?? ""], ["TESTIMONIAL STATUS", client.testimonial_status ?? ""], ["REFERRAL STATUS", client.referral_status ?? ""], ["NEXT VISIT DATE", displayDate(client.next_visit_date)]]} />
        </aside>
        <section className="legacy-profile-content">
          <div className="legacy-profile-pairs">
            <LegacyProfileCard title="PERSONAL DETAILS" rows={[["PRIMARY NAME", client.primary_name], ["OTHER NAMES", client.other_names?.join(", ") ?? ""], ["GENDER", client.gender ?? ""], ["DOB", displayDate(client.dob)], ["ANNIVERSARY", displayDate(client.anniversary)], ["COMMUNITY", client.community ?? ""], ["COMMUNITY OTHER", client.community_other ?? ""]]} />
            <LegacyProfileCard title="ADDRESS" rows={[["COUNTRY", client.country ?? ""], ["STATE", client.state ?? ""], ["CITY", client.city ?? ""], ["CITY OTHER", client.city_other ?? ""], ["PINCODE", client.pincode ?? ""], ["ADDRESS", client.address ?? ""]]} />
            <LegacyProfileCard title="VISIT STATISTICS" rows={[["FIRST VISIT DATE", displayDate(client.first_visit_date)], ["LAST VISIT DATE", displayDate(client.last_visit_date)], ["TOTAL VISITS", String(client.total_visits)], ["TOTAL PURCHASE VISITS", String(client.total_purchase_visits)], ["TOTAL NON PURCHASE VISITS", String(client.total_non_purchase_visits)], ["TOTAL REPAIR VISITS", String(client.total_repair_visits)], ["TOTAL ORDER VISITS", String(client.total_order_visits)]]} />
            <LegacyProfileCard title="LAST VISIT INFORMATION" rows={[["LAST BUY STATUS", client.last_buy_status ?? ""], ["LAST BRANCH", lastBranchName ?? ""], ["LAST CRM", client.last_crm_name ?? ""], ["LAST SALESPERSON", lastSalespersonName ?? ""], ["LAST REMARK", client.last_remark ?? ""], ["LAST PRODUCT REQUIREMENT", client.last_product_requirement ?? ""]]} />
            <LegacyProfileCard title="PRODUCT INTERESTS" rows={[["LAST SEEN CATEGORIES", client.last_seen_categories?.join(", ") ?? ""], ["LAST BOUGHT CATEGORIES", client.last_bought_categories?.join(", ") ?? ""], ["LAST ORDER CATEGORIES", client.last_order_categories?.join(", ") ?? ""]]} />
            <LegacyProfileCard title="POTENTIAL" rows={[["CLIENT POTENTIAL CATEGORY", client.client_potential_category ?? ""], ["HIGH POTENTIAL REASON", client.high_potential_reason ?? ""], ["PROFILE LAST UPDATED ON", displayDate(client.profile_updated_at)]]} />
          </div>
          <section className="legacy-timeline-card"><h2>FULL TIMELINE HISTORY</h2><div className="overflow-x-auto"><table><thead><tr>{["TIMESTAMP", "CLIENT VISIT DATE", "EVENT TYPE", "BUY STATUS", "BRANCH", "CRM", "SALESPERSON", "SEEN", "BOUGHT", "ORDER", "PRODUCT REQUIREMENT", "REMARK", "REFERENCE NUMBER"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{timelineRows.length ? timelineRows : <tr><td colSpan={13}>NO TIMELINE FOUND.</td></tr>}</tbody></table></div></section>
          <section className="legacy-audit-card"><h2>PROFILE EDIT LOG</h2>{audit.length ? <div className="overflow-x-auto"><table><thead><tr><th>FIELD</th><th>OLD VALUE</th><th>NEW VALUE</th><th>UPDATED BY</th><th>UPDATED ON</th></tr></thead><tbody>{audit.map((item) => <tr key={item.id}><td>{label(item.field_name)}</td><td>{JSON.stringify(item.old_value)}</td><td>{JSON.stringify(item.new_value)}</td><td>{item.editor ?? "SYSTEM"}</td><td>{displayDate(item.created_at)}</td></tr>)}</tbody></table></div> : <p>NO PROFILE EDITS YET.</p>}</section>
        </section>
      </div>
    </main>;
  }
  return (
    <main className="mx-auto max-w-7xl px-5 py-7">
      <div className="legacy-profile-hero flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{client.primary_name}</h1>
          <p className="mt-1 text-stone-600">
            {client.primary_phone} <button type="button" aria-label="Copy primary phone" className="ml-1 rounded border px-1 text-xs" onClick={() => void navigator.clipboard.writeText(client.primary_phone)}>Copy</button> · {client.gender ?? "Gender not set"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => { setEditing(false); setValues(initial(client)); setMessage(""); }}>Cancel edit</button>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900">
            Potential: {client.client_potential_category ?? "Not set"}
            {potentialStars(client.client_potential_category) ? ` ${potentialStars(client.client_potential_category)}` : ""}
          </span>
        </div>
      </div>
      <div className="legacy-last-visit mt-4 grid gap-3 rounded-xl border bg-white p-4 text-sm md:grid-cols-3">
        <p>
          <b>Last visit</b>
          <br />
          {displayDate(client.last_visit_date)}
        </p>
        <p>
          <b>Last branch</b>
          <br />
          {client.last_branch_id ?? "—"}
        </p>
        <p>
          <b>Last buy status</b>
          <br />
          {client.last_buy_status ?? "—"}
        </p>
      </div>
      <div className="mt-6 flex gap-4 border-b">
        <button
          onClick={() => setTab("profile")}
          className={
            tab === "profile"
              ? "border-b-2 border-amber-700 pb-2 font-semibold"
              : "pb-2"
          }
        >
          Profile
        </button>
        <button
          onClick={() => setTab("timeline")}
          className={
            tab === "timeline"
              ? "border-b-2 border-amber-700 pb-2 font-semibold"
              : "pb-2"
          }
        >
          Timeline
        </button>
        <button
          onClick={() => setTab("audit")}
          className={
            tab === "audit"
              ? "border-b-2 border-amber-700 pb-2 font-semibold"
              : "pb-2"
          }
        >
          Audit log
        </button>
      </div>
      {tab === "profile" && (
        <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-5">
            {fieldGroups.map((group) => (
              <section
                className="rounded-xl border bg-white p-5"
                key={group.title}
              >
                <h2 className="font-semibold">{group.title}</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {group.fields.map((field) => (
                    <label
                      className={
                        field === "address" || field === "gift_history"
                          ? "md:col-span-2"
                          : ""
                      }
                      key={field}
                    >
                      <span className="mb-1 block text-xs font-medium capitalize text-stone-600">
                        {label(field)}
                        {field === "primary_name" || field === "primary_phone"
                          ? " *"
                          : ""}
                      </span>
                      {field === "client_potential_category" ? (
                        <select
                          className="w-full rounded border p-2"
                          value={values.client_potential_category}
                          onChange={(event) =>
                            setValues({
                              ...values,
                              client_potential_category: event.target.value as Form["client_potential_category"],
                            })
                          }
                        >
                          {!isPotentialCategory(values.client_potential_category) && values.client_potential_category ? (
                            <option value={values.client_potential_category} disabled>
                              Legacy value: {values.client_potential_category} (needs review)
                            </option>
                          ) : null}
                          <option value="">Not set</option>
                          {POTENTIAL_CATEGORIES.map((category) => (
                            <option value={category} key={category}>
                              {category} {potentialStars(category)}
                            </option>
                          ))}
                        </select>
                      ) : field === "gender" ? (
                        <select
                          aria-label="Gender"
                          className="w-full rounded border p-2"
                          value={values.gender}
                          onChange={(event) =>
                            setValues({ ...values, gender: event.target.value })
                          }
                        >
                          <option value="">Choose</option>
                          {["FEMALE", "MALE", "OTHER"].map((option) => (
                            <option value={option} key={option}>{option}</option>
                          ))}
                        </select>
                      ) : field === "beverage" || field === "snack" || field === "sugar" || field === "community" ? (
                        <select
                          aria-label={field === "sugar" ? "Sugar" : label(field)}
                          className="w-full rounded border p-2"
                          value={values[field]}
                          onChange={(event) =>
                            setValues({ ...values, [field]: event.target.value })
                          }
                        >
                          <option value="">Choose</option>
                          {!(field === "beverage" ? lookups.beverages : field === "snack" ? lookups.snacks : field === "sugar" ? (lookups.sugars ?? []) : (lookups.communities ?? [])).includes(values[field]) && values[field] ? (
                            <option value={values[field]}>{values[field]} (legacy)</option>
                          ) : null}
                          {(field === "beverage" ? lookups.beverages : field === "snack" ? lookups.snacks : field === "sugar" ? (lookups.sugars ?? []) : (lookups.communities ?? [])).map((option) => (
                            <option value={option} key={option}>{option}</option>
                          ))}
                        </select>
                      ) : field === "city_other" && values.city.trim().toUpperCase() !== "OTHER" ? null : field === "community_other" && !values.community.trim().toUpperCase().startsWith("OTHER") ? null : field === "address" || field === "gift_history" ? (
                        <textarea
                          className="w-full rounded border p-2"
                          rows={field === "gift_history" ? 3 : 2}
                          value={values[field]}
                          onChange={(event) =>
                            setValues({
                              ...values,
                              [field]: event.target.value,
                            })
                          }
                        />
                      ) : (
                        <input
                          className="w-full rounded border p-2"
                          type={
                            field === "dob" ||
                            field === "anniversary" ||
                            field === "next_visit_date"
                              ? "date"
                              : "text"
                          }
                          inputMode={field === "primary_phone" || field === "secondary_phone" || field === "billing_phone" ? "numeric" : undefined}
                          value={values[field]}
                          onChange={(event) =>
                            setValues({
                              ...values,
                              [field]: event.target.value,
                            })
                          }
                        />
                      )}
                    </label>
                  ))}
                </div>
              </section>
            ))}
            <button
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="rounded bg-amber-800 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              Save profile
            </button>
            <span
              className={
                message === "Saved"
                  ? "ml-3 text-green-700"
                  : "ml-3 text-red-700"
              }
            >
              {message}
            </span>
          </div>
          <aside className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">Visit rollups</h2>
            {[
              ["Total visits", client.total_visits],
              ["Purchases", client.total_purchase_visits],
              ["Non-purchase", client.total_non_purchase_visits],
              ["Repairs", client.total_repair_visits],
              ["Orders", client.total_order_visits],
              ["First visit", displayDate(client.first_visit_date)],
              ["Last visit", displayDate(client.last_visit_date)],
            ].map(([name, value]) => (
              <p
                className="mt-3 flex justify-between text-sm"
                key={String(name)}
              >
                <span>{name}</span>
                <b>{value}</b>
              </p>
            ))}
          </aside>
        </section>
      )}
      {tab === "timeline" && (
        <section className="mt-6 overflow-hidden rounded-xl border bg-white">
          {timeline.length ? (
            timeline.map((item) => (
              <article className="border-b p-4" key={item.id}>
                <b>
                  {displayDate(item.event_date)} · {item.event_type}
                </b>
                <p className="text-sm text-stone-600">
                  {item.buy_status ?? "No buy status"} ·{" "}
                  {item.branch ?? "Unknown branch"} ·{" "}
                  {item.salesperson ?? item.crm_name ?? "—"}
                </p>
                {item.remark && <p className="mt-1">{item.remark}</p>}
                <p className="mt-1 text-sm text-stone-600">Seen: {item.seen_categories.join(", ") || "—"} · Bought: {item.bought_categories.join(", ") || "—"} · Order: {item.order_categories.join(", ") || "—"}</p>
                <p className="mt-1 text-sm text-stone-600">Product requirement: {item.product_requirement ?? "—"} · Reference number: {item.reference_number ?? "—"} · {item.reference_number ? "Legacy edit eligible" : "No ref"}</p>
              </article>
            ))
          ) : (
            <p className="p-5 text-stone-600">No history yet.</p>
          )}
        </section>
      )}
      {tab === "audit" && (
        <section className="mt-6 overflow-hidden rounded-xl border bg-white">
          {audit.length ? (
            audit.map((item) => (
              <article
                className="grid gap-1 border-b p-4 text-sm md:grid-cols-[180px_1fr_1fr_160px]"
                key={item.id}
              >
                <b>{label(item.field_name)}</b>
                <span className="break-all text-stone-600">
                  {JSON.stringify(item.old_value)}
                </span>
                <span className="break-all text-stone-900">
                  {JSON.stringify(item.new_value)}
                </span>
                <span className="text-stone-500">
                  {item.editor ?? "System"}
                  <br />
                  {displayDate(item.created_at)}
                </span>
              </article>
            ))
          ) : (
            <p className="p-5 text-stone-600">No profile edits yet.</p>
          )}
        </section>
      )}
    </main>
  );
}
