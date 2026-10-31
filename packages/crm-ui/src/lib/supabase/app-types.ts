import type { Database } from "./database.types";
import type { WalkinProfileDefaults } from '../walkin-profile-defaults';

export type Client = Database["public"]["Tables"]["clients"]["Row"] & { walkin_defaults?: WalkinProfileDefaults };
