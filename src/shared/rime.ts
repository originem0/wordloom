import { z } from "zod";

export const RIME_SPEAKER_ID = /^[a-z][a-z0-9_-]{0,59}$/;

export const rimePreviewSchema = z.object({
  model: z.enum(["coda", "mist"]),
  speaker: z.string().regex(RIME_SPEAKER_ID),
  speed: z.number().min(0.5).max(2),
  apiKey: z.string().trim().min(1).max(4096).optional(),
}).strict();

export type RimePreview = z.infer<typeof rimePreviewSchema>;
export type RimeVoices = Record<RimePreview["model"], string[]>;
