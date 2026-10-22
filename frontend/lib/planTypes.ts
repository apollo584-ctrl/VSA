import type { z } from "zod";
import type { daySummarySchema, journalEntrySchema, setupAResponseSchema, setupASymbolSchema } from "@/lib/api/schemas";

export type SetupASymbol = z.infer<typeof setupASymbolSchema>;
export type SetupAResponse = z.infer<typeof setupAResponseSchema>;
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export type DaySummary = z.infer<typeof daySummarySchema>;
/** Body for POST/PUT /journal: every field except id and server timestamps. */
export type JournalInput = Partial<Omit<JournalEntry, "id" | "created_at" | "updated_at" | "r_multiple">>;
