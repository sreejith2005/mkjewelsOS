// Phone numbers keep their country code (CRM migration 20261007001100). A phone column holds
// country code + number as digits (919987323456, 6591234567) and a country-code column beside
// it holds the code. Typed input is read once with phoneKey() (the same rule as
// crm_private.phone_key: 10 digits without code are Indian); a stored number is read with
// storedPhone() and never re-guessed.

export type CountryCode = { code: string; country: string };

export const DEFAULT_COUNTRY_CODE = "91";

// Every E.164 country code (prefix-free), India first, then by country. +1 covers the USA and
// Canada. Kept in step with crm_private.phone_country_codes (tests/phone.test.ts checks).
export const COUNTRY_CODES: readonly CountryCode[] = [
  { code: "91", country: "India" },
  { code: "93", country: "Afghanistan" },
  { code: "355", country: "Albania" },
  { code: "213", country: "Algeria" },
  { code: "376", country: "Andorra" },
  { code: "244", country: "Angola" },
  { code: "54", country: "Argentina" },
  { code: "374", country: "Armenia" },
  { code: "297", country: "Aruba" },
  { code: "61", country: "Australia" },
  { code: "43", country: "Austria" },
  { code: "994", country: "Azerbaijan" },
  { code: "973", country: "Bahrain" },
  { code: "880", country: "Bangladesh" },
  { code: "375", country: "Belarus" },
  { code: "32", country: "Belgium" },
  { code: "501", country: "Belize" },
  { code: "229", country: "Benin" },
  { code: "975", country: "Bhutan" },
  { code: "591", country: "Bolivia" },
  { code: "387", country: "Bosnia and Herzegovina" },
  { code: "267", country: "Botswana" },
  { code: "55", country: "Brazil" },
  { code: "673", country: "Brunei" },
  { code: "359", country: "Bulgaria" },
  { code: "226", country: "Burkina Faso" },
  { code: "257", country: "Burundi" },
  { code: "855", country: "Cambodia" },
  { code: "237", country: "Cameroon" },
  { code: "238", country: "Cape Verde" },
  { code: "236", country: "Central African Republic" },
  { code: "235", country: "Chad" },
  { code: "56", country: "Chile" },
  { code: "86", country: "China" },
  { code: "57", country: "Colombia" },
  { code: "269", country: "Comoros" },
  { code: "242", country: "Congo" },
  { code: "682", country: "Cook Islands" },
  { code: "506", country: "Costa Rica" },
  { code: "385", country: "Croatia" },
  { code: "53", country: "Cuba" },
  { code: "599", country: "Curacao / Caribbean Netherlands" },
  { code: "357", country: "Cyprus" },
  { code: "420", country: "Czech Republic" },
  { code: "243", country: "DR Congo" },
  { code: "45", country: "Denmark" },
  { code: "246", country: "Diego Garcia" },
  { code: "253", country: "Djibouti" },
  { code: "593", country: "Ecuador" },
  { code: "20", country: "Egypt" },
  { code: "503", country: "El Salvador" },
  { code: "240", country: "Equatorial Guinea" },
  { code: "291", country: "Eritrea" },
  { code: "372", country: "Estonia" },
  { code: "268", country: "Eswatini" },
  { code: "251", country: "Ethiopia" },
  { code: "500", country: "Falkland Islands" },
  { code: "298", country: "Faroe Islands" },
  { code: "679", country: "Fiji" },
  { code: "358", country: "Finland" },
  { code: "33", country: "France" },
  { code: "594", country: "French Guiana" },
  { code: "689", country: "French Polynesia" },
  { code: "241", country: "Gabon" },
  { code: "220", country: "Gambia" },
  { code: "995", country: "Georgia" },
  { code: "49", country: "Germany" },
  { code: "233", country: "Ghana" },
  { code: "350", country: "Gibraltar" },
  { code: "30", country: "Greece" },
  { code: "299", country: "Greenland" },
  { code: "590", country: "Guadeloupe" },
  { code: "502", country: "Guatemala" },
  { code: "224", country: "Guinea" },
  { code: "245", country: "Guinea-Bissau" },
  { code: "592", country: "Guyana" },
  { code: "509", country: "Haiti" },
  { code: "504", country: "Honduras" },
  { code: "852", country: "Hong Kong" },
  { code: "36", country: "Hungary" },
  { code: "354", country: "Iceland" },
  { code: "62", country: "Indonesia" },
  { code: "98", country: "Iran" },
  { code: "964", country: "Iraq" },
  { code: "353", country: "Ireland" },
  { code: "972", country: "Israel" },
  { code: "39", country: "Italy" },
  { code: "225", country: "Ivory Coast" },
  { code: "81", country: "Japan" },
  { code: "962", country: "Jordan" },
  { code: "254", country: "Kenya" },
  { code: "686", country: "Kiribati" },
  { code: "383", country: "Kosovo" },
  { code: "965", country: "Kuwait" },
  { code: "996", country: "Kyrgyzstan" },
  { code: "856", country: "Laos" },
  { code: "371", country: "Latvia" },
  { code: "961", country: "Lebanon" },
  { code: "266", country: "Lesotho" },
  { code: "231", country: "Liberia" },
  { code: "218", country: "Libya" },
  { code: "423", country: "Liechtenstein" },
  { code: "370", country: "Lithuania" },
  { code: "352", country: "Luxembourg" },
  { code: "853", country: "Macau" },
  { code: "261", country: "Madagascar" },
  { code: "265", country: "Malawi" },
  { code: "60", country: "Malaysia" },
  { code: "960", country: "Maldives" },
  { code: "223", country: "Mali" },
  { code: "356", country: "Malta" },
  { code: "692", country: "Marshall Islands" },
  { code: "596", country: "Martinique" },
  { code: "222", country: "Mauritania" },
  { code: "230", country: "Mauritius" },
  { code: "52", country: "Mexico" },
  { code: "691", country: "Micronesia" },
  { code: "373", country: "Moldova" },
  { code: "377", country: "Monaco" },
  { code: "976", country: "Mongolia" },
  { code: "382", country: "Montenegro" },
  { code: "212", country: "Morocco" },
  { code: "258", country: "Mozambique" },
  { code: "95", country: "Myanmar" },
  { code: "264", country: "Namibia" },
  { code: "674", country: "Nauru" },
  { code: "977", country: "Nepal" },
  { code: "31", country: "Netherlands" },
  { code: "687", country: "New Caledonia" },
  { code: "64", country: "New Zealand" },
  { code: "505", country: "Nicaragua" },
  { code: "227", country: "Niger" },
  { code: "234", country: "Nigeria" },
  { code: "683", country: "Niue" },
  { code: "672", country: "Norfolk Island" },
  { code: "850", country: "North Korea" },
  { code: "389", country: "North Macedonia" },
  { code: "47", country: "Norway" },
  { code: "968", country: "Oman" },
  { code: "92", country: "Pakistan" },
  { code: "680", country: "Palau" },
  { code: "970", country: "Palestine" },
  { code: "507", country: "Panama" },
  { code: "675", country: "Papua New Guinea" },
  { code: "595", country: "Paraguay" },
  { code: "51", country: "Peru" },
  { code: "63", country: "Philippines" },
  { code: "48", country: "Poland" },
  { code: "351", country: "Portugal" },
  { code: "974", country: "Qatar" },
  { code: "262", country: "Reunion / Mayotte" },
  { code: "40", country: "Romania" },
  { code: "7", country: "Russia / Kazakhstan" },
  { code: "250", country: "Rwanda" },
  { code: "290", country: "Saint Helena" },
  { code: "508", country: "Saint Pierre and Miquelon" },
  { code: "685", country: "Samoa" },
  { code: "378", country: "San Marino" },
  { code: "239", country: "Sao Tome and Principe" },
  { code: "966", country: "Saudi Arabia" },
  { code: "221", country: "Senegal" },
  { code: "381", country: "Serbia" },
  { code: "248", country: "Seychelles" },
  { code: "232", country: "Sierra Leone" },
  { code: "65", country: "Singapore" },
  { code: "421", country: "Slovakia" },
  { code: "386", country: "Slovenia" },
  { code: "677", country: "Solomon Islands" },
  { code: "252", country: "Somalia" },
  { code: "27", country: "South Africa" },
  { code: "82", country: "South Korea" },
  { code: "211", country: "South Sudan" },
  { code: "34", country: "Spain" },
  { code: "94", country: "Sri Lanka" },
  { code: "249", country: "Sudan" },
  { code: "597", country: "Suriname" },
  { code: "46", country: "Sweden" },
  { code: "41", country: "Switzerland" },
  { code: "963", country: "Syria" },
  { code: "886", country: "Taiwan" },
  { code: "992", country: "Tajikistan" },
  { code: "255", country: "Tanzania" },
  { code: "66", country: "Thailand" },
  { code: "670", country: "Timor-Leste" },
  { code: "228", country: "Togo" },
  { code: "690", country: "Tokelau" },
  { code: "676", country: "Tonga" },
  { code: "216", country: "Tunisia" },
  { code: "90", country: "Turkey" },
  { code: "993", country: "Turkmenistan" },
  { code: "688", country: "Tuvalu" },
  { code: "1", country: "USA / Canada" },
  { code: "256", country: "Uganda" },
  { code: "380", country: "Ukraine" },
  { code: "971", country: "United Arab Emirates" },
  { code: "44", country: "United Kingdom" },
  { code: "598", country: "Uruguay" },
  { code: "998", country: "Uzbekistan" },
  { code: "678", country: "Vanuatu" },
  { code: "58", country: "Venezuela" },
  { code: "84", country: "Vietnam" },
  { code: "681", country: "Wallis and Futuna" },
  { code: "967", country: "Yemen" },
  { code: "260", country: "Zambia" },
  { code: "263", country: "Zimbabwe" },
];

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** Typed input -> the stored form, or null when it is not a phone. Same rule as crm_private.phone_key(). */
export function phoneKey(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  const digits = digitsOf(raw);
  const international = raw.startsWith("+") ? digits : digits.startsWith("00") ? digits.slice(2) : null;
  if (international !== null) return /^[1-9]\d{7,14}$/.test(international) ? international : null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length >= 11 && digits.length <= 15 && !digits.startsWith("0")) return digits;
  return null;
}

/** A stored number as it is (6591234567 stays Singapore), or null. Same rule as crm_private.stored_phone(). */
export function storedPhone(value: string | null | undefined): string | null {
  const digits = digitsOf(value ?? "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** The country code a stored number starts with (codes are prefix-free, so there is one). */
export function countryCodeOf(stored: string | null | undefined): string | null {
  const digits = storedPhone(stored);
  return digits ? COUNTRY_CODES.find(({ code }) => digits.startsWith(code))?.code ?? null : null;
}

// A number typed with its own "+" is a full international number and wins over the dropdown.
const isInternational = (number: string) => number.trim().startsWith("+");

/** The national number typed for a country code: digits only, without a trunk 0 or a repeated +91. */
function nationalDigits(countryCode: string, number: string): string {
  const digits = digitsOf(number);
  const national = countryCode === DEFAULT_COUNTRY_CODE && digits.length === 12 && digits.startsWith(countryCode) ? digits.slice(2) : digits;
  return national.replace(/^0+/, "");
}

/** Why a country code + number cannot be saved, or null when it can. An empty number is reported too. */
export function phoneError(countryCode: string, number: string): string | null {
  if (isInternational(number)) return phoneKey(number) && countryCodeOf(phoneKey(number)) ? null : "Enter a valid international number.";
  if (!countryCode) return "Choose a country code.";
  const national = nationalDigits(countryCode, number);
  if (!national) return "Enter the mobile number.";
  if (countryCode === DEFAULT_COUNTRY_CODE) return national.length === 10 ? null : "Enter a 10-digit mobile number for India (+91).";
  const total = countryCode.length + national.length;
  return national.length >= 4 && total >= 8 && total <= 15 ? null : `Enter a valid mobile number for +${countryCode}.`;
}

/** "+<code><number>" for the database (which stores it as digits), or "" when there is no number. */
export function composePhone(countryCode: string, number: string): string {
  if (isInternational(number)) return `+${digitsOf(number)}`;
  const national = nationalDigits(countryCode, number);
  return national && countryCode ? `+${countryCode}${national}` : "";
}

/** Splits a stored phone into the country code and number shown in a form. */
export function splitPhone(stored: string | null | undefined): { countryCode: string; number: string } {
  const digits = storedPhone(stored);
  const countryCode = countryCodeOf(digits);
  return digits && countryCode
    ? { countryCode, number: digits.slice(countryCode.length) }
    : { countryCode: DEFAULT_COUNTRY_CODE, number: digitsOf(stored ?? "") };
}

/** "+91 9987323456" for display; the value as stored when it is not a phone. */
export function formatPhone(stored: string | null | undefined): string {
  const digits = storedPhone(stored);
  const countryCode = countryCodeOf(digits);
  if (!digits) return stored ?? "";
  return countryCode ? `+${countryCode} ${digits.slice(countryCode.length)}` : `+${digits}`;
}
