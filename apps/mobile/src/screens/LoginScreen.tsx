import { useRef, useState } from "react";
import { Image, StyleSheet, TextInput, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Banner } from "@/ui/states";

const logo = require("../../assets/splash-icon.png") as number;

export function LoginScreen() {
  const styles = useStyles();
  const { signIn, statusMessage } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    if (submitting) return;
    if (!username.trim() || !password) {
      setError("Enter your username or work email and your password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      setError(await signIn(username.trim(), password));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll>
      <View style={styles.body}>
        <Image accessibilityLabel="MK Jewels" resizeMode="contain" source={logo} style={styles.logo} />
        <Text style={styles.centred} tone="muted" variant="body">
          Sign in to JewelOS
        </Text>

        {statusMessage ? <Banner tone="danger">{statusMessage}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <TextField
          autoCapitalize="none"
          autoComplete="username"
          autoCorrect={false}
          keyboardType="email-address"
          label="Username or work email"
          onChangeText={(value) => setUsername(value.toLowerCase())}
          // Moving to the password field rather than submitting is what an
          // Android keyboard's "next" key is expected to do on a two-field form.
          onSubmitEditing={() => passwordRef.current?.focus()}
          required
          returnKeyType="next"
          textContentType="username"
          value={username}
        />
        <TextField
          autoCapitalize="none"
          autoComplete="current-password"
          autoCorrect={false}
          label="Password"
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          ref={passwordRef}
          required
          returnKeyType="go"
          secure
          textContentType="password"
          value={password}
        />

        <Button
          busy={submitting}
          full
          label={submitting ? "Signing in…" : "Sign in"}
          onPress={() => void submit()}
          size="large"
        />
        <Text style={styles.centred} tone="muted" variant="caption">
          For a password reset, contact your Super Admin.
        </Text>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  body: { flex: 1, justifyContent: "center", gap: theme.space.md, paddingVertical: theme.space.xl },
  // A ratio rather than a fixed height, so the wordmark scales with the screen
  // instead of dominating a small phone.
  logo: { width: "70%", height: 64, alignSelf: "center", marginBottom: theme.space.sm },
  centred: { textAlign: "center" },
}));
