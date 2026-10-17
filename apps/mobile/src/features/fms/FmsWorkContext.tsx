import { useCallback, useState } from "react";
import { presentFmsWorkContext } from "@jewelos/core";
import { loadFmsWorkContext, signedFmsContextFileUrl } from "@jewelos/data/fms/work";
import * as WebBrowser from "expo-web-browser";
import { useAsyncData } from "@/lib/useAsyncData";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { ErrorState } from "@/ui/states";

export function FmsWorkContext({ instanceId, instanceStageId }: { instanceId: string; instanceStageId: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [openingFile, setOpeningFile] = useState(false);
  const openFile = async (id: string) => {
    setOpeningFile(true); setFileError(null);
    try { await WebBrowser.openBrowserAsync(await signedFmsContextFileUrl(instanceId, instanceStageId, id)); }
    catch (error) { setFileError(error instanceof Error ? error.message : "Could not open attachment"); }
    finally { setOpeningFile(false); }
  };
  const load = useCallback(() => loadFmsWorkContext(instanceId, instanceStageId, cursor), [instanceId, instanceStageId, cursor]);
  const { data, error, reload } = useAsyncData(load, [load]);
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!data) return <Text tone="muted">Loading work details…</Text>;
  const presentation = presentFmsWorkContext(data);
  return <Card>
    <Text tone="muted">{`${data.workflowName} ? ${presentation.reference}`}</Text>
    <Text variant="subtitle" weight="semibold">{presentation.title}</Text>
    <Text>{data.instructions}</Text>
    <Text tone="muted">{data.expectedResult}</Text>
    {presentation.answers.map((field, index) => <Text key={index}>{`${field.label}: ${field.display}`}</Text>)}
    {data.receivedFields.flatMap(field => field.attachment ? [<Button key={field.attachment.id} label={`Open attachment: ${field.attachment.name}`} disabled={openingFile} variant="secondary" onPress={() => { if (field.attachment) void openFile(field.attachment.id); }} />] : [])}
    {fileError ? <Text tone="danger">{fileError}</Text> : null}
    <Text weight="semibold">Journey</Text>
    {data.journey.map(visit => <Text key={visit.id}>{`${visit.stageName} · visit ${visit.visitNumber} · ${visit.employeeName ?? "Pending"} · ${visit.status.replaceAll("_", " ")}`}</Text>)}
    {data.nextCursor ? <Button label="Next history page" variant="secondary" onPress={() => setCursor(data.nextCursor)} /> : null}
    {cursor ? <Button label="Latest work details" variant="ghost" onPress={() => setCursor(null)} /> : null}
  </Card>;
}
