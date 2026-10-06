import {
  LAYOUT_FIELD_TYPES, formAnswerOptions, readAnswerRoutes, readGuidedConditionLinks,
  setAnswerRoute, setQuestionAnswerCondition,
  type AnswerRoute, type FormChoiceSources, type FormFieldDefinition, type FormTemplateDefinition,
} from "@jewelos/core";
import { OptionPicker } from "@/ui/OptionPicker";
import { Banner } from "@/ui/states";
import { TextField } from "@/ui/TextField";

type Props = {
  definition: FormTemplateDefinition;
  field: FormFieldDefinition;
  sources: FormChoiceSources;
  onChange: (definition: FormTemplateDefinition) => void;
};

const routeValue = (route: AnswerRoute | undefined): string => route?.kind === "question" ? `question:${route.questionKey}`
  : route?.kind === "section" ? `section:${route.sectionKey}` : route?.kind === "submit" ? "submit" : "continue";
const parseRoute = (value: string): AnswerRoute => value.startsWith("question:") ? { kind: "question", questionKey: value.slice(9) }
  : value.startsWith("section:") ? { kind: "section", sectionKey: value.slice(8) } : value === "submit" ? { kind: "submit" } : { kind: "continue" };

export function AnswerRoutingEditor({ definition, field, sources, onChange }: Props) {
  const options = formAnswerOptions(field, sources) ?? [];
  const sections = definition.sections ?? [];
  const later = definition.fields.slice(definition.fields.findIndex((item) => item.key === field.key) + 1)
    .filter((item) => !LAYOUT_FIELD_TYPES.has(item.type) && readGuidedConditionLinks(item) !== null);
  const destinations = [{ value: "continue", label: "Continue normally" },
    ...later.map((item) => ({ value: `question:${item.key}`, label: `Ask ${item.label || item.key}` })),
    ...sections.slice(sections.findIndex((item) => item.key === field.sectionKey) + 1)
      .map((item) => ({ value: `section:${item.key}`, label: `Skip to ${item.title}` })),
    { value: "submit", label: "Submit the form" }];
  const routes = readAnswerRoutes(definition.fields, sections, field.key);
  if (!options.length) return <Banner>Add answer choices first, then map what happens after each answer.</Banner>;
  return <>{options.map((option) => <OptionPicker key={option.value} label={`Route after ${option.label}`}
    options={destinations} selected={[routeValue(routes.get(option.value))]}
    onChange={(selected) => onChange({ ...definition, fields: setAnswerRoute(definition.fields, field.key, option.value, parseRoute(selected[0] ?? "continue")) })} />)}</>;
}

export function QuestionConditionEditor({ definition, field, sources, onChange }: Props) {
  const links = readGuidedConditionLinks(field);
  if (links === null) return <Banner>This question has a complex condition. It is preserved and continues to run.</Banner>;
  const earlier = definition.fields.slice(0, definition.fields.findIndex((item) => item.key === field.key))
    .filter((item) => !LAYOUT_FIELD_TYPES.has(item.type) && ((formAnswerOptions(item, sources)?.length ?? 0) > 0 || item.key === links[0]?.sourceKey));
  const source = earlier.find((item) => item.key === links[0]?.sourceKey);
  const options = source ? formAnswerOptions(source, sources) : null;
  const update = (key: string | undefined, value: string | undefined) => onChange({ ...definition,
    fields: setQuestionAnswerCondition(definition.fields, field.key, key, value) });
  return <>
    <OptionPicker label="Show this question when question" options={[{ value: "", label: "Always show this question" }, ...earlier.map((item) => ({ value: item.key, label: item.label || item.key }))]}
      selected={[source?.key ?? ""]} onChange={(selected) => {
        const next = earlier.find((item) => item.key === selected[0]);
        const first = next ? formAnswerOptions(next, sources)?.[0]?.value : undefined;
        if (next?.key === source?.key && first === undefined) return;
        update(next?.key, first);
      }} />
    {source && options ? <OptionPicker label="Show this question when answer" options={options}
      selected={links[0]?.optionValue === undefined ? [] : [String(links[0].optionValue)]}
      onChange={(selected) => update(source.key, selected[0])} /> : null}
    {source && !options ? <TextField label="Required answer" value={String(links[0]?.optionValue ?? "")} onChangeText={(value) => update(source.key, value)} /> : null}
    {links.length > 1 ? <Banner>This question is mapped from several answers. Changing these controls replaces those mappings.</Banner> : null}
  </>;
}
