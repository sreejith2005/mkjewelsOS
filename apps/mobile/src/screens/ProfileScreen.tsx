import { StyleSheet } from "react-native";
import { useAuth, useProfile } from "@/auth/AuthProvider";
import { titleCase } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { Card, CardRow } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Who the viewer is, as the server sees them. Read-only: roster changes are an audited administrative action. */
export function ProfileScreen() {
  const styles = useStyles();
  const profile = useProfile();
  const { branch } = useAuth();
  return (
    <Screen scroll>
      <Text style={styles.name} variant="title" weight="semibold">
        {profile.employee_name}
      </Text>
      <Card>
        <CardRow label="Role" value={titleCase(profile.user_role)} />
        <CardRow label="Employee code" value={profile.employee_code ?? "—"} />
        <CardRow label="Branch" value={branch?.name ?? "—"} />
        <CardRow label="Working status" value={titleCase(profile.working_status ?? "unknown")} />
        {profile.email ? <CardRow label="Work email" value={profile.email} /> : null}
      </Card>
      <Text tone="muted" variant="caption">
        To change any of this, contact your administrator. Roster changes are recorded in the audit log.
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({ name: { marginBottom: theme.space.xs } }));
