import { useState, type FormEvent } from "react";
import { OWN_PASSWORD_MAX_LENGTH, OWN_PASSWORD_MIN_LENGTH, validateOwnPasswordChange } from "@jewelos/core";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { Panel } from "@/features/analytics/components";
import { changeOwnPassword } from "./api";

type Props = Readonly<{ onChange?: typeof changeOwnPassword }>;

/** Lets every signed-in employee change their own login password. */
export function ChangePasswordCard({ onChange = changeOwnPassword }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setDone(false);
    const problem = validateOwnPasswordChange(currentPassword, newPassword, confirmPassword);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    try {
      await onChange(currentPassword, newPassword);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your password could not be changed.");
    } finally { setSaving(false); }
  };

  const type = showPasswords ? "text" : "password";
  return <Panel title="Change password" description="Choose a new password for signing in to JewelOS.">
    <ol className="mb-4 list-decimal space-y-1 pl-5 text-xs text-task-text-muted">
      <li>Type your current password (the one you used to sign in today).</li>
      <li>Type a new password of {OWN_PASSWORD_MIN_LENGTH} to {OWN_PASSWORD_MAX_LENGTH} characters, then type it again to confirm.</li>
      <li>Press <span className="font-medium text-task-text">Change password</span>. Use the new password the next time you sign in, on the computer and in the phone app.</li>
    </ol>
    <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? <Notice tone="success">Password changed. Use your new password the next time you sign in.</Notice> : null}
      <label><span className="mb-1 block text-xs font-medium text-task-text-muted">Current password</span><input autoComplete="current-password" className="task-field" onChange={(event) => setCurrentPassword(event.target.value)} type={type} value={currentPassword} /></label>
      <label><span className="mb-1 block text-xs font-medium text-task-text-muted">New password</span><input autoComplete="new-password" className="task-field" maxLength={OWN_PASSWORD_MAX_LENGTH} onChange={(event) => setNewPassword(event.target.value)} type={type} value={newPassword} /></label>
      <label><span className="mb-1 block text-xs font-medium text-task-text-muted">Confirm new password</span><input autoComplete="new-password" className="task-field" maxLength={OWN_PASSWORD_MAX_LENGTH} onChange={(event) => setConfirmPassword(event.target.value)} type={type} value={confirmPassword} /></label>
      <button aria-pressed={showPasswords} className="flex items-center gap-2 self-start text-xs font-medium text-task-text-muted hover:text-gold-secondary" onClick={() => setShowPasswords((shown) => !shown)} type="button">{showPasswords ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{showPasswords ? "Hide passwords" : "Show passwords"}</button>
      <Button disabled={saving} type="submit"><KeyRound />{saving ? "Changing…" : "Change password"}</Button>
      <p className="text-xs text-task-text-muted">Forgot your current password? Ask your Super Admin to set a new one for you, sign in with it, then change it here.</p>
    </form>
  </Panel>;
}
