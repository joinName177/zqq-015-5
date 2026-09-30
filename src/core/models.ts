export interface OracleChar {
  char: string;
  pinyin: string;
  radical: string;
  scriptType: '甲骨文' | '金文' | '小篆';
  glyphSvg: string; // SVG path or stroke representation
  originalMeaning: string;
  pictographicExplanation: string;
}

export interface AllusionSource {
  dynasty: string;
  classicBook: string;
  author: string;
  yearApprox: string;
  historicalEvent: string;
  originalAncientQuote: string;
}

export interface SemanticEvolutionStep {
  era: string;
  meaning: string;
  semanticCategory: '本义' | '引申义' | '比喻义';
  contextSample: string;
}

export interface SemanticDNA {
  originalPercent: number;     // 本义占比
  extendedPercent: number;     // 引申义占比
  metaphoricalPercent: number; // 比喻义占比
  polarity: '褒义' | '中性' | '贬义';
  coreSememes: string[];
}

export interface IdiomProfile {
  id: string;
  idiom: string;
  pinyin: string;
  characters: OracleChar[];
  allusion: AllusionSource;
  evolutionPath: SemanticEvolutionStep[];
  dna: SemanticDNA;
  modernDefinition: string;
  syntacticRole: string;
}

export interface KinshipResult {
  idiomA: IdiomProfile;
  idiomB: IdiomProfile;
  kinshipScore: number; // 0 - 100
  dnaVectorSimilarity: number;
  sharedSememes: string[];
  polarityCompatibility: boolean;
  relationshipLabel: '同源近亲' | '异曲同工' | '形似神离' | '截然对立' | '远房微亲';
  comparativeAnalysis: string;
}

/** 纠错修订字段类型：字形（书体断代）/ 年代（朝代纪年）/ 释义（现代释义） */
export type CorrectionFieldType = 'glyph' | 'era' | 'definition';

/** 本地审核状态：草稿 → 待审核 → 已通过 / 已驳回 */
export type CorrectionStatus = 'draft' | 'pending' | 'approved' | 'rejected';

/**
 * 用户纠错修订提案。
 * 注意：提案独立存储于本地，任何状态下都不会回写覆盖权威词条（IdiomProfile）。
 */
export interface CorrectionSubmission {
  id: string;
  idiomId: string;
  idiomText: string;
  fieldType: CorrectionFieldType;
  /** 展示用目标标签，如「字形 · 守（甲骨文）」 */
  targetLabel: string;
  /** 权威字段路径，如 characters[0].scriptType / allusion.dynasty / modernDefinition */
  fieldPath: string;
  /** 权威原值快照（提交时锁定，不随后续词条变化而改变） */
  originalValue: string;
  /** 用户建议的修订值 */
  proposedValue: string;
  /** 修订依据 / 理由 */
  reason: string;
  status: CorrectionStatus;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  reviewedAt?: number;
}
