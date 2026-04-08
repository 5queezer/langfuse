import { DatasetItemDomain, Prisma, stringifyValue } from "@langfuse/shared";
import {
  convertCallsToArrays,
  convertDefinitionsToMap,
  extractToolsFromObservation,
  flattenJsonToPathArrays,
  type ProcessedTraceEvent,
} from "@langfuse/shared/src/server";
import type { EventInput } from "../../services/IngestionService";
import type { PromptExperimentConfig } from "./utils";

const PROMPT_EXPERIMENT_EVENT_SOURCE = "ingestion-api-dual-write-experiments";

type PromptExperimentSnapshot = {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name?: string;
  type: "SPAN" | "GENERATION";
  environment?: string;
  version?: string;
  release?: string;
  startTimeISO?: string;
  endTimeISO?: string;
  completionStartTime?: string;
  level?: string;
  statusMessage?: string;
  promptName?: string;
  promptVersion?: string;
  modelName?: string;
  modelParameters?: Record<string, unknown>;
  providedUsageDetails?: Record<string, number>;
  providedCostDetails?: Record<string, number>;
  input?: unknown;
  output?: unknown;
  metadata: Record<string, unknown>;
  tags?: string[];
  public?: boolean;
  bookmarked?: boolean;
  userId?: string;
  sessionId?: string;
};

export type MaterializedPromptExperimentTrace = {
  rootSpanId: string;
  snapshots: PromptExperimentSnapshot[];
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumberRecord(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);

  if (!record) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(record).filter(
      ([, entry]) => typeof entry === "number" && Number.isFinite(entry),
    ),
  ) as Record<string, number>;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isCreateEvent(type: string): boolean {
  return type.endsWith("-create");
}

function getSnapshotType(eventType: string): "SPAN" | "GENERATION" {
  return eventType.startsWith("generation-") ? "GENERATION" : "SPAN";
}

function getEventTime(
  event: ProcessedTraceEvent,
  body: Record<string, unknown>,
): number {
  const candidates = [body.startTime, body.timestamp, event.timestamp];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const parsed = new Date(candidate).getTime();
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

function getTimestampMs(timestamp?: string): number {
  if (!timestamp) {
    return 0;
  }

  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortEvents(events: ProcessedTraceEvent[]): ProcessedTraceEvent[] {
  return [...events].sort((left, right) => {
    const timeDelta =
      getEventTime(left, left.body) - getEventTime(right, right.body);

    if (timeDelta !== 0) {
      return timeDelta;
    }

    if (isCreateEvent(left.type) === isCreateEvent(right.type)) {
      return 0;
    }

    return isCreateEvent(left.type) ? -1 : 1;
  });
}

function flattenMetadata(value: unknown): {
  names: string[];
  values: Array<string | null | undefined>;
} {
  const metadata = asRecord(value);
  return metadata
    ? flattenJsonToPathArrays(metadata)
    : { names: [], values: [] };
}

function mergeSnapshotEvent(
  snapshot: PromptExperimentSnapshot,
  event: ProcessedTraceEvent,
): PromptExperimentSnapshot {
  const { body } = event;
  const startTime = asString(body.startTime);
  const timestamp = asString(body.timestamp) ?? asString(event.timestamp);
  const metadata = asRecord(body.metadata);

  return {
    ...snapshot,
    traceId: asString(body.traceId) ?? snapshot.traceId,
    parentSpanId: asString(body.parentObservationId) ?? snapshot.parentSpanId,
    type:
      snapshot.type === "GENERATION"
        ? snapshot.type
        : getSnapshotType(event.type),
    name: asString(body.name) ?? snapshot.name,
    environment: asString(body.environment) ?? snapshot.environment,
    version: asString(body.version) ?? snapshot.version,
    release: asString(body.release) ?? snapshot.release,
    startTimeISO:
      startTime ?? snapshot.startTimeISO ?? timestamp ?? snapshot.startTimeISO,
    endTimeISO: asString(body.endTime) ?? snapshot.endTimeISO,
    completionStartTime:
      asString(body.completionStartTime) ?? snapshot.completionStartTime,
    level: asString(body.level) ?? snapshot.level,
    statusMessage: asString(body.statusMessage) ?? snapshot.statusMessage,
    promptName: asString(body.promptName) ?? snapshot.promptName,
    promptVersion:
      typeof body.promptVersion === "number"
        ? body.promptVersion.toString()
        : (asString(body.promptVersion) ?? snapshot.promptVersion),
    modelName: asString(body.model) ?? snapshot.modelName,
    modelParameters: asRecord(body.modelParameters) ?? snapshot.modelParameters,
    providedUsageDetails:
      asNumberRecord(body.usageDetails) ??
      asNumberRecord(body.usage) ??
      snapshot.providedUsageDetails,
    providedCostDetails:
      asNumberRecord(body.costDetails) ?? snapshot.providedCostDetails,
    input:
      body.input !== undefined && body.input !== null
        ? body.input
        : snapshot.input,
    output:
      body.output !== undefined && body.output !== null
        ? body.output
        : snapshot.output,
    metadata: metadata
      ? { ...snapshot.metadata, ...metadata }
      : snapshot.metadata,
    tags: asStringArray(body.tags) ?? snapshot.tags,
    public: asBoolean(body.public) ?? snapshot.public,
    bookmarked: asBoolean(body.bookmarked) ?? snapshot.bookmarked,
    userId: asString(body.userId) ?? snapshot.userId,
    sessionId: asString(body.sessionId) ?? snapshot.sessionId,
  };
}

export function materializePromptExperimentTrace(params: {
  processedEvents: ProcessedTraceEvent[];
  traceId: string;
}): MaterializedPromptExperimentTrace {
  const { processedEvents, traceId } = params;
  const snapshots = new Map<string, PromptExperimentSnapshot>();
  const rootSpanId =
    asString(
      processedEvents.find((event) => event.type === "trace-create")?.body.id,
    ) ?? traceId;

  for (const event of sortEvents(processedEvents)) {
    const spanId = asString(event.body.id);

    if (!spanId) {
      continue;
    }

    const existingSnapshot =
      snapshots.get(spanId) ??
      ({
        spanId,
        traceId: asString(event.body.traceId) ?? traceId,
        type: getSnapshotType(event.type),
        metadata: {},
      } satisfies PromptExperimentSnapshot);

    snapshots.set(spanId, mergeSnapshotEvent(existingSnapshot, event));
  }

  const orderedSnapshots = [...snapshots.values()].sort((left, right) => {
    if (left.spanId === rootSpanId) {
      return -1;
    }

    if (right.spanId === rootSpanId) {
      return 1;
    }

    return (
      getTimestampMs(left.startTimeISO) - getTimestampMs(right.startTimeISO)
    );
  });

  return {
    rootSpanId,
    snapshots: orderedSnapshots,
  };
}

export function buildPromptExperimentEventInputs(params: {
  processedEvents: ProcessedTraceEvent[];
  traceId: string;
  projectId: string;
  datasetItem: DatasetItemDomain & { input: Prisma.JsonObject };
  config: PromptExperimentConfig;
}): {
  rootSpanId: string;
  eventInputs: EventInput[];
} {
  const { processedEvents, traceId, projectId, datasetItem, config } = params;
  const { rootSpanId, snapshots } = materializePromptExperimentTrace({
    processedEvents,
    traceId,
  });
  const rootSnapshot = snapshots.find(
    (snapshot) => snapshot.spanId === rootSpanId,
  );

  if (!rootSnapshot) {
    return { rootSpanId, eventInputs: [] };
  }

  const experimentMetadata = flattenMetadata(config.datasetRun.metadata);
  const experimentItemMetadata = flattenMetadata(datasetItem.metadata);

  const eventInputs = snapshots.map((snapshot) => {
    const { toolDefinitions, toolArguments } = extractToolsFromObservation(
      snapshot.input,
      snapshot.output,
    );
    const toolCalls = convertCallsToArrays(toolArguments);

    return {
      projectId,
      traceId,
      spanId: snapshot.spanId,
      parentSpanId:
        snapshot.spanId === rootSpanId
          ? undefined
          : (snapshot.parentSpanId ?? rootSpanId),
      name:
        snapshot.name ??
        (snapshot.type === "GENERATION"
          ? "generation"
          : (rootSnapshot.name ?? "span")),
      type: snapshot.type,
      environment: snapshot.environment ?? rootSnapshot.environment,
      version: snapshot.version ?? rootSnapshot.version,
      release: rootSnapshot.release,
      startTimeISO:
        snapshot.startTimeISO ??
        rootSnapshot.startTimeISO ??
        new Date().toISOString(),
      endTimeISO:
        snapshot.endTimeISO ??
        snapshot.startTimeISO ??
        rootSnapshot.endTimeISO ??
        rootSnapshot.startTimeISO ??
        new Date().toISOString(),
      completionStartTime: snapshot.completionStartTime,
      traceName: rootSnapshot.name,
      tags: rootSnapshot.tags ?? [],
      bookmarked: rootSnapshot.bookmarked,
      public: rootSnapshot.public,
      userId: rootSnapshot.userId,
      sessionId: rootSnapshot.sessionId,
      level: snapshot.level ?? "DEFAULT",
      statusMessage: snapshot.statusMessage,
      promptName: snapshot.promptName,
      promptVersion: snapshot.promptVersion,
      modelName: snapshot.modelName,
      modelParameters: snapshot.modelParameters,
      providedUsageDetails: snapshot.providedUsageDetails,
      providedCostDetails: snapshot.providedCostDetails,
      toolDefinitions: convertDefinitionsToMap(toolDefinitions),
      toolCalls: toolCalls.tool_calls,
      toolCallNames: toolCalls.tool_call_names,
      input:
        snapshot.input !== undefined
          ? stringifyValue(snapshot.input)
          : undefined,
      output:
        snapshot.output !== undefined
          ? stringifyValue(snapshot.output)
          : undefined,
      metadata: snapshot.metadata,
      source: PROMPT_EXPERIMENT_EVENT_SOURCE,
      experimentId: config.runId,
      experimentName: config.datasetRun.name,
      experimentMetadataNames: experimentMetadata.names,
      experimentMetadataValues: experimentMetadata.values,
      experimentDescription: config.datasetRun.description ?? undefined,
      experimentDatasetId: datasetItem.datasetId,
      experimentItemId: datasetItem.id,
      experimentItemVersion: datasetItem.validFrom.toISOString(),
      experimentItemRootSpanId: rootSpanId,
      experimentItemExpectedOutput:
        datasetItem.expectedOutput !== undefined &&
        datasetItem.expectedOutput !== null
          ? stringifyValue(datasetItem.expectedOutput)
          : undefined,
      experimentItemMetadataNames: experimentItemMetadata.names,
      experimentItemMetadataValues: experimentItemMetadata.values,
    } satisfies EventInput;
  });

  return {
    rootSpanId,
    eventInputs,
  };
}
