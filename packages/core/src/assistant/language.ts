/**
 * A coarse label for the language style of a question, stored with the answer
 * for later insights. It never changes what Kiara says: the model follows the
 * user's language on its own (system prompt). Labels match the
 * `kiara_messages.language` check in migration 0901.
 */
export type KiaraLanguage = "en" | "hi" | "hinglish" | "hi_latn";

// Common Hindi words as people type them in English letters.
const HINDI_LATIN_WORDS = new Set([
  "kya", "kyaa", "hai", "hain", "mera", "meri", "mere", "mujhe", "muje", "aaj", "kal", "kaise", "kaisa", "kaun", "kahan", "kab", "kyun",
  "nahi", "nahin", "haan", "karna", "karo", "karu", "karun", "kare", "batao", "bataiye", "bata", "kitna", "kitne", "kitni", "abhi",
  "ka", "ki", "ke", "ko", "se", "me", "mein", "par", "aur", "bhi", "tha", "thi", "hoga", "hogi", "chahiye", "kaam", "apna", "apni",
  "sab", "kuch", "koi", "wala", "wali", "liye", "kyunki", "lekin", "agar", "toh", "to", "jaldi", "pehle", "baad",
]);

const ENGLISH_WORDS = new Set([
  "the", "is", "are", "what", "my", "for", "today", "tomorrow", "how", "do", "i", "to", "a", "of", "in", "and", "task", "tasks",
  "pending", "leave", "apply", "form", "forms", "show", "please", "when", "where", "which", "can", "you", "me", "list", "overdue",
]);

export function detectLanguageStyle(text: string): KiaraLanguage {
  if (/[ऀ-ॿ]/.test(text)) return "hi";
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0) return "en";
  // "me", "to" and "kal"-like collisions are common in both; count only words that are unambiguous enough.
  const hindi = words.filter((word) => HINDI_LATIN_WORDS.has(word) && !ENGLISH_WORDS.has(word)).length;
  if (hindi === 0) return "en";
  const english = words.filter((word) => ENGLISH_WORDS.has(word) && !HINDI_LATIN_WORDS.has(word)).length;
  return english > 0 ? "hinglish" : "hi_latn";
}
