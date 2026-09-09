import { useState } from "react";
import { StyleSheet, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { FormAnswer } from "@jewelos/core";
import { signedFormFileUrl, uploadFormFile, validateFormUploadFile } from "@jewelos/data/forms/api";
import { errorText, log } from "@/lib/log";
import { pickFile, type PickSource } from "@/lib/pickFile";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { Banner } from "@/ui/states";

export type FileFieldProps = Readonly<{
  fieldKey: string;
  templateId?: string;
  value: string | null;
  disabled: boolean;
  onChange: (value: FormAnswer) => void;
}>;

/**
 * A file question. The upload happens as soon as something is chosen and the
 * answer stored is the registered file's id, exactly as on the web — so the
 * eventual submit carries a reference the server already knows about rather
 * than bytes that could fail halfway through.
 */
export function FileField({ fieldKey, templateId, value, disabled, onChange }: FileFieldProps) {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!templateId) {
    return <Banner>File upload becomes available once this form is saved.</Banner>;
  }

  const choose = async (source: PickSource) => {
    setError(null);
    const picked = await pickFile(source);
    if (!picked.ok) {
      if (!picked.cancelled) setError(picked.message);
      return;
    }
    // The same validator the web uses, so the two clients accept the same files.
    const invalid = validateFormUploadFile(picked.file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      const registered = await uploadFormFile(templateId, fieldKey, picked.file);
      onChange(registered.id);
      setName(registered.name);
    } catch (caught) {
      log.error("upload", "form file upload failed", caught);
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const view = async () => {
    if (!value) return;
    setOpening(true);
    setError(null);
    try {
      // A 60-second signed URL, opened in the system browser tab. The file is
      // never made public and the link is not shareable for long.
      await WebBrowser.openBrowserAsync(await signedFormFileUrl(value));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setOpening(false);
    }
  };

  if (value) {
    return (
      <View style={styles.group}>
        <Text tone="warm" variant="small">
          {name ?? "File uploaded"}
        </Text>
        <View style={styles.actions}>
          <Button busy={opening} label="View" onPress={() => void view()} variant="secondary" />
          {!disabled ? (
            <Button
              label="Replace"
              onPress={() => {
                onChange("");
                setName(null);
              }}
              variant="ghost"
            />
          ) : null}
        </View>
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
    );
  }

  if (disabled) {
    return (
      <Text tone="muted" variant="small">
        No file uploaded
      </Text>
    );
  }

  return (
    <View style={styles.group}>
      <View style={styles.actions}>
        <Button busy={busy} label="Camera" onPress={() => void choose("camera")} variant="secondary" />
        <Button busy={busy} label="Gallery" onPress={() => void choose("library")} variant="secondary" />
        <Button busy={busy} label="File" onPress={() => void choose("document")} variant="secondary" />
      </View>
      <Text tone="muted" variant="caption">
        JPG, PNG, WebP, or PDF up to 10 MB.
      </Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  group: { gap: theme.space.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
}));
