/**
 * The asterisk a required control adds after its label — unless the label
 * already carries one.
 *
 * Several labels are copied verbatim from the web forms, where the asterisk is
 * part of the string itself ("Core Task *"). A control that appends its own on
 * top of that printed "Core Task * *", so the marker is added only when the
 * label has not already made the field's status clear.
 */
export function requiredMark(label: string, required: boolean): string {
  if (!required) return "";
  return label.trimEnd().endsWith("*") ? "" : " *";
}
