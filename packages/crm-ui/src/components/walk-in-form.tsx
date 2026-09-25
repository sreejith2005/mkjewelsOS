"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

import { phoneDigits } from "@/lib/clients";
import { isPotentialCategory, POTENTIAL_CATEGORIES } from "@/lib/client-potential";
import { createClient } from "@/lib/supabase/client";
import { lookupClientByPhone } from "@/lib/client-phone-lookup";
import type { Client } from "@/lib/supabase/app-types";

type Queue = {
  id: string;
  client_name: string;
  mobile: string;
  branch_id: string;
  assigned_crm_name: string | null;
  client_id: string | null;
  client_is_new?: boolean;
  status: string;
} | null;
type Companion = { name: string; mobile: string; relation: string };
type Proof = {
  path: string;
  clientId: string;
  fileName: string;
  mimeType: string;
  status: "uploading" | "ready" | "error";
  error?: string;
};
type SubmitError = {
  code?: string;
  message?: string;
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE_PROOF_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
]);
const TESTIMONIAL_VIDEO_MIME_TYPES = new Set([
  "video/mp4", "video/webm", "video/quicktime",
]);
const IMAGE_PROOF_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.heif";
const TESTIMONIAL_VIDEO_ACCEPT = ".mp4,.webm,.mov";
const IMAGE_PROOF_DESCRIPTION = "JPEG, PNG, WebP, HEIC, or HEIF image";
const TESTIMONIAL_PROOF_DESCRIPTION = `${IMAGE_PROOF_DESCRIPTION}, MP4, MOV, or WebM video`;
const inputClass = "mt-1 w-full rounded border border-stone-300 bg-white p-2";
const sections = [
  "CLIENT DETAILS", "FAMILY / FRIENDS WITH CLIENT", "VISIT DETAILS",
  "CRM APPROACH", "PREFERENCES", "REMARK",
] as const;
const LEGACY_VISIT_STATUSES = [
  "YES", "NO", "REPAIR_PLACED", "REPAIR_PICKUP", "ORDER_PLACED",
  "ORDER_PICKUP", "PRODUCT_EXCHANGE", "PRODUCT_RETURN", "STORE_VISIT", "PRICE_CALCULATION",
];
const LEGACY_WEDDING_MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const LEGACY_COMMUNICATION_PREFERENCES = [
  "CALL", "WHATSAPP CALLS", "WHATSAPP MESSAGE", "DON'T CONTACT",
];
function legacyWeddingMonthNumber(value: string) {
  const index = LEGACY_WEDDING_MONTHS.indexOf(value);
  return index === -1 ? value : String(index + 1);
}
function istDateTimeLocal(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
function initialValue(
  client: Client | null,
  queue: Queue,
  branchId: string,
  crmName: string,
) {
  return {
    client_id: client?.client_id ?? queue?.client_id ?? "",
    entry_queue_id: queue?.id ?? "",
    event_date: istDateTimeLocal(),
    branch_id: queue?.branch_id ?? branchId,
    crm_name: queue?.assigned_crm_name ?? crmName,
    primary_name: client?.primary_name ?? queue?.client_name ?? "",
    primary_phone: client?.primary_phone ?? queue?.mobile ?? "",
    billing_phone: client?.billing_phone ?? "",
    gender: client?.gender?.toUpperCase() ?? "",
    country: client?.country ?? "India",
    state: client?.state ?? "",
    city: client?.city ?? "",
    city_other: client?.city_other ?? "",
    pincode: client?.pincode ?? "",
    address: client?.address ?? "",
    community: client?.community ?? "",
    community_other: client?.community_other ?? "",
    dob: client?.dob ?? "",
    anniversary: client?.anniversary ?? "",
    source_of_lead: "Walk-in",
    source_of_lead_other: "",
    reference_name: "",
    reference_phone: "",
    client_type: queue?.client_is_new ? "new" : client?.client_id || queue?.client_id ? "existing" : "new",
    did_buy: "",
    visit_status: "",
    not_bought_other: "",
    repair_or_order_approach: "",
    marketing_message_sent: "",
    occupation: "",
    occupation_other: "",
    bridal_or_non_bridal: "",
    wedding_month: "",
    wedding_year: "",
    communication_preference: "",
    beverage: client?.beverage ?? "",
    sugar: client?.sugar ?? "",
    snack: client?.snack ?? "",
    beverage_other: "",
    sugar_other: "",
    snack_other: "",
    gift: "",
    gift_other: "",
    next_visit_date: client?.next_visit_date ?? "",
    client_potential_category: client?.client_potential_category ?? "",
    high_potential_reason: client?.high_potential_reason ?? "",
    remark: "",
    product_requirement: "",
    other_store_client_wants_to_visit: "",
    categories_client_wants_more: "",
    seen_categories: "",
    bought_categories: "",
    order_categories: "",
    seen_other: "",
    bought_other: "",
    order_other: "",
    salesperson_handled: "",
    salesperson: "",
    new_things_choice: "",
    other_order: "",
    came_for_categories: "",
    came_for_other: "",
    new_things_categories: "",
    new_things_other: "",
    referrals_count: "",
    companions_count: "",
    seen_count: "",
    bought_count: "",
    order_count: "",
    camefor_count: "",
    new_things_count: "",
  };
}
function asList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
function storageFileName(storagePath: string, fallback: string) {
  const leaf = storagePath.split("/").at(-1) ?? "";
  return leaf.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_(.+)$/i, "$1") || fallback;
}
function walkInSubmitErrorMessage(error: SubmitError | null) {
  if (error?.code === "23505") {
    return "This client record could not be updated. Please try submitting the visit again.";
  }
  if (error?.code === "42501") {
    return "You are not allowed to submit a visit to the selected branch.";
  }
  if (error?.code === "23514") {
    const detail = error.message ?? "";
    if (/documents_(storage_path|file_name)_check/i.test(detail)) {
      return "This proof file name is invalid. Remove and add that proof again before submitting.";
    }
    if (/wedding_(month|year)_check/i.test(detail)) {
      return "Wedding month or year is invalid. Select the wedding details again before submitting.";
    }
    if (/client potential category/i.test(detail)) {
      return "Choose one of the listed client potential categories before submitting.";
    }
    return "Some form details are invalid. Recheck the wedding details and client potential category, then submit again.";
  }
  return "We could not save this visit. Please try again; if it persists, contact an administrator.";
}
export function WalkInForm({
  profile,
  branches,
  crms,
  crmByBranch,
  queue,
  client,
  lookups = {
    productCategories: [],
    notBoughtReasons: [],
    beverages: [],
    snacks: [],
    relations: [], sugarOptions: [], sourceOfLeads: [], communities: [], gifts: [],
  },
}: {
  profile: { role: string; branchId: string | null; name: string };
  branches: { id: string; name: string }[];
  crms: string[];
  crmByBranch?: Record<string, string[]>;
  queue: Queue;
  client: Client | null;
  lookups?: {
    productCategories: string[];
    notBoughtReasons: string[];
    beverages: string[];
    snacks: string[];
    relations?: string[]; sugarOptions?: string[]; sourceOfLeads?: string[]; communities?: string[]; gifts?: string[];
  };
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState(() =>
    initialValue(client, queue, profile.branchId ?? "", profile.name),
  );
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [referrals, setReferrals] = useState<{ name: string; mobile: string }[]>([]);
  const [notBoughtReasons, setNotBoughtReasons] = useState<string[]>([]);
  const [engagement, setEngagement] = useState<
    Record<string, { asked: string; no_reason: string }>
  >({});
  const [productTags, setProductTags] = useState<Record<string, string[]>>({});
  const [remarkPhotoSlots, setRemarkPhotoSlots] = useState(1);
  const [proofs, setProofs] = useState<Record<string, Proof>>({});
  const [proposedClientId, setProposedClientId] = useState(
    () => client?.client_id ?? queue?.client_id ?? crypto.randomUUID(),
  );
  const [proposedTimelineId] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState("");
  const activeCrms = crmByBranch?.[values.branch_id] ?? crms;
  const [saving, setSaving] = useState(false);
  const submitWasExplicit = useRef(false);
  const [billingMatchesPrimary, setBillingMatchesPrimary] = useState(
    () => Boolean(client?.billing_phone && phoneDigits(client.billing_phone) === phoneDigits(client.primary_phone)),
  );
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(
    () => new Set(client ? ["primary_name", "gender", "dob", "community", "address", "pincode"] : []),
  );
  const set = (key: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const engagementKinds = [
    ["instagram", "Instagram follow", ["YES", "NO", "CLIENT_NOT_INTERESTED", "CLIENT_ALREADY_FOLLOWING_US"]],
    ["google_review", "Google review", ["YES", "NO", "ALREADY_DONE", "NOT_INTERESTED"]],
    ["testimonial", "Testimonial", ["YES", "NO", "NOT_INTERESTED"]],
    ["feedback_form", "Feedback form", ["YES", "NO", "NOT_INTERESTED"]],
    ["thank_you_note", "Thank-you note", ["YES", "NO"]],
    ["referrals", "Referrals", ["YES", "NO", "NOT_INTERESTED"]],
  ] as const;
  useEffect(() => {
    if (phoneDigits(values.primary_phone).length !== 10) return;
    const timer = window.setTimeout(() => {
      void lookupClientByPhone(values.primary_phone).then((matched) => {
        if (!matched) {
          if (!queue?.client_id && !client?.client_id) {
            setValues((current) => ({ ...current, client_id: "", client_type: "new" }));
          }
          setAutoFilledFields(new Set());
          return;
        }
        const fields = ["primary_name", "gender", "dob", "community", "address", "pincode", "country", "state", "city"];
        setValues((current) => ({ ...current, client_id: matched.client_id, client_type: queue?.client_is_new && matched.client_id === queue.client_id ? "new" : "existing", primary_name: matched.primary_name, gender: matched.gender?.toUpperCase() ?? "", dob: matched.dob ?? "", community: matched.community ?? "", address: matched.address ?? "", pincode: matched.pincode ?? "", country: matched.country ?? "", state: matched.state ?? "", city: matched.city ?? "" }));
        setProposedClientId(matched.client_id);
        setAutoFilledFields(new Set(fields));
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [client?.client_id, queue?.client_id, values.primary_phone]);
  useEffect(() => {
    const pincode = values.pincode.trim();
    if (!/^\d{6}$/.test(pincode)) return;
    let cancelled = false;
    void createClient()
      .from("lookup_pincodes")
      .select("city,state,country")
      .eq("pincode", pincode)
      .eq("active", true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        const fields = ["city", "state", "country"];
        setValues((current) => ({
          ...current,
          city: data.city ?? current.city,
          state: data.state ?? current.state,
          country: data.country ?? current.country,
        }));
        setAutoFilledFields((current) => new Set([...current, ...fields]));
      });
    return () => { cancelled = true; };
  }, [values.pincode]);
  async function removeProof(key: string) {
    const proof = proofs[key];
    if (!proof) return;
    await createClient().storage.from("crm-legacy-documents") /* crm-port: bucket crm-documents -> crm-legacy-documents (0184) */.remove([proof.path]);
    setProofs((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  async function uploadProof(key: string, file: File | undefined) {
    if (!file) return;
    const allowsVideo = key === "testimonial";
    const allowedMimeTypes = allowsVideo
      ? new Set([...IMAGE_PROOF_MIME_TYPES, ...TESTIMONIAL_VIDEO_MIME_TYPES])
      : IMAGE_PROOF_MIME_TYPES;
    if (!allowedMimeTypes.has(file.type.toLowerCase())) {
      setProofs((current) => ({
        ...current,
        [key]: {
          path: "",
          clientId: "",
          fileName: file.name,
          mimeType: file.type,
          status: "error",
          error: `Only ${allowsVideo ? TESTIMONIAL_PROOF_DESCRIPTION : IMAGE_PROOF_DESCRIPTION} files are allowed.`,
        },
      }));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setProofs((current) => ({
        ...current,
        [key]: {
          path: "",
          clientId: "",
          fileName: file.name,
          mimeType: file.type,
          status: "error",
          error: "File must be 10MB or smaller.",
        },
      }));
      return;
    }
    // A phone lookup may still be in flight when the staff member reaches the
    // engagement section. Resolve it here as well, before committing the
    // immutable Storage path, so existing-client proofs use the actual client
    // UUID rather than the temporary UUID reserved for a new client.
    let proofClientId = client?.client_id || queue?.client_id || "";
    if (!proofClientId) {
      const matched = await lookupClientByPhone(values.primary_phone);
      if (matched) {
        proofClientId = matched.client_id;
        setProposedClientId(matched.client_id);
        setValues((current) => ({ ...current, client_id: matched.client_id, client_type: queue?.client_is_new && matched.client_id === queue.client_id ? "new" : "existing" }));
      } else {
        setValues((current) => ({ ...current, client_id: "", client_type: "new" }));
      }
    }
    proofClientId ||= proposedClientId;
    await removeProof(key);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${proofClientId}/${proposedTimelineId}/${crypto.randomUUID()}_${safeName}`;
    setProofs((current) => ({
      ...current,
      [key]: {
        path,
        clientId: proofClientId,
        fileName: file.name,
        mimeType: file.type,
        status: "uploading",
      },
    }));
    const { error } = await createClient()
      .storage.from("crm-legacy-documents") /* crm-port: bucket crm-documents -> crm-legacy-documents (0184) */
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      setProofs((current) => ({
        ...current,
        [key]: {
          path,
          clientId: proofClientId,
          fileName: file.name,
          mimeType: file.type,
          status: "error",
          error: "Upload failed. Try again.",
        },
      }));
      return;
    }
    setProofs((current) => ({
      ...current,
      [key]: {
        path,
        clientId: proofClientId,
        fileName: file.name,
        mimeType: file.type,
        status: "ready",
      },
    }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!submitWasExplicit.current) {
      setMessage("Use Submit complete visit to save this form.");
      return;
    }
    submitWasExplicit.current = false;
    if (
      !values.primary_name.trim() ||
      phoneDigits(values.primary_phone).length !== 10 ||
      !values.branch_id
    ) {
      setMessage("Name, 10-digit phone, and branch are required.");
      setStep(0);
      return;
    }
    const minimalVisit = ["STORE_VISIT", "PRICE_CALCULATION"].includes(values.visit_status);
    const missingEngagementAnswer = !minimalVisit && engagementKinds.find(([key]) => !engagement[key]?.asked);
    if (missingEngagementAnswer) {
      setMessage(`${missingEngagementAnswer[1]} must be answered.`);
      setStep(4);
      return;
    }
    const requiredProof = engagementKinds.find(
      ([key]) =>
        engagement[key]?.asked === "YES" && proofs[key]?.status !== "ready",
    );
    if (requiredProof) {
      setMessage(`${requiredProof[1]} needs a proof image before submission.`);
      setStep(4);
      return;
    }
    if (referrals.some((referral) => referral.name.trim().length === 0 || phoneDigits(referral.mobile).length !== 10)) {
      setMessage("Every referral needs a name and 10-digit mobile number.");
      setStep(4);
      return;
    }
    const targetClientId = values.client_id || client?.client_id || queue?.client_id || proposedClientId;
    const mismatchedProof = Object.values(proofs).find(
      (proof) => proof.status === "ready" && proof.clientId !== targetClientId,
    );
    if (mismatchedProof) {
      setMessage("The mobile number changed after this proof was uploaded. Remove and add that proof again before submitting.");
      setStep(4);
      return;
    }
    const required = [
      ["billing_phone", phoneDigits(values.billing_phone).length === 10, "Billing phone"],
      ["gender", Boolean(values.gender), "Gender"],
      ["occupation", Boolean(values.occupation), "Occupation"],
      ["bridal_or_non_bridal", Boolean(values.bridal_or_non_bridal), "Bridal / non bridal"],
      ["communication_preference", Boolean(values.communication_preference), "Communication preference"],
      ["country", Boolean(values.country), "Country"],
      ["state", Boolean(values.state), "State"],
      ["city", Boolean(values.city), "City"],
      ["pincode", Boolean(values.pincode), "Pincode"],
      ["address", Boolean(values.address), "Address"],
      ["community", Boolean(values.community), "Community"],
      ["salesperson", Boolean(values.salesperson), "Salesperson"],
      ["visit_status", Boolean(values.visit_status), "Visit status"],
    ] as const;
    const invalid = required.find(([, valid]) => !valid);
    if (invalid || (values.occupation.toUpperCase() === "OTHER" && !values.occupation_other.trim()) || (values.bridal_or_non_bridal.toUpperCase() === "BRIDAL" && (!values.wedding_month || !values.wedding_year))) {
      setMessage(`${invalid?.[2] ?? "The conditional legacy fields"} is required.`);
      const planningField = ["occupation", "bridal_or_non_bridal", "communication_preference"].includes(invalid?.[0] ?? "") || (values.occupation.toUpperCase() === "OTHER" && !values.occupation_other.trim()) || (values.bridal_or_non_bridal.toUpperCase() === "BRIDAL" && (!values.wedding_month || !values.wedding_year));
      setStep(planningField ? 5 : invalid?.[0] === "visit_status" ? 3 : invalid?.[0] === "salesperson" ? 0 : 1);
      return;
    }
    if (values.visit_status === "NO" && !notBoughtReasons.length) {
      setMessage("Select at least one reason for not buying.");
      setStep(3);
      return;
    }
    if (values.visit_status === "NO" && !values.next_visit_date) {
      setMessage("Next visit date is required for Not Bought.");
      setStep(5);
      return;
    }
    setSaving(true);
    const payload = {
      ...values,
      // Prefer the resolved existing client explicitly. The database also
      // independently resolves the normalized phone as a race-safe fallback.
      client_id: values.client_id || client?.client_id || queue?.client_id || "",
      proposed_client_id: proposedClientId,
      proposed_timeline_id: proposedTimelineId,
      primary_phone: phoneDigits(values.primary_phone),
      event_date: values.event_date ? `${values.event_date}:00+05:30` : undefined,
      did_buy: values.visit_status === "YES",
      // The legacy control stores month names, while the current schema stores
      // the same month as a checked smallint.
      wedding_month: legacyWeddingMonthNumber(values.wedding_month),
      companions: companions.filter(
        (item) => item.name || item.mobile || item.relation,
      ),
      not_bought_reasons: notBoughtReasons,
      seen_categories: asList(values.seen_categories),
      bought_categories: asList(values.bought_categories),
      order_categories: asList(values.order_categories),
      documents: Object.values(proofs)
        .filter((proof) => proof.status === "ready")
        .map((proof) => ({
          storage_path: proof.path,
          // Storage paths have a filename-safe suffix. The documents check
          // intentionally requires that exact suffix, while this display name
          // may contain spaces or other characters from the user's device.
          file_name: storageFileName(proof.path, proof.fileName),
          mime_type: proof.mimeType,
        })),
      category_details: {
        seen_count: values.seen_count,
        bought_count: values.bought_count,
        order_count: values.order_count,
        camefor_count: values.camefor_count,
        new_things_count: values.new_things_count,
        seen_tags: productTags.seen ?? [],
        bought_tags: productTags.bought ?? [],
        order_tags: productTags.order ?? [],
        camefor_tags: productTags.camefor ?? [],
        new_things_tags: productTags.new_things ?? [],
        seen_other: values.seen_other,
        bought_other: values.bought_other,
        order_other: values.order_other,
        salesperson_handled: values.salesperson_handled,
        new_things_choice: values.new_things_choice,
      },
      engagement: Object.fromEntries(
        Object.entries(engagement).map(([key, item]) => [
          key,
          {
            asked: item.asked === "" ? null : item.asked === "YES",
            no_reason: item.no_reason,
          },
        ]),
      ),
      additional_fields: {
        visit_status: values.visit_status,
        other_order: values.other_order,
        came_for_categories: asList(values.came_for_categories),
        came_for_other: values.came_for_other,
        new_things_categories: asList(values.new_things_categories),
        new_things_other: values.new_things_other,
        referrals_count: values.referrals_count,
        companions_count: values.companions_count,
        salesperson: values.salesperson,
        engagement_answers: Object.fromEntries(Object.entries(engagement).map(([key, item]) => [key, item.asked])),
        referrals: referrals.filter((referral) => referral.name || referral.mobile),
        beverage_other: values.beverage_other,
        sugar_other: values.sugar_other,
        snack_other: values.snack_other,
        gift: values.gift,
        gift_other: values.gift_other,
        other_store_client_wants_to_visit:
          values.other_store_client_wants_to_visit,
        categories_client_wants_more: asList(
          values.categories_client_wants_more,
        ),
      },
    };
    const { data, error } = await createClient().rpc("submit_walkin_visit", {
      p_payload: payload,
    });
    setSaving(false);
    if (error || !data?.[0]) {
      console.error("submit_walkin_visit failed", {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        uploadedProofPaths: Object.values(proofs)
          .filter((proof) => proof.status === "ready")
          .map((proof) => proof.path),
      });
      const safeMessage = walkInSubmitErrorMessage(error);
      const invalidProof = /documents_(storage_path|file_name|mime_type)_check/i.test(error?.message ?? "");
      const hasUploadedProof = Object.values(proofs).some((proof) => proof.status === "ready");
      setMessage(`${safeMessage}${hasUploadedProof && !invalidProof ? " Uploaded proof files were kept so you do not need to add them again." : ""}`);
      return;
    }
    router.push(`/queue?completed=${encodeURIComponent(values.primary_name)}&completedClientId=${encodeURIComponent(data[0].client_id)}`);
  }
  const requiredMark = <span className="text-red-600"> *</span>;
  const field = (key: keyof typeof values, label: string, type = "text", required = false) => (
    <label className="block text-sm">
      <span>{label}{required ? requiredMark : null}</span>
      <input
        aria-label={label} type={type} required={required}
        className={`${inputClass}${autoFilledFields.has(key) ? " border-amber-400 bg-amber-50" : ""}`}
        value={values[key]}
        onChange={(event) => { set(key, event.target.value); setAutoFilledFields((current) => { const next = new Set(current); next.delete(key); return next; }); }}
      />
      {autoFilledFields.has(key) ? <small className="mt-1 block text-amber-800">Auto-filled from client history — editable</small> : null}
    </label>
  );
  const selectField = (
    key: keyof typeof values,
    label: string,
    options: string[], required = false,
  ) => (
    <label className="block text-sm">
      <span>{label}{required ? requiredMark : null}</span>
      <select
        aria-label={label} className={inputClass}
        value={values[key]} required={required}
        onChange={(event) => set(key, event.target.value)}
      >
        <option value="">Choose</option>
        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
  const multiField = (
    key: "seen_categories" | "bought_categories" | "order_categories" | "came_for_categories" | "new_things_categories" | "categories_client_wants_more",
    label: string,
  ) => (
    <fieldset className="block text-sm" aria-label={label}>
      <legend>{label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {[...lookups.productCategories, ...(!lookups.productCategories.some((option) => option.toUpperCase().startsWith("OTHER")) ? ["Other"] : [])].map((option) => {
          const selected = asList(values[key]).includes(option);
          return <label className={`cursor-pointer rounded-full border px-3 py-1.5 ${selected ? "border-amber-800 bg-amber-100" : "border-stone-300 bg-white"}`} key={option}>
            <input className="sr-only" type="checkbox" checked={selected} onChange={() => set(key, (selected ? asList(values[key]).filter((item) => item !== option) : [...asList(values[key]), option]).join(", "))} />{option}
          </label>;
        })}
      </div>
    </fieldset>
  );
  const countAndTags = (
    countKey: "seen_count" | "bought_count" | "order_count" | "camefor_count" | "new_things_count",
    tagKey: "seen" | "bought" | "order" | "camefor" | "new_things",
    label: string,
    allowNa = false,
  ) => {
    const count = Number(values[countKey]);
    const tagCount = Number.isFinite(count) && count > 0 ? count : 0;
    return <div className="grid gap-3 md:grid-cols-2"><label className="block text-sm">{label}<select aria-label={label} className={inputClass} value={values[countKey]} onChange={(event) => { const next = event.target.value; set(countKey, next); const size = Number(next); setProductTags((current) => ({ ...current, [tagKey]: Number.isFinite(size) && size > 0 ? Array.from({ length: size }, (_, index) => current[tagKey]?.[index] ?? "") : [] })); }}><option value="">Choose</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={String(index + 1)}>{index + 1}</option>)}{allowNa ? <option value="NA">NA</option> : null}</select></label>{tagCount > 0 ? <div className="grid gap-2">{Array.from({ length: tagCount }, (_, index) => <input key={index} aria-label={`${tagKey} tag ${index + 1}`} className="rounded border p-2" placeholder={`Tag / code ${index + 1}`} value={productTags[tagKey]?.[index] ?? ""} onChange={(event) => setProductTags((current) => ({ ...current, [tagKey]: Array.from({ length: tagCount }, (_, tagIndex) => tagIndex === index ? event.target.value : current[tagKey]?.[tagIndex] ?? "") }))} />)}</div> : null}</div>;
  };
  return (
    <form onSubmit={submit} className="legacy-walkin-form mt-6">
      <p className="legacy-walkin-note">COMPLETE EACH SECTION IN ORDER. CONDITIONAL QUESTIONS APPEAR ONLY WHEN THEY APPLY.</p>
      <nav className="legacy-walkin-steps" aria-label="Walk-in form sections">
        {sections.map((label, index) => (
          <button
            type="button"
            aria-label={`${index + 1}. ${["Client & visit", "Profile", "Companions", "Purchase outcome", "Engagement asks", "Preferences & planning"][index]}`}
            onClick={() => {
              const target = document.getElementById(["client-details", "family-friends", "visit-details", "crm-approach", "preferences", "remark"][index]);
              if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="legacy-walkin-step"
            key={label}
          >
            <span>{index + 1}</span>{label}
          </button>
        ))}
      </nav>
      <div className="legacy-walkin-sections mt-4">
        <section id="client-details" className="legacy-walkin-card">
          <div className="grid gap-4 md:grid-cols-2">
            <h2 className="md:col-span-2 text-lg font-semibold">
              CLIENT DETAILS {" "}
              {client ? (
                <span className="text-sm font-normal text-green-700">
                  Existing client detected
                </span>
              ) : (
                <span className="text-sm font-normal text-amber-700">
                  New client
                </span>
              )}
            </h2>
            {field("event_date", "Visit date and time", "datetime-local", true)}
            <label className="block text-sm">
              Client type
              <select
                aria-label="Client type"
                className={inputClass}
                disabled
                value={values.client_type}
              >
                <option value="existing">OLD CLIENT</option>
                <option value="new">NEW CLIENT</option>
              </select>
              <span className="mt-1 block text-xs text-stone-500">
                Derived from the client&apos;s phone lookup.
              </span>
            </label>
            {field("primary_name", "Client name", "text", true)}
            <label className="block text-sm"><span>Mobile *</span><div className="mt-1 flex rounded border border-stone-300 bg-white"><span className="border-r border-stone-300 px-3 py-2 text-stone-600">+91</span><input aria-label="Mobile *" className="min-w-0 flex-1 rounded-r p-2" inputMode="numeric" value={values.primary_phone} onChange={(event) => { setValues((current) => ({ ...current, primary_phone: event.target.value, client_id: client?.client_id || queue?.client_id || "", client_type: client?.client_id || queue?.client_id ? "existing" : "new" })); if (billingMatchesPrimary) set("billing_phone", event.target.value); setAutoFilledFields(new Set()); }} onBlur={() => { if (phoneDigits(values.primary_phone).length === 10) void lookupClientByPhone(values.primary_phone).then((matched) => { if (matched) { setValues((current) => ({ ...current, client_id: matched.client_id, client_type: "existing", primary_name: matched.primary_name, gender: matched.gender?.toUpperCase() ?? "", dob: matched.dob ?? "", community: matched.community ?? "", address: matched.address ?? "", pincode: matched.pincode ?? "", country: matched.country ?? "", state: matched.state ?? "", city: matched.city ?? "" })); setProposedClientId(matched.client_id); setAutoFilledFields(new Set(["primary_name", "gender", "dob", "community", "address", "pincode", "country", "state", "city"])); } }); }} /></div></label>
            {selectField("source_of_lead", "Source of lead", lookups.sourceOfLeads?.length ? lookups.sourceOfLeads : ["Walk-in", "Reference", "Instagram", "Google", "WhatsApp", "Advertisement", "Other"], true)}
            {values.source_of_lead.trim().toUpperCase() === "REFERENCE" ? (
              <>
                {field("reference_name", "Reference name", "text", true)}
                {field("reference_phone", "Reference phone")}
              </>
            ) : null}
            {values.source_of_lead.trim().toUpperCase().startsWith("OTHER") ? field("source_of_lead_other", "Source other") : null}
            {profile.role === "super_admin" ? (
              <label className="block text-sm">
                Branch
                <select
                  className={inputClass}
                  value={values.branch_id}
                  onChange={(event) => setValues((current) => ({
                    ...current,
                    branch_id: event.target.value,
                    crm_name: "",
                    salesperson: "",
                    salesperson_handled: "",
                  }))}
                >
                  <option value="">Choose branch</option>
                  {branches.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block text-sm">
              CRM / salesperson
              <select
                aria-label="CRM / salesperson"
                className={inputClass}
                value={values.crm_name}
                onChange={(event) => set("crm_name", event.target.value)}
              >
                <option value="">Choose</option>
                {activeCrms.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">Salesperson attending the client<select aria-label="Salesperson attending the client" className={inputClass} value={values.salesperson} onChange={(event) => set("salesperson", event.target.value)} disabled={!values.branch_id}><option value="">{values.branch_id ? "Choose" : "Select branch first"}</option>{activeCrms.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <h3 className="md:col-span-2 text-sm font-bold tracking-wide">CLIENT PROFILE & CONTACT</h3>
            {selectField("gender", "Gender", ["FEMALE", "MALE", "OTHER"], true)}
            <label className="block text-sm"><span>Billing phone</span><input aria-label="Billing phone" className={inputClass} inputMode="numeric" value={values.billing_phone} disabled={billingMatchesPrimary} onChange={(event) => set("billing_phone", event.target.value)} /><span className="mt-2 flex items-center gap-2"><input aria-label="Same as mobile number" type="checkbox" checked={billingMatchesPrimary} onChange={(event) => { setBillingMatchesPrimary(event.target.checked); if (event.target.checked) set("billing_phone", values.primary_phone); }} />Same as mobile number</span></label>
            {field("country", "Country", "text", true)}
            {field("state", "State", "text", true)}
            {field("city", "City", "text", true)}
            {values.city.trim().toUpperCase() === "OTHER" ? field("city_other", "City other") : null}
            {field("pincode", "Pincode", "text", true)}
            {field("address", "Address", "text", true)}
            {selectField("community", "Community / caste", lookups.communities?.length ? lookups.communities : ["OTHER"], true)}
            {values.community.trim().toUpperCase().startsWith("OTHER") ? field("community_other", "Community other") : null}
            {field("dob", "Date of birth", "date")}
            {field("anniversary", "Anniversary", "date")}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <h3 className="md:col-span-2 text-sm font-bold tracking-wide">CLIENT PLANNING</h3>
            {selectField("occupation", "Occupation", ["BUSINESS OWNER", "SELF EMPLOYED", "SERVICE / SALARIED", "HOUSEWIFE / HOMEMAKER", "STUDENT", "DOCTOR", "LAWYER", "CHARTERED ACCOUNTANT / CA", "ENGINEER", "TEACHER / PROFESSOR", "BANKER / FINANCE", "GOVERNMENT EMPLOYEE", "REAL ESTATE", "FASHION / DESIGNER", "RETIRED", "OTHER"], true)}
            {values.occupation.trim().toUpperCase() === "OTHER" ? field("occupation_other", "Occupation other", "text", true) : null}
            {selectField("bridal_or_non_bridal", "Bridal / non-bridal", ["BRIDAL", "NON BRIDAL"], true)}
            {values.bridal_or_non_bridal.trim().toUpperCase() === "BRIDAL" ? <>{selectField("wedding_month", "Wedding month", LEGACY_WEDDING_MONTHS, true)}{selectField("wedding_year", "Wedding year", Array.from({ length: 11 }, (_, index) => String(new Date().getFullYear() + index)), true)}</> : null}
            {selectField("communication_preference", "Communication preference", LEGACY_COMMUNICATION_PREFERENCES, true)}
          </div>
        </section>
        <section id="family-friends" className="legacy-walkin-card">
          <div>
            <h2 className="text-lg font-semibold">FAMILY / FRIENDS WITH CLIENT</h2>
            <label className="mt-3 block max-w-xs text-sm">How many family members / friends are with them?<select aria-label="How many family members / friends are with them?" className={inputClass} value={values.companions_count} onChange={(event) => { const count = Number(event.target.value); set("companions_count", event.target.value); setCompanions((current) => Array.from({ length: Number.isFinite(count) && count > 0 ? count : 0 }, (_, index) => current[index] ?? { name: "", mobile: "", relation: "" })); }}><option value="">Choose</option>{Array.from({ length: 11 }, (_, index) => <option key={index} value={String(index)}>{index}</option>)}</select></label>
            <div className="mt-4 space-y-2">
              {companions.map((item, index) => (
                <div
                  className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"
                  key={index}
                >
                  {(["name", "mobile"] as const).map((key) => (
                    <input
                      className="rounded border p-2"
                      placeholder={key}
                      value={item[key]}
                      onChange={(event) =>
                        setCompanions((current) =>
                          current.map((row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, [key]: event.target.value }
                              : row,
                          ),
                        )
                      }
                      key={key}
                    />
                  ))}<select aria-label={`Companion ${index + 1} relation`} className="rounded border p-2" value={item.relation} onChange={(event) => setCompanions((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, relation: event.target.value } : row))}><option value="">Relation</option>{(lookups.relations ?? []).map((relation) => <option key={relation} value={relation}>{relation}</option>)}</select>
                  <button
                    type="button"
                    className="text-sm underline"
                    onClick={() =>
                      setCompanions((current) =>
                        current.filter((_, rowIndex) => rowIndex !== index),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={companions.length >= 10}
              className="mt-3 rounded border px-3 py-2 text-sm"
              onClick={() =>
                setCompanions((current) => [
                  ...current,
                  { name: "", mobile: "", relation: "" },
                ])
              }
            >
              Add companion
            </button>
          </div>
        </section>
        <section id="visit-details" className="legacy-walkin-card">
          <div className="grid gap-4 md:grid-cols-2">
            <h2 className="md:col-span-2 text-lg font-semibold">
              VISIT DETAILS
            </h2>
            <label className="block text-sm">
              Client bought any product?{requiredMark}
              <select
                aria-label="Client bought any product?"
                className={inputClass}
                value={values.visit_status}
                onChange={(event) => { set("visit_status", event.target.value); set("did_buy", event.target.value === "YES" ? "yes" : "no"); }}
              >
                <option value="">Choose</option>
                {LEGACY_VISIT_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            {values.visit_status === "NO" ? (
              <div className="md:col-span-2">
                <p className="text-sm">Not-bought reasons{requiredMark}</p>
                {lookups.notBoughtReasons.map((reason) => (
                  <label
                    className="mr-4 inline-flex items-center gap-1 text-sm"
                    key={reason}
                  >
                    <input
                      type="checkbox"
                      checked={notBoughtReasons.includes(reason)}
                      onChange={() =>
                        setNotBoughtReasons((current) =>
                          current.includes(reason)
                            ? current.filter((item) => item !== reason)
                            : [...current, reason],
                        )
                      }
                    />
                    {reason}
                  </label>
                ))}
                {notBoughtReasons.some((reason) => reason.startsWith("Other:")) ? field("not_bought_other", "Other reason") : null}
              </div>
            ) : null}
            {values.visit_status !== "STORE_VISIT" && values.visit_status !== "PRICE_CALCULATION" ? <>
              {["YES", "NO", "PRODUCT_EXCHANGE"].includes(values.visit_status) || (["REPAIR_PLACED", "REPAIR_PICKUP", "ORDER_PLACED", "ORDER_PICKUP", "PRODUCT_RETURN"].includes(values.visit_status) && values.repair_or_order_approach === "YES") ? <>
                {multiField("seen_categories", "Product categories seen by the client")}
                {countAndTags("seen_count", "seen", "Number of products client has seen", true)}
                {asList(values.seen_categories).some((item) => item.toUpperCase().startsWith("OTHER")) ? field("seen_other", "Other (seen category)") : null}
              </> : null}
              {values.visit_status === "YES" ? <>
                {multiField("bought_categories", "Bought product categories")}
                {countAndTags("bought_count", "bought", "How many products did the client buy?")}
                {asList(values.bought_categories).some((item) => item.toUpperCase().startsWith("OTHER")) ? field("bought_other", "Other (bought category)") : null}
                {selectField("other_order", "Did the client make any other / new order?", ["YES", "NO"])}
                {values.other_order === "YES" ? <>{multiField("order_categories", "Order / new-things categories")}{countAndTags("order_count", "order", "How many products in the order?")}{asList(values.order_categories).some((item) => item.toUpperCase().startsWith("OTHER")) ? field("order_other", "Other (order category)") : null}</> : null}
              </> : null}
              {["REPAIR_PLACED", "REPAIR_PICKUP", "ORDER_PLACED", "ORDER_PICKUP", "PRODUCT_RETURN"].includes(values.visit_status) ? <>
                {multiField("came_for_categories", "Product categories client came for")}
                {countAndTags("camefor_count", "camefor", "Number of products client came for", true)}
                {asList(values.came_for_categories).some((item) => item.toUpperCase().startsWith("OTHER")) ? field("came_for_other", "Other (came-for category)") : null}
                {selectField("repair_or_order_approach", "Did CRM approach to show new products?", ["YES", "NO"])}
                {values.repair_or_order_approach === "YES" ? <>{selectField("new_things_choice", "Is client buying / making order for new things?", ["BUYING_NEW_PRODUCT", "MAKING_NEW_ORDER", "NO"])}{["BUYING_NEW_PRODUCT", "MAKING_NEW_ORDER"].includes(values.new_things_choice) ? <>{selectField("salesperson_handled", "Salesperson attending new buy / order", activeCrms, true)}{multiField("new_things_categories", "New buy / order categories")}{countAndTags("new_things_count", "new_things", "Number of new products")}{asList(values.new_things_categories).some((item) => item.toUpperCase().startsWith("OTHER")) ? field("new_things_other", "Other (new buy / order category)") : null}</> : null}</> : null}
              </> : null}
              {values.visit_status === "PRODUCT_EXCHANGE" ? <>
                {multiField("came_for_categories", "Product categories client came for")}
                {countAndTags("camefor_count", "camefor", "Number of products client came for", true)}
                {selectField("salesperson_handled", "Salesperson attending the client (new buy / order)", activeCrms, true)}
                {multiField("new_things_categories", "New buy / order categories")}
                {countAndTags("new_things_count", "new_things", "Number of new products")}
                {asList(values.came_for_categories).some((item) => item.toUpperCase().startsWith("OTHER")) ? field("came_for_other", "Other (came for category)") : null}
                {asList(values.new_things_categories).some((item) => item.toUpperCase().startsWith("OTHER")) ? field("new_things_other", "Other (new buy / order category)") : null}
              </> : null}
            </> : null}
          </div>
        </section>
        {!['STORE_VISIT', 'PRICE_CALCULATION'].includes(values.visit_status) ? <section id="crm-approach" className="legacy-walkin-card">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">CRM APPROACH</h2>
            <fieldset className="block text-sm" aria-label="Marketing message">
              <legend>Marketing message</legend>
              <div className="mt-1 flex gap-4">
                {["YES", "NO"].map((option) => <label className="inline-flex items-center gap-1" key={option}><input type="radio" name="marketing_message" value={option} checked={values.marketing_message_sent === option} onChange={(event) => set("marketing_message_sent", event.target.value)} />{option}</label>)}
              </div>
            </fieldset>
            {engagementKinds.map(([key, label, answers]) => {
              const item = engagement[key] ?? { asked: "", no_reason: "" };
              const proof = proofs[key];
              return (
                <div
                  key={key}
                  className="grid gap-3 rounded border p-3 md:grid-cols-[220px_160px_1fr]"
                >
                  <b className="text-sm">{label}</b>
                  <select
                    className="rounded border p-2 text-sm"
                    value={item.asked.toLowerCase()}
                    onChange={(event) => {
                      const asked = event.target.value.toUpperCase();
                      if (asked !== "YES") void removeProof(key);
                      setEngagement((current) => ({
                        ...current,
                        [key]: { ...item, asked },
                      }));
                    }}
                  >
                    <option value="">Choose</option>
                    {answers.map((answer) => <option value={answer.toLowerCase()} key={answer}>{answer.replaceAll("_", " ")}</option>)}
                  </select>
                  {item.asked === "NO" ? (
                    <input
                      className="rounded border p-2 text-sm"
                      placeholder="Reason"
                      value={item.no_reason}
                      onChange={(event) =>
                        setEngagement((current) => ({
                          ...current,
                          [key]: { ...item, no_reason: event.target.value },
                        }))
                      }
                    />
                  ) : item.asked === "YES" ? (
                    <div>
                      {key === "referrals" ? <div className="mb-2"><label className="block text-sm">How many referrals?<select aria-label="How many referrals?" className="mt-1 block rounded border p-2" value={values.referrals_count} onChange={(event) => { const count = Number(event.target.value); set("referrals_count", event.target.value); setReferrals((current) => Array.from({ length: count }, (_, index) => current[index] ?? { name: "", mobile: "" })); }}><option value="">Choose</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={String(index + 1)}>{index + 1}</option>)}</select></label>{referrals.map((referral, index) => <div className="mt-2 grid gap-2 md:grid-cols-2" key={index}><input aria-label={`Referral ${index + 1} name`} className="rounded border p-2" placeholder={`Referral ${index + 1} name`} value={referral.name} onChange={(event) => setReferrals((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><input aria-label={`Referral ${index + 1} number`} className="rounded border p-2" inputMode="numeric" placeholder={`Referral ${index + 1} number`} value={referral.mobile} onChange={(event) => setReferrals((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, mobile: event.target.value } : item))} /></div>)}</div> : null}
                      <input
                        aria-label={`${label} proof image`}
                        type="file"
                        accept={key === "testimonial" ? `${IMAGE_PROOF_ACCEPT},${TESTIMONIAL_VIDEO_ACCEPT}` : IMAGE_PROOF_ACCEPT}
                        capture="environment"
                        className="text-sm"
                        disabled={proof?.status === "uploading"}
                        onChange={(event) =>
                          void uploadProof(key, event.target.files?.[0])
                        }
                      />
                      <p className="mt-1 text-xs text-stone-600">Allowed: {key === "testimonial" ? TESTIMONIAL_PROOF_DESCRIPTION : IMAGE_PROOF_DESCRIPTION}. Maximum 10MB.</p>
                      {proof ? (
                        <p
                          className={
                            proof.status === "error"
                              ? "mt-1 text-xs text-red-700"
                              : "mt-1 text-xs text-stone-600"
                          }
                        >
                          {proof.status === "uploading"
                            ? "Uploading…"
                            : proof.status === "ready"
                              ? `${proof.fileName} uploaded`
                              : proof.error}
                          <button
                            type="button"
                            className="ml-2 underline"
                            onClick={() => void removeProof(key)}
                          >
                            Remove
                          </button>
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-amber-800">
                          Proof image is required.
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-stone-500">
                      YES requires proof; NO requires a reason. Other legacy answers are recorded as selected.
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section> : null}
        <section id="preferences" className="legacy-walkin-card">
          <div className="grid gap-4 md:grid-cols-2">
            <h2 className="md:col-span-2 text-lg font-semibold">PREFERENCES</h2>
            {selectField("beverage", "Beverage", lookups.beverages)}
            {values.beverage === "Other:" ? field("beverage_other", "Other beverage") : null}
            {selectField("sugar", "Sugar", lookups.sugarOptions ?? [])}
            {values.sugar === "Other:" ? field("sugar_other", "Other sugar preference") : null}
            {selectField("snack", "Snack", lookups.snacks)}
            {values.snack === "Other:" ? field("snack_other", "Other snack") : null}
            {selectField("gift", "Gift given", lookups.gifts ?? [])}
            {values.gift === "Other:" ? field("gift_other", "Other gift") : null}
          </div>
        </section>
        <section id="remark" className="legacy-walkin-card">
          <div className="grid gap-4 md:grid-cols-2">
            <h2 className="md:col-span-2 text-lg font-semibold">REMARK</h2>
            {field("next_visit_date", "Next visit date", "date", values.visit_status === "NO")}
            {selectField("client_potential_category", "Client potential category", [
              ...(!isPotentialCategory(values.client_potential_category) && values.client_potential_category ? [values.client_potential_category] : []),
              ...POTENTIAL_CATEGORIES,
            ])}
            {field("high_potential_reason", "Why high potential")}
            {field("product_requirement", "Product requirement")}
            {field(
              "other_store_client_wants_to_visit",
              "Other store client wants to visit",
            )}
            {notBoughtReasons.some((reason) => reason.trim().toUpperCase() === "WANT TO SEE MORE DESIGNS") ? multiField("categories_client_wants_more", "Which categories client wants to see more") : null}
            {field("remark", "Remark")}
            <div className="md:col-span-2"><p className="text-sm">Upload photo (optional) — up to 10. Allowed: {IMAGE_PROOF_DESCRIPTION}.</p><div className="mt-2 grid gap-2 md:grid-cols-2">{Array.from({ length: remarkPhotoSlots }, (_, index) => { const key = `remark_photo_${index + 1}`; const proof = proofs[key]; return <label className="block text-sm" key={key}>Photo {index + 1}<input aria-label={`Remark photo ${index + 1}`} type="file" accept={IMAGE_PROOF_ACCEPT} capture="environment" className="mt-1 block text-sm" onChange={(event) => void uploadProof(key, event.target.files?.[0])} />{proof ? <span className="block text-xs text-stone-600">{proof.status === "ready" ? `${proof.fileName} uploaded` : proof.error ?? "Uploading…"}</span> : null}</label>; })}</div>{remarkPhotoSlots < 10 ? <button type="button" className="mt-2 rounded border px-3 py-1 text-sm" onClick={() => setRemarkPhotoSlots((current) => current + 1)}>Add more photo</button> : null}</div>
          </div>
        </section>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={saving} className="rounded bg-amber-800 px-4 py-2 font-medium text-white disabled:opacity-50" onClick={() => { submitWasExplicit.current = true; }}>
          {saving ? "Submitting…" : "Submit complete visit"}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-red-700">{message}</p> : null}
    </form>
  );
}
