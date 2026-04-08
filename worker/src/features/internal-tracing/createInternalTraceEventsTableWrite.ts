import type {
  EventRecordInsertType,
  InternalTraceDirectEventWrite,
  InternalTraceEventInput,
  InternalTraceExperimentContext,
} from "@langfuse/shared/src/server";
import { clickhouseClient, redis } from "@langfuse/shared/src/server";
import { prisma } from "@langfuse/shared/src/db";
import { ClickhouseWriter } from "../../services/ClickhouseWriter";
import { IngestionService } from "../../services/IngestionService";

let internalTraceIngestionService: IngestionService | undefined;

function getInternalTraceIngestionService(): IngestionService {
  if (!internalTraceIngestionService) {
    internalTraceIngestionService = new IngestionService(
      redis as any,
      prisma,
      ClickhouseWriter.getInstance(),
      clickhouseClient(),
    );
  }

  return internalTraceIngestionService;
}

export async function writeInternalTraceEventInputs(params: {
  rootSpanId: string;
  eventInputs: InternalTraceEventInput[];
}): Promise<{ rootEventRecord?: EventRecordInsertType }> {
  const ingestionService = getInternalTraceIngestionService();
  const eventRecords = await Promise.all(
    params.eventInputs.map((eventInput) =>
      ingestionService.createEventRecord(eventInput, ""),
    ),
  );

  for (const eventRecord of eventRecords) {
    ingestionService.writeEventRecord(eventRecord);
  }

  return {
    rootEventRecord: eventRecords.find(
      (eventRecord) => eventRecord.span_id === params.rootSpanId,
    ),
  };
}

export function createInternalTraceEventsTableWrite(params?: {
  experiment?: InternalTraceExperimentContext;
  onRootEventRecordReady?: (
    rootEventRecord: EventRecordInsertType,
  ) => void | Promise<void>;
}): InternalTraceDirectEventWrite {
  return {
    enabled: true,
    experiment: params?.experiment,
    writeEventInputs: writeInternalTraceEventInputs,
    onRootEventRecordReady: params?.onRootEventRecordReady,
  };
}
