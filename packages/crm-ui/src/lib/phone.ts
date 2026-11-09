// The phone rules moved to @jewelos/core (MK1 audit 2026-11-07) so CRM screens and JewelOS form
// phone questions share one implementation. This file keeps the CRM's existing import path.
export {
  COUNTRY_CODES, DEFAULT_COUNTRY_CODE, composePhone, countryCodeOf, formatPhone, phoneError, phoneKey, splitPhone, storedPhone,
  type CountryCode,
} from "@jewelos/core";
