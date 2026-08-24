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
