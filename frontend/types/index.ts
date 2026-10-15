import type { z } from "zod";
import type * as s from "@/lib/api/schemas";

export type Bar = z.infer<typeof s.barSchema>;
export type Instrument = z.infer<typeof s.instrumentSchema>;
export type DatasetSource = z.infer<typeof s.datasetSourceSchema>;
export type BarsResponse = z.infer<typeof s.barsResponseSchema>;
export type DataQuality = z.infer<typeof s.dataQualitySchema>;
export type QualityIssue = z.infer<typeof s.qualityIssueSchema>;
export type Profile = z.infer<typeof s.profileSchema>;
export type ProfileKind = z.infer<typeof s.profileKindSchema>;
export type ProfileShapeType = z.infer<typeof s.profileShapeTypeSchema>;
export type ProfileBin = z.infer<typeof s.profileBinSchema>;
export type VsaEvent = z.infer<typeof s.vsaEventSchema>;
export type VsaPatternType = z.infer<typeof s.vsaPatternTypeSchema>;
export type DetectionStatus = z.infer<typeof s.detectionStatusSchema>;
export type AuctionState = z.infer<typeof s.auctionStateSchema>;
export type AuctionStateKind = z.infer<typeof s.auctionStateKindSchema>;
export type AuctionTransition = z.infer<typeof s.auctionTransitionSchema>;
export type AuctionReset = z.infer<typeof s.auctionResetSchema>;
export type EvidenceItem = z.infer<typeof s.evidenceItemSchema>;
export type Level = z.infer<typeof s.levelSchema>;
export type Interpretation = z.infer<typeof s.interpretationSchema>;
export type Narrative = z.infer<typeof s.narrativeSchema>;
export type Scenario = z.infer<typeof s.scenarioSchema>;
export type Analysis = z.infer<typeof s.analysisSchema>;
export type KnowledgeConcept = z.infer<typeof s.knowledgeConceptSchema>;
export type KnowledgeCategory = z.infer<typeof s.knowledgeCategorySchema>;
export type UploadResult = z.infer<typeof s.uploadResultSchema>;

export type DetailLevel = "quick" | "standard" | "deep";

export type LayerKey =
  | "candles"
  | "volume"
  | "tpo"
  | "volumeProfile"
  | "valueLevels"
  | "nodes"
  | "vsa"
  | "structure"
  | "auction";

export type Layers = Record<LayerKey, boolean>;
