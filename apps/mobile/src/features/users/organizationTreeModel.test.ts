import { describe, expect, it } from "vitest";
import { buildOrganizationTree } from "./organizationTreeModel";

const person = (id: string, manager: string | null, name = id) => ({ id, reports_to_user_id: manager, employee_name: name });
describe("native organization hierarchy", () => {
  it("keeps multiple roots in stable name order and counts descendants", () => {
    const tree = buildOrganizationTree([person("b", null, "Beta"), person("a", null, "Alpha"), person("c", "a", "Child")]);
    expect(tree.map((node) => node.id)).toEqual(["a", "b"]);
    expect(tree[0]?.descendantCount).toBe(1);
  });
  it("promotes people whose manager is absent from the filtered set", () => {
    expect(buildOrganizationTree([person("child", "hidden")])[0]).toMatchObject({ id: "child", orphaned: true });
  });
  it("breaks cycles without losing people", () => {
    const tree = buildOrganizationTree([person("a", "b"), person("b", "a")]);
    expect(tree.flatMap((root) => [root.id, ...root.children.map((child) => child.id)]).sort()).toEqual(["a", "b"]);
    expect(tree.some((root) => root.cycle)).toBe(true);
  });
});
