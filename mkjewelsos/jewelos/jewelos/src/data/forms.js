import { toISO, addDays, TODAY, TODAY_ISO } from "../lib/utils.js";

/* Form templates. Field types supported by FormRenderer:
   text | number | email | phone | date | select | checkbox | textarea |
   currency | rating
   `visible_when` drives conditional visibility. */

export const FORM_TEMPLATES = [
  {
    id: "fm1", name: "Custom order brief", category: "sales", submissions_count: 47,
    access_roles: ["staff", "team_lead", "manager", "admin", "super_admin"],
    description: "What the customer wants, in enough detail for the workshop to quote.",
    fields: [
      { id: "q1", type: "text", label: "Customer name", required: true, placeholder: "Full name as on invoice", width: "full" },
      { id: "q2", type: "phone", label: "Contact number", required: true, placeholder: "+91", width: "half" },
      { id: "q3", type: "select", label: "Piece type", required: true, options: ["Ring", "Necklace", "Bangle set", "Earrings", "Mangalsutra", "Full bridal set"], width: "half" },
      { id: "q4", type: "select", label: "Metal", required: true, options: ["22k gold", "18k gold", "Platinum", "Silver"], width: "half" },
      { id: "q5", type: "select", label: "Stone", required: false, options: ["None", "Diamond", "Polki", "Emerald", "Ruby", "Mixed"], width: "half" },
      { id: "q6", type: "number", label: "Target weight (grams)", required: true, placeholder: "e.g. 24", width: "half" },
      { id: "q7", type: "currency", label: "Budget", required: true, placeholder: "0", width: "half" },
      { id: "q8", type: "date", label: "Needed by", required: true, width: "half" },
      { id: "q9", type: "select", label: "Occasion", required: false, options: ["Wedding", "Anniversary", "Birthday", "Festival", "No occasion"], width: "half" },
      { id: "q10", type: "textarea", label: "Design notes", required: false, placeholder: "Reference pieces, stone setting, finish, anything the karigar should know", width: "full" },
      { id: "q11", type: "checkbox", label: "Customer is supplying their own gold", required: false, width: "full" },
      { id: "q12", type: "number", label: "Old gold weight (grams)", required: true, placeholder: "e.g. 18", width: "half", visible_when: { field: "q11", equals: true } },
      { id: "q13", type: "rating", label: "How urgent is this?", required: false, width: "full" },
    ],
  },
  {
    id: "fm2", name: "Repair intake", category: "service", submissions_count: 128,
    access_roles: ["staff", "team_lead", "manager", "admin", "super_admin"],
    description: "Logs a piece into the workshop with its condition on arrival.",
    fields: [
      { id: "q1", type: "text", label: "Customer name", required: true, width: "full" },
      { id: "q2", type: "phone", label: "Contact number", required: true, width: "half" },
      { id: "q3", type: "select", label: "Piece type", required: true, options: ["Ring", "Chain", "Bangle", "Earrings", "Watch", "Other"], width: "half" },
      { id: "q4", type: "number", label: "Weight on intake (grams)", required: true, width: "half" },
      { id: "q5", type: "select", label: "Problem", required: true, options: ["Broken clasp", "Bent or misshapen", "Stone missing", "Size alteration", "Polish only", "Other"], width: "half" },
      { id: "q6", type: "textarea", label: "Condition on arrival", required: true, placeholder: "Note every scratch and missing stone before it leaves the counter", width: "full" },
      { id: "q7", type: "checkbox", label: "Customer wants an estimate before work starts", required: false, width: "full" },
    ],
  },
  {
    id: "fm3", name: "Stock transfer request", category: "inventory", submissions_count: 63,
    access_roles: ["manager", "admin", "super_admin"],
    description: "Requests a move of stock between two branches.",
    fields: [
      { id: "q1", type: "select", label: "From branch", required: true, options: ["Bandra Showroom", "Andheri Showroom", "Zaveri Bazar Workshop"], width: "half" },
      { id: "q2", type: "select", label: "To branch", required: true, options: ["Bandra Showroom", "Andheri Showroom", "Zaveri Bazar Workshop"], width: "half" },
      { id: "q3", type: "textarea", label: "SKUs to move", required: true, placeholder: "One SKU per line", width: "full" },
      { id: "q4", type: "number", label: "Total pieces", required: true, width: "half" },
      { id: "q5", type: "currency", label: "Declared value", required: true, width: "half" },
      { id: "q6", type: "date", label: "Move on", required: true, width: "half" },
    ],
  },
  {
    id: "fm4", name: "Vendor KYC", category: "procurement", submissions_count: 9,
    access_roles: ["manager", "admin", "super_admin"],
    description: "Everything needed before a new supplier can be paid.",
    fields: [
      { id: "q1", type: "text", label: "Firm name", required: true, width: "full" },
      { id: "q2", type: "text", label: "GSTIN", required: true, placeholder: "27ABCDE1234F1Z5", width: "half" },
      { id: "q3", type: "phone", label: "Contact number", required: true, width: "half" },
      { id: "q4", type: "email", label: "Email", required: true, width: "full" },
      { id: "q5", type: "select", label: "Supplies", required: true, options: ["Loose stones", "Findings", "Casting", "Finished goods", "Packaging"], width: "half" },
      { id: "q6", type: "select", label: "Payment terms", required: true, options: ["Advance", "Net 15", "Net 30", "Net 45"], width: "half" },
    ],
  },
  {
    id: "fm5", name: "Customer feedback", category: "service", submissions_count: 214,
    access_roles: ["staff", "team_lead", "manager", "admin", "super_admin"],
    description: "Collected at handover. Feeds the service score on the dashboard.",
    fields: [
      { id: "q1", type: "text", label: "Customer name", required: false, width: "full" },
      { id: "q2", type: "rating", label: "How was your visit?", required: true, width: "full" },
      { id: "q3", type: "select", label: "What stood out?", required: false, options: ["The staff", "The collection", "The pricing", "The wait time", "Nothing in particular"], width: "full" },
      { id: "q4", type: "textarea", label: "Anything we should fix?", required: false, width: "full" },
    ],
  },
];

export const seedSubmissions = () => [
  { id: "sb1", form_template_id: "fm1", submitted_by: "u4", submitted_on: toISO(addDays(TODAY, -5)), status: "approved", data_display: { "Customer name": "Ananya Desai", "Piece type": "Ring", Metal: "18k gold", Stone: "Diamond", Budget: "\u20b94,25,000", "Needed by": "12 Sep 2026" } },
  { id: "sb2", form_template_id: "fm1", submitted_by: "u3", submitted_on: toISO(addDays(TODAY, -2)), status: "approved", data_display: { "Customer name": "Meera Iyer", "Piece type": "Full bridal set", Metal: "22k gold", Stone: "Polki", Budget: "\u20b911,80,000", "Needed by": "02 Nov 2026" } },
  { id: "sb3", form_template_id: "fm2", submitted_by: "u4", submitted_on: toISO(addDays(TODAY, -1)), status: "pending", data_display: { "Customer name": "Rohan Bhatia", "Piece type": "Chain", Problem: "Broken clasp", "Weight on intake (grams)": "22" } },
  { id: "sb4", form_template_id: "fm5", submitted_by: "u6", submitted_on: TODAY_ISO, status: "pending", data_display: { "Customer name": "Sneha Kulkarni", "How was your visit?": "5 / 5", "What stood out?": "The staff" } },
];
