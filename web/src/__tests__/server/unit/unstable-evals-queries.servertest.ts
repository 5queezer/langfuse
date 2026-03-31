/** @jest-environment node */

jest.mock("@langfuse/shared/src/db", () => {
  return {
    Prisma: {
      sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
        strings,
        values,
      }),
    },
    prisma: {
      $queryRaw: jest.fn(),
      evalTemplate: {
        findMany: jest.fn(),
      },
      jobConfiguration: {
        groupBy: jest.fn(),
      },
    },
  };
});

import { prisma } from "@langfuse/shared/src/db";
import {
  countContinuousEvaluationsForEvaluatorIds,
  listPublicEvaluatorTemplates,
} from "@/src/features/evals/server/unstable-public-api/queries";

const mockQueryRaw = prisma.$queryRaw as jest.Mock;
const mockEvalTemplateFindMany = prisma.evalTemplate.findMany as jest.Mock;
const mockJobConfigurationGroupBy = prisma.jobConfiguration
  .groupBy as jest.Mock;

describe("unstable public eval queries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("paginates latest evaluator versions per family before loading exact templates", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([
        { id: "tmpl_project_v2" },
        { id: "tmpl_managed_v7" },
      ])
      .mockResolvedValueOnce([{ count: 3n }]);
    mockEvalTemplateFindMany.mockResolvedValueOnce([
      {
        id: "tmpl_managed_v7",
        projectId: null,
        name: "Answer correctness",
        version: 7,
      },
      {
        id: "tmpl_project_v2",
        projectId: "project_123",
        name: "Answer correctness",
        version: 2,
      },
    ]);

    const result = await listPublicEvaluatorTemplates({
      projectId: "project_123",
      page: 2,
      limit: 2,
    });

    expect(mockQueryRaw).toHaveBeenCalledTimes(2);
    expect(mockEvalTemplateFindMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["tmpl_project_v2", "tmpl_managed_v7"],
        },
      },
    });
    expect(result.totalItems).toBe(3);
    expect(result.templates.map((template) => template.id)).toEqual([
      "tmpl_project_v2",
      "tmpl_managed_v7",
    ]);
  });

  it("skips the groupBy lookup when no evaluator ids are requested", async () => {
    const result = await countContinuousEvaluationsForEvaluatorIds({
      projectId: "project_123",
      evaluatorIds: [],
    });

    expect(result).toEqual({});
    expect(mockJobConfigurationGroupBy).not.toHaveBeenCalled();
  });

  it("counts continuous evaluations by exact evaluator template id", async () => {
    mockJobConfigurationGroupBy.mockResolvedValueOnce([
      {
        evalTemplateId: "tmpl_project_v2",
        _count: { _all: 2 },
      },
      {
        evalTemplateId: "tmpl_managed_v7",
        _count: { _all: 1 },
      },
    ]);

    const result = await countContinuousEvaluationsForEvaluatorIds({
      projectId: "project_123",
      evaluatorIds: ["tmpl_project_v2", "tmpl_managed_v7"],
    });

    expect(mockJobConfigurationGroupBy).toHaveBeenCalledWith({
      by: ["evalTemplateId"],
      where: {
        projectId: "project_123",
        targetObject: {
          in: ["event", "experiment"],
        },
        evalTemplateId: {
          in: ["tmpl_project_v2", "tmpl_managed_v7"],
        },
      },
      _count: {
        _all: true,
      },
    });
    expect(result).toEqual({
      tmpl_project_v2: 2,
      tmpl_managed_v7: 1,
    });
  });
});
