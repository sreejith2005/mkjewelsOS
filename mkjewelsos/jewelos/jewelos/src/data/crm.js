import { toISO, addDays, TODAY, TODAY_ISO } from "../lib/utils.js";

/* Customer book + interaction history. */

export const CUSTOMERS = [
  { id: "c1", branch_id: "b1", first_name: "Ananya", last_name: "Desai", phone: "+91 98200 41122", email: "ananya.d@gmail.com", customer_type: "vip", dob: "1988-08-09", anniversary: "2014-11-24", loyalty_points: 8450, assigned_to: "u4", source: "referral", tags: ["diamond", "bridal"], last_purchase: 425000 },
  { id: "c2", branch_id: "b1", first_name: "Rohan", last_name: "Bhatia", phone: "+91 99303 77410", email: "rohan.bhatia@outlook.com", customer_type: "regular", dob: "1992-03-14", anniversary: null, loyalty_points: 1220, assigned_to: "u4", source: "walk_in", tags: ["gold"], last_purchase: 86000 },
  { id: "c3", branch_id: "b2", first_name: "Meera", last_name: "Iyer", phone: "+91 98673 20988", email: "meera.iyer@gmail.com", customer_type: "vip", dob: "1979-08-06", anniversary: "2005-02-11", loyalty_points: 15300, assigned_to: "u3", source: "referral", tags: ["polki", "bridal", "high-value"], last_purchase: 1180000 },
  { id: "c4", branch_id: "b1", first_name: "Kabir", last_name: "Malhotra", phone: "+91 91670 55231", email: "kabir.m@company.co.in", customer_type: "corporate", dob: null, anniversary: null, loyalty_points: 400, assigned_to: "u2", source: "corporate_tie_up", tags: ["bulk", "gifting"], last_purchase: 640000 },
  { id: "c5", branch_id: "b2", first_name: "Sneha", last_name: "Kulkarni", phone: "+91 90040 18876", email: "sneha.k@gmail.com", customer_type: "regular", dob: "1995-08-07", anniversary: null, loyalty_points: 760, assigned_to: "u6", source: "instagram", tags: ["silver"], last_purchase: 24000 },
  { id: "c6", branch_id: "b1", first_name: "Zoya", last_name: "Merchant", phone: "+91 98925 66301", email: "zoya.merchant@gmail.com", customer_type: "vip", dob: "1990-12-02", anniversary: "2019-08-08", loyalty_points: 6100, assigned_to: "u4", source: "walk_in", tags: ["diamond"], last_purchase: 310000 },
  { id: "c7", branch_id: "b2", first_name: "Devendra", last_name: "Patil", phone: "+91 93245 90012", email: "dev.patil@gmail.com", customer_type: "wholesale", dob: null, anniversary: null, loyalty_points: 0, assigned_to: "u3", source: "trade_show", tags: ["wholesale", "gold"], last_purchase: 2250000 },
  { id: "c8", branch_id: "b1", first_name: "Ishita", last_name: "Rane", phone: "+91 97696 34410", email: "ishita.rane@gmail.com", customer_type: "regular", dob: "1998-05-21", anniversary: null, loyalty_points: 310, assigned_to: "u4", source: "instagram", tags: ["new"], last_purchase: 18500 },
];

export const INTERACTIONS = [
  { id: "i1", customer_id: "c1", user_id: "u4", type: "visit", subject: "Viewed solitaire ring collection", outcome: "Shortlisted 3 pieces, wants matching band", date: toISO(addDays(TODAY, -2)), follow_up_date: TODAY_ISO },
  { id: "i2", customer_id: "c1", user_id: "u4", type: "whatsapp", subject: "Sent solitaire pricing sheet", outcome: "Asked for EMI options", date: toISO(addDays(TODAY, -6)), follow_up_date: null },
  { id: "i3", customer_id: "c3", user_id: "u3", type: "call", subject: "Bridal set consultation", outcome: "Booked design meeting for Saturday", date: toISO(addDays(TODAY, -1)), follow_up_date: TODAY_ISO },
  { id: "i4", customer_id: "c6", user_id: "u4", type: "follow_up", subject: "Anniversary gifting reminder", outcome: "Interested in tennis bracelet", date: toISO(addDays(TODAY, -4)), follow_up_date: TODAY_ISO },
  { id: "i5", customer_id: "c2", user_id: "u4", type: "call", subject: "Chain repair status", outcome: "Collected on 30 Jul", date: toISO(addDays(TODAY, -9)), follow_up_date: null },
  { id: "i6", customer_id: "c7", user_id: "u3", type: "visit", subject: "Quarterly wholesale order", outcome: "Placed 1.2kg gold chain order", date: toISO(addDays(TODAY, -3)), follow_up_date: toISO(addDays(TODAY, 4)) },
  { id: "i7", customer_id: "c4", user_id: "u2", type: "call", subject: "Diwali corporate gifting", outcome: "Sent catalogue, awaiting headcount", date: toISO(addDays(TODAY, -5)), follow_up_date: toISO(addDays(TODAY, 2)) },
];
