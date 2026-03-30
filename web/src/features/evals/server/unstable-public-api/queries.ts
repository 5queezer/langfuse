import { EvalTargetObject, LangfuseNotFoundError } from "@langfuse/shared";
import { prisma } from "@langfuse/shared/src/db";
import type {
  PrismaClientLike,
  StoredPublicContinuousEvaluationConfig,
  StoredPublicEvaluatorTemplate,
} from "./types";

export function getPrismaClient(client?: PrismaClientLike) {
  return client ?? prisma;
}

export async function findEvaluatorTemplateVersionsOrThrow(params: {
  client?: PrismaClientLike;
  projectId: string;
  evaluatorId: string;
}) {
  const client = getPrismaClient(params.client);

  const templates = await client.evalTemplate.findMany({
    where: {
      projectId: params.projectId,
      evaluatorId: params.evaluatorId,
    },
    orderBy: {
      version: "asc",
    },
  });

  if (templates.length === 0) {
    throw new LangfuseNotFoundError(
      "Evaluator not found within authorized project",
    );
  }

  return templates as StoredPublicEvaluatorTemplate[];
}

export async function findLatestEvaluatorTemplateOrThrow(params: {
  client?: PrismaClientLike;
  projectId: string;
  evaluatorId: string;
}) {
  const templates = await findEvaluatorTemplateVersionsOrThrow(params);
  return templates[templates.length - 1] as StoredPublicEvaluatorTemplate;
}

export async function countContinuousEvaluationsForEvaluator(params: {
  client?: PrismaClientLike;
  projectId: string;
  evaluatorId: string;
}) {
  const client = getPrismaClient(params.client);

  return client.jobConfiguration.count({
    where: {
      projectId: params.projectId,
      targetObject: {
        in: [EvalTargetObject.EVENT, EvalTargetObject.EXPERIMENT],
      },
      evalTemplate: {
        is: {
          projectId: params.projectId,
          evaluatorId: params.evaluatorId,
        },
      },
    },
  });
}

export async function findPublicContinuousEvaluationOrThrow(params: {
  client?: PrismaClientLike;
  projectId: string;
  continuousEvaluationId: string;
}) {
  const client = getPrismaClient(params.client);

  const config = await client.jobConfiguration.findFirst({
    where: {
      id: params.continuousEvaluationId,
      projectId: params.projectId,
      targetObject: {
        in: [EvalTargetObject.EVENT, EvalTargetObject.EXPERIMENT],
      },
      evalTemplate: {
        is: {
          projectId: params.projectId,
          evaluatorId: {
            not: null,
          },
        },
      },
    },
    include: {
      evalTemplate: {
        select: {
          id: true,
          projectId: true,
          evaluatorId: true,
          name: true,
          vars: true,
          prompt: true,
        },
      },
    },
  });

  if (!config) {
    throw new LangfuseNotFoundError(
      "Continuous evaluation not found within authorized project",
    );
  }

  return config as StoredPublicContinuousEvaluationConfig;
}

export async function loadEvaluatorForContinuousEvaluation(params: {
  client?: PrismaClientLike;
  projectId: string;
  evaluatorId: string;
}) {
  const template = await findLatestEvaluatorTemplateOrThrow(params);

  return {
    template,
  };
}

export async function listPublicEvaluatorTemplateGroups(params: {
  projectId: string;
  page: number;
  limit: number;
}) {
  const templates = await prisma.evalTemplate.findMany({
    where: {
      projectId: params.projectId,
      evaluatorId: {
        not: null,
      },
    },
    orderBy: [{ updatedAt: "desc" }, { version: "desc" }],
  });

  const groupedTemplates = new Map<string, StoredPublicEvaluatorTemplate[]>();

  for (const template of templates) {
    if (!template.evaluatorId) {
      continue;
    }

    const existing = groupedTemplates.get(template.evaluatorId) ?? [];
    existing.push(template as StoredPublicEvaluatorTemplate);
    groupedTemplates.set(template.evaluatorId, existing);
  }

  const groups = Array.from(groupedTemplates.values())
    .map((group) => group.sort((left, right) => left.version - right.version))
    .sort(
      (left, right) =>
        right[right.length - 1]!.updatedAt.getTime() -
        left[left.length - 1]!.updatedAt.getTime(),
    );

  const totalItems = groups.length;
  const offset = (params.page - 1) * params.limit;

  return {
    totalItems,
    groups: groups.slice(offset, offset + params.limit),
  };
}

export async function countContinuousEvaluationsForEvaluatorIds(params: {
  projectId: string;
  evaluatorIds: string[];
}) {
  const configs = await prisma.jobConfiguration.findMany({
    where: {
      projectId: params.projectId,
      targetObject: {
        in: [EvalTargetObject.EVENT, EvalTargetObject.EXPERIMENT],
      },
      evalTemplate: {
        is: {
          projectId: params.projectId,
          evaluatorId: {
            in: params.evaluatorIds,
          },
        },
      },
    },
    select: {
      evalTemplate: {
        select: {
          evaluatorId: true,
        },
      },
    },
  });

  return configs.reduce<Record<string, number>>((counts, config) => {
    const evaluatorId = config.evalTemplate?.evaluatorId;

    if (!evaluatorId) {
      return counts;
    }

    counts[evaluatorId] = (counts[evaluatorId] ?? 0) + 1;
    return counts;
  }, {});
}

export async function listPublicContinuousEvaluationConfigs(params: {
  projectId: string;
  page: number;
  limit: number;
}) {
  const [configs, totalItems] = await Promise.all([
    prisma.jobConfiguration.findMany({
      where: {
        projectId: params.projectId,
        targetObject: {
          in: [EvalTargetObject.EVENT, EvalTargetObject.EXPERIMENT],
        },
        evalTemplate: {
          is: {
            projectId: params.projectId,
            evaluatorId: {
              not: null,
            },
          },
        },
      },
      include: {
        evalTemplate: {
          select: {
            id: true,
            projectId: true,
            evaluatorId: true,
            name: true,
            vars: true,
            prompt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: params.limit,
      skip: (params.page - 1) * params.limit,
    }),
    prisma.jobConfiguration.count({
      where: {
        projectId: params.projectId,
        targetObject: {
          in: [EvalTargetObject.EVENT, EvalTargetObject.EXPERIMENT],
        },
        evalTemplate: {
          is: {
            projectId: params.projectId,
            evaluatorId: {
              not: null,
            },
          },
        },
      },
    }),
  ]);

  return {
    configs: configs as StoredPublicContinuousEvaluationConfig[],
    totalItems,
  };
}
