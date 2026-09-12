import { Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import type { UploadableFile } from "@jewelos/data/runtime";
import { log } from "@/lib/log";

/** What every JewelOS bucket accepts. Kept in step with the server's checks. */
export const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
/** Task completion evidence is images only (`uploadAndCompleteTask`). */
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type PickSource = "camera" | "library" | "document";
export type PickOptions = Readonly<{ imagesOnly?: boolean }>;

const EXTENSION_FOR: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/**
 * The server matches a file's extension against its MIME type. A gallery photo
 * the picker re-encoded as JPEG can still carry its original name (`IMG_1.HEIC`),
 * so the name is corrected to the type the bytes actually are.
 */
function normalizedName(name: string, mimeType: string): string {
  const extension = EXTENSION_FOR[mimeType];
  if (!extension) return name;
  const current = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  const accepted = mimeType === "image/jpeg" ? [".jpg", ".jpeg"] : [extension];
  if (current && accepted.includes(current)) return name;
  const base = name.replace(/\.[^.]+$/, "") || `upload-${Date.now()}`;
  return `${base}${extension}`;
}

/**
 * Reads a picked file into bytes the shared upload path can send.
 *
 * A native picker returns a `file://` URI, not a `File`, and Supabase Storage on
 * React Native cannot upload from a URI. `expo-file-system`'s `File` reads the
 * bytes directly. (Its old `readAsStringAsync` now throws at run time, which is
 * what made every upload report that the file could not be read.)
 */
async function readAsUpload(uri: string, name: string, mimeType: string): Promise<UploadableFile> {
  const body = await new File(uri).arrayBuffer();
  return { name: normalizedName(name, mimeType), size: body.byteLength, type: mimeType, body };
}

/** The MIME type a filename implies, for a picker that did not report one. */
function inferMimeType(name: string): string {
  const extension = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".pdf") return "application/pdf";
  return "image/jpeg";
}

export type PickResult =
  | Readonly<{ ok: true; file: UploadableFile }>
  | Readonly<{ ok: false; cancelled: boolean; message: string }>;

/**
 * Opens the requested picker and returns the chosen file's bytes.
 *
 * Permission is requested at the point of use rather than at startup, which is
 * both what Android expects and what makes the prompt understandable: the
 * person has just tapped "Camera".
 */
export async function pickFile(source: PickSource, options: PickOptions = {}): Promise<PickResult> {
  try {
    if (source === "document") {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: options.imagesOnly ? [...IMAGE_MIME_TYPES] : [...ACCEPTED_MIME_TYPES],
      });
      if (result.canceled) return { ok: false, cancelled: true, message: "No file chosen." };
      const asset = result.assets[0];
      if (!asset) return { ok: false, cancelled: true, message: "No file chosen." };
      return {
        ok: true,
        file: await readAsUpload(asset.uri, asset.name, asset.mimeType ?? inferMimeType(asset.name)),
      };
    }

    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return {
        ok: false,
        cancelled: false,
        message:
          source === "camera"
            ? "JewelOS needs camera access to capture evidence. Enable it in Settings › Apps › JewelOS › Permissions."
            : "JewelOS needs photo access to attach an image. Enable it in Settings › Apps › JewelOS › Permissions.",
      };
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.7, mediaTypes: ["images"] })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, mediaTypes: ["images"] });
    if (result.canceled) return { ok: false, cancelled: true, message: "No image chosen." };
    const asset = result.assets[0];
    if (!asset) return { ok: false, cancelled: true, message: "No image chosen." };
    const name = asset.fileName ?? `capture-${Date.now()}.jpg`;
    return { ok: true, file: await readAsUpload(asset.uri, name, asset.mimeType ?? inferMimeType(name)) };
  } catch (error) {
    log.error("upload", `could not read the ${source} selection`, error);
    return { ok: false, cancelled: false, message: "That file could not be read. Try a different one." };
  }
}

/**
 * Asks where the file comes from — the phone's own camera, gallery, or files —
 * which is the choice a web file input offers on a phone. Resolves `null` when
 * the person dismisses it.
 */
export function chooseSource(title: string, options: PickOptions = {}): Promise<PickSource | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: PickSource | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    Alert.alert(
      title,
      options.imagesOnly ? "A JPEG, PNG, or WebP image up to 5 MB." : "A JPG, PNG, WebP image, or a PDF.",
      [
        { text: "Camera", onPress: () => settle("camera") },
        { text: "Gallery", onPress: () => settle("library") },
        { text: "Files", onPress: () => settle("document") },
      ],
      { cancelable: true, onDismiss: () => settle(null) },
    );
  });
}

/** `chooseSource` followed by `pickFile`, for a single "Upload" control. */
export async function pickFileFromChooser(title: string, options: PickOptions = {}): Promise<PickResult> {
  const source = await chooseSource(title, options);
  if (!source) return { ok: false, cancelled: true, message: "No file chosen." };
  return pickFile(source, options);
}
