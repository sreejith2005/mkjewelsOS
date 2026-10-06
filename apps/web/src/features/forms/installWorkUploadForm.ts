import { installWorkUploadForm as install } from "@jewelos/data/forms/installWorkUploadForm";
import { publishForm, saveDraft } from "./api";

/** Author action; the ordinary audited Forms draft/publish contracts own persistence. */
export async function installWorkUploadForm(): Promise<string> {
  return install({ saveDraft, publishForm });
}
