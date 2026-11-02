export const ADMIN_SET_PASSWORD_LENGTH = 6;

export function validateAdminSetPassword(
  password: string,
  confirmation: string,
): string | null {
  if (password.length !== ADMIN_SET_PASSWORD_LENGTH) {
    return `Password must be exactly ${ADMIN_SET_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) {
    return "The password confirmation does not match.";
  }
  return null;
}

/** Limits for a password an employee chooses for themselves in Settings. */
export const OWN_PASSWORD_MIN_LENGTH = 6;
/** Supabase Auth only uses the first 72 bytes of a password, so longer ones are refused. */
export const OWN_PASSWORD_MAX_LENGTH = 72;

export function validateOwnPasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): string | null {
  if (!currentPassword) return "Enter your current password.";
  if (newPassword.length < OWN_PASSWORD_MIN_LENGTH || newPassword.length > OWN_PASSWORD_MAX_LENGTH) {
    return `New password must be ${OWN_PASSWORD_MIN_LENGTH} to ${OWN_PASSWORD_MAX_LENGTH} characters.`;
  }
  if (newPassword === currentPassword) {
    return "Choose a new password that is different from your current one.";
  }
  if (newPassword !== confirmation) return "The new passwords do not match.";
  return null;
}
