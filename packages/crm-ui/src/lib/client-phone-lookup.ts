import {formatPhone} from "@/lib/phone";
import { parseWalkinProfileDefaults, type WalkinProfileDefaults } from "@/lib/walkin-profile-defaults";
import { createClient } from "@/lib/supabase/client";

export type PhoneMatchedClient = {
  walkin_defaults?: WalkinProfileDefaults;
  client_id: string;
  client_code: string;
  primary_name: string;
  primary_phone: string | null;
  gender: string | null;
  dob: string | null;
  community: string | null;
  address: string | null;
  pincode: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  anniversary?: string | null;
  beverage?: string | null;
  sugar?: string | null;
  snack?: string | null;
  community_other?: string | null;
  city_other?: string | null;
  billing_phone?: string | null;
  communication_preference?: string | null;
  client_potential_category?: string | null;
  high_potential_reason?: string | null;
  next_visit_date?: string | null;
};

/** Presentation defaults shared by every phone-autofill entry point. */
export function clientProfileAutofill(client: PhoneMatchedClient) {
  return {
    ...client.walkin_defaults,
    primary_name: client.primary_name ?? '',
    gender: client.gender?.toUpperCase() ?? '',
    dob: client.dob ?? '', anniversary: client.anniversary ?? '',
    community: client.community ?? '', community_other: client.community_other ?? '',
    address: client.address ?? '', pincode: client.pincode ?? '', country: client.country ?? '',
    state: client.state ?? '', city: client.city ?? '', city_other: client.city_other ?? '',
    beverage: client.beverage ?? '', sugar: client.sugar ?? '', snack: client.snack ?? '',
    billing_phone: formatPhone(client.billing_phone), communication_preference: client.communication_preference ?? '',
    client_potential_category: client.client_potential_category ?? '', high_potential_reason: client.high_potential_reason ?? '',
    next_visit_date: client.next_visit_date ?? '',
  };
}

export async function lookupClientByPhone(value: string) {
  const phone = value.trim();
  if (phone.replace(/\D/g, '').length < 8) return null;
  const result = await createClient().rpc("lookup_client_profile_by_phone", {
    p_phone: phone,
  });
  if (!result) return null;
  const { data, error } = result;
  if (error) return null;
  const matched = data?.[0];
  if (!matched) return null;
  const defaults = await createClient().rpc("get_walkin_profile_defaults", { p_client_id: matched.client_id });
  return { ...matched, walkin_defaults: parseWalkinProfileDefaults(defaults?.error ? null : defaults?.data) };
}
