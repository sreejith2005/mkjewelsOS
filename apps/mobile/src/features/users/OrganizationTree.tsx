import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { UserDirectoryProfile } from "@jewelos/data/users/api";
import { buildOrganizationTree, type OrganizationNode } from "./organizationTreeModel";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { Text } from "@/ui/Text";

type Row = { node: OrganizationNode<UserDirectoryProfile>; depth: number };
export function OrganizationTree({ profiles, onEdit, canManage }: { profiles: readonly UserDirectoryProfile[]; onEdit: (profile: UserDirectoryProfile) => void; canManage: boolean }) {
  const styles = useStyles(); const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => { const output: Row[] = []; const visit = (node: OrganizationNode<UserDirectoryProfile>, depth: number) => { output.push({ node, depth }); if (!collapsed.has(node.id)) node.children.forEach((child) => visit(child, depth + 1)); }; buildOrganizationTree(profiles).forEach((root) => visit(root, 0)); return output; }, [collapsed, profiles]);
  return <View style={styles.list}>{rows.map(({ node, depth }) => <View key={node.id} style={{ marginLeft: Math.min(depth, 5) * 16 }}><Card accent={node.cycle ? "danger" : node.orphaned ? "warning" : "none"}><View style={styles.heading}><View style={styles.copy}><Text weight="semibold">{node.employee_name}</Text><Text tone="muted" variant="caption">{node.employee_code} · {node.user_role.replaceAll("_", " ")}</Text></View><StatusBadge label={`${node.descendantCount} report${node.descendantCount === 1 ? "" : "s"}`} /></View>{node.orphaned ? <Text tone="warning" variant="caption">Reporting manager is outside this filtered view.</Text> : null}{node.cycle ? <Text tone="danger" variant="caption">Reporting cycle detected; hierarchy was safely cut here.</Text> : null}<View style={styles.actions}>{node.children.length ? <Button label={collapsed.has(node.id) ? "Expand team" : "Collapse team"} variant="ghost" onPress={() => setCollapsed((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })} /> : null}{canManage ? <Button label="Edit" variant="secondary" onPress={() => onEdit(node)} /> : null}</View></Card></View>)}</View>;
}
const useStyles = makeStyles((theme) => StyleSheet.create({ list: { gap: theme.space.sm }, heading: { flexDirection: "row", gap: theme.space.sm, alignItems: "flex-start" }, copy: { flex: 1, minWidth: 0 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs } }));
