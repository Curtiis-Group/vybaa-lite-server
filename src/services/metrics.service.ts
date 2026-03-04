import { prisma } from "../config/db.config";
import logger from "../utils/logger.util";

export type MetricTags = Record<string, string | number | boolean>;

function serializeTags(tags?: MetricTags | string[]): string[] {
  if (!tags) return [];

  if (Array.isArray(tags)) {
    return tags;
  }

  return Object.entries(tags).map(([key, value]) => `${key}:${String(value)}`);
}

export const metricsService = {
  async record(
    name: string,
    value: number,
    tags?: MetricTags | string[],
  ): Promise<void> {
    try {
      await prisma.serverMetric.create({
        data: {
          name,
          value,
          tags: serializeTags(tags),
        },
      });
    } catch (error) {
      // We never want metrics writes to break the main flow.
      logger.error("Metrics record error", { name, error });
    }
  },
};

