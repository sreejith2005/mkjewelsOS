export type OrganizationPerson = Readonly<{ id: string; reports_to_user_id: string | null; employee_name: string }>;
export type OrganizationNode<T extends OrganizationPerson> = T & Readonly<{ children: readonly OrganizationNode<T>[]; descendantCount: number; orphaned: boolean; cycle: boolean }>;

export function buildOrganizationTree<T extends OrganizationPerson>(people: readonly T[]): readonly OrganizationNode<T>[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const byManager = new Map<string, T[]>();
  const roots: T[] = [];
  for (const person of people) {
    const manager = person.reports_to_user_id;
    if (!manager || !byId.has(manager) || manager === person.id) roots.push(person);
    else byManager.set(manager, [...(byManager.get(manager) ?? []), person]);
  }
  const sort = (items: readonly T[]) => [...items].sort((a, b) => a.employee_name.localeCompare(b.employee_name) || a.id.localeCompare(b.id));
  const visited = new Set<string>();
  const build = (person: T, active: ReadonlySet<string>, forcedCycle = false): OrganizationNode<T> => {
    visited.add(person.id);
    const nextActive = new Set(active); nextActive.add(person.id);
    let cycle = forcedCycle || person.reports_to_user_id === person.id;
    const children = sort(byManager.get(person.id) ?? []).flatMap((child) => {
      if (active.has(child.id) || visited.has(child.id)) { cycle = true; return []; }
      return [build(child, nextActive)];
    });
    return { ...person, children, descendantCount: children.reduce((sum, child) => sum + 1 + child.descendantCount, 0), orphaned: Boolean(person.reports_to_user_id && !byId.has(person.reports_to_user_id)), cycle };
  };
  const result = sort(roots).map((root) => build(root, new Set()));
  for (const person of sort(people)) if (!visited.has(person.id)) result.push(build(person, new Set(), true));
  return result;
}
