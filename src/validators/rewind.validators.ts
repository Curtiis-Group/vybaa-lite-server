import { z } from "zod";

export const createLiveTokenSchema = z.object({
  personaId: z.enum(["ella", "lyra", "jake", "ariel"]),
});

