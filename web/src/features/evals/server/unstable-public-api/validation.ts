import { InvalidRequestError, LangfuseConflictError } from "@langfuse/shared";
import type { PublicContinuousEvaluationMappingType } from "@/src/features/public-api/types/unstable-public-evals-contract";
import type { PrismaClientLike } from "./types";
import { getPrismaClient } from "./queries";

export function validateEvaluatorVariableMappings(params: {
  mappings: PublicContinuousEvaluationMappingType[];
  variables: string[];
}) {
  const variableSet = new Set(params.variables);
  const mappedVariables = new Set<string>();

  for (const mapping of params.mappings) {
    if (!variableSet.has(mapping.variable)) {
      throw new InvalidRequestError(
        `Mapping variable "${mapping.variable}" is not present in the evaluator prompt`,
      );
    }

    if (mappedVariables.has(mapping.variable)) {
      throw new InvalidRequestError(
        `Mapping variable "${mapping.variable}" can only be mapped once`,
      );
    }

    mappedVariables.add(mapping.variable);
  }

  const missingVariables = params.variables.filter(
    (variable) => !mappedVariables.has(variable),
  );

  if (missingVariables.length > 0) {
    throw new InvalidRequestError(
      `Missing mappings for evaluator variables: ${missingVariables.join(", ")}`,
    );
  }
}

export async function assertEvaluatorNameIsAvailable(params: {
  client?: PrismaClientLike;
  projectId: string;
  name: string;
  evaluatorId?: string;
}) {
  const client = getPrismaClient(params.client);

  const conflictingTemplate = await client.evalTemplate.findFirst({
    where: params.evaluatorId
      ? {
          projectId: params.projectId,
          name: params.name,
          NOT: {
            evaluatorId: params.evaluatorId,
          },
        }
      : {
          projectId: params.projectId,
          name: params.name,
        },
    select: {
      id: true,
    },
  });

  if (conflictingTemplate) {
    throw new LangfuseConflictError(
      `An evaluator with name "${params.name}" already exists in this project`,
    );
  }
}
