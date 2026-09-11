import { PAGE_IDS, type PageId, type UserRole } from "../roleMenu";
import { SECTION_PARENT } from "../permissions/catalog";

export type SectionAvailability = Readonly<Record<PageId, boolean>>;

export type SectionControls = Readonly<{
  developer_mode_enabled: boolean;
  section_availability: SectionAvailability;
  settings_version: number;
}>;

export const DEFAULT_SECTION_AVAILABILITY: SectionAvailability = Object.freeze(
  Object.fromEntries(PAGE_IDS.map((page) => [page, true])) as Record<PageId, boolean>,
);

export const DEFAULT_SECTION_CONTROLS: SectionControls = Object.freeze({
  developer_mode_enabled: false,
  section_availability: DEFAULT_SECTION_AVAILABILITY,
  settings_version: 0,
});

export function validateSectionControls(input: unknown): SectionControls {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Section controls must be an object");
  const value = input as Record<string, unknown>;
  if (typeof value.developer_mode_enabled !== "boolean" || !Number.isInteger(value.settings_version) || (value.settings_version as number) < 0) throw new Error("Invalid section controls");
  if (!value.section_availability || typeof value.section_availability !== "object" || Array.isArray(value.section_availability)) throw new Error("Section availability must be an object");
  const availability = value.section_availability as Record<string, unknown>;
  if (Object.keys(availability).some((key) => !PAGE_IDS.includes(key as PageId)) || PAGE_IDS.some((key) => typeof availability[key] !== "boolean")) throw new Error("Invalid section availability");
  return {
    developer_mode_enabled: value.developer_mode_enabled,
    section_availability: Object.fromEntries(PAGE_IDS.map((key) => [key, availability[key]])) as SectionAvailability,
    settings_version: value.settings_version as number,
  };
}

/**
 * A disabled section stays disabled whether or not the Developer Mode control
 * strip is showing. `developer_mode_enabled` only controls the strip; tying
 * enforcement to it re-enabled every section as soon as a Super Admin hid the
 * strip. Legacy sub-pages follow their parent section.
 */
export function isSectionUnderMaintenance(controls: SectionControls, page: PageId): boolean {
  const parent = SECTION_PARENT[page];
  return controls.section_availability[page] === false || (parent !== undefined && controls.section_availability[parent] === false);
}

export function canBypassSectionMaintenance(role: UserRole): boolean {
  return role === "super_admin";
}
