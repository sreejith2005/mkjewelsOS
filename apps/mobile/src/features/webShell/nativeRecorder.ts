import { NativeEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";
import type { RecorderCommand } from "./webShellBridge";
interface RecorderNative { command(raw: string): Promise<string | null>; bridgeToken?: () => Promise<string>; addListener(name: string): void; removeListeners(count: number): void }
// React Native's native module registry is untyped; validate its methods before use.
const candidate: unknown = NativeModules.JewelOSRecorder;
function native(): RecorderNative | null {
 if (!candidate || typeof candidate !== "object" || !("command" in candidate) || typeof candidate.command !== "function") return null;
 return candidate as RecorderNative;
}
/** Absent on older shells: leave web navigation available without recorder capability. */
export async function recorderBridgeToken(): Promise<string | null> {
 const module = native();
 if (typeof module?.bridgeToken !== "function") return null;
 try { const token = await module.bridgeToken(); return /^[a-f0-9]{64}$/.test(token) ? token : null; } catch { return null; }
}
export async function sendRecorderCommand(command: RecorderCommand): Promise<string | null> {
 const module = native();
 if (!module) throw new Error("recorder_unavailable");
 const existing = command.kind === "recorder.start" ? await module.command(JSON.stringify({kind:"recorder.status",requestId:command.requestId})) : null;
 const scope: unknown = existing ? JSON.parse(existing) : null;
 const refresh = command.kind === "recorder.start" && scope && typeof scope === "object" && "sessionId" in scope && scope.sessionId === command.session.id;
 if ((command.kind === "recorder.start" && !refresh) || command.kind === "recorder.resume") {
  const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (Platform.OS === "android" && Number(Platform.Version) >= 33) permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  const result = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some(permission => result[permission] !== PermissionsAndroid.RESULTS.GRANTED)) throw new Error("permission_denied");
 }
 const reply = await module.command(JSON.stringify(command));
 if (!reply) return null;
 const value: unknown = JSON.parse(reply);
 return JSON.stringify({ ...(value && typeof value === "object" ? value : {}), requestId: command.requestId });
}
export function subscribeRecorder(listener: (raw: string) => void): () => void {
 const module = native();
 if (!module) return () => {};
 const sub = new NativeEventEmitter(module).addListener("JewelOSRecorder", listener);
 return () => sub.remove();
}
