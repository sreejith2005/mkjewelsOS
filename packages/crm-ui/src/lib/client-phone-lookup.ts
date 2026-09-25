import { phoneDigits } from "@/lib/clients";
import { createClient } from "@/lib/supabase/client";

export type PhoneMatchedClient = {
  client_id: string;
  client_code: string;
  primary_name: string;
  primary_phone: string;
  gender: string | null;
  dob: string | null;
  community: string | null;
  address: string | null;
  pincode: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
};

export async function lookupClientByPhone(value: string) {
  const phone = phoneDigits(value);
  if (phone.length !== 10) return null;
  const result = await createClient().rpc("lookup_client_by_phone", {
    p_phone: phone,
  });
  if (!result) return null;
  const { data, error } = result;
  if (error) return null;
  return (data?.[0] ?? null) as PhoneMatchedClient | null;
}
