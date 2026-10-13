import { useRef, useState } from "react";

type Problem = { control: HTMLElement; label: string; message: string };
type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function focusProblem(control: HTMLElement) {
  control.focus({ preventScroll: true });
  control.scrollIntoView?.({ block: "center", behavior: "smooth" });
}

/** UI feedback only. Audited RPCs remain the validation and authorization boundary. */
export function useFormValidation() {
  const formRef = useRef<HTMLFormElement>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  function showProblems(next: Problem[]) {
    problems.forEach(({ control }) => control.removeAttribute("aria-invalid"));
    next.forEach(({ control }) => control.setAttribute("aria-invalid", "true"));
    setProblems(next);
    if (next[0]) focusProblem(next[0].control);
  }
  function validateRequired() {
    const controls = formRef.current?.querySelectorAll<FormControl>("input,select,textarea");
    const next = [...(controls ?? [])].filter(control => control.willValidate && !control.validity.valid).map(control => ({
      control,
      label: control.getAttribute("aria-label") ?? control.labels?.[0]?.textContent?.trim() ?? "Field",
      message: control.validity.valueMissing ? "Required" : control.validationMessage,
    }));
    showProblems(next);
    return next.length === 0;
  }
  function reject(message: string, labels: string[]) {
    const controls = [...(formRef.current?.querySelectorAll<HTMLElement>("[aria-label]") ?? [])];
    showProblems(labels.flatMap(label => {
      const control = controls.find(item => item.getAttribute("aria-label") === label);
      return control ? [{ control, label, message }] : [];
    }));
  }
  function clearControl(target: EventTarget) {
    if (!(target instanceof HTMLElement)) return;
    target.removeAttribute("aria-invalid");
    setProblems(current => current.filter(({ control }) => {
      if (control === target || control.contains(target)) {
        control.removeAttribute("aria-invalid");
        return false;
      }
      return true;
    }));
  }
  return { formRef, problems, validateRequired, reject, clearControl };
}

export function FormValidationSummary({ problems }: { problems: Problem[] }) {
  if (!problems.length) return null;
  return <section role="region" aria-label="Fields to complete" className="crm-form-errors" aria-live="polite">
    <p>Please complete or correct these fields:</p>
    <ul>{problems.map(({ control, label, message }, index) => <li key={`${label}-${index}`}>
      <button type="button" onClick={() => focusProblem(control)}>{label}: {message}</button>
    </li>)}</ul>
  </section>;
}
