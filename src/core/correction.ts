import type { IdiomProfile } from './models';

/**
 * 用户纠错提交流程 · 领域层
 *
 * 铁律：纠错提案是独立于权威词条（IdiomProfile）的旁路数据，
 * 任何状态流转都不得回写 / 覆盖权威词典内容。
 */

/** 可修订的三个维度：字形、年代、释义 */
export type CorrectionField = 'glyph' | 'era' | 'definition';

/** 修订目标所在的资料卡区域 */
export type CorrectionTargetType = 'character' | 'allusion' | 'evolution' | 'idiom';

/**
 * 本地审核状态：
 * - draft     草稿（已保存到本机，尚未提交）
 * - submitted 待审核（已提交，进入本地审核队列）
 * - withdrawn 已撤销（提交后被用户主动撤回，不再占用审核队列）
 */
export type CorrectionStatus = 'draft' | 'submitted' | 'withdrawn';

export interface CorrectionTargetRef {
  idiomId: string;
  idiom: string; // 冗余快照，便于审核中心在未加载词条时展示
  targetType: CorrectionTargetType;
  index: number; // character / evolution 的下标，其余为 -1
  char: string | null; // 目标单字快照
  field: CorrectionField;
  fieldLabel: string; // 人类可读的修订项名称
}

export interface CorrectionProposal {
  id: string;
  target: CorrectionTargetRef;
  targetKey: string;
  originalValue: string; // 提交时刻的权威原文快照
  proposedValue: string; // 用户修订内容
  reason: string; // 修订理由
  evidence: string; // 文献 / 出处佐证
  status: CorrectionStatus;
  createdAt: number;
  updatedAt: number;
  submittedAt: number | null;
  withdrawnAt: number | null;
}

export interface CorrectionDraftInput {
  target: CorrectionTargetRef;
  originalValue: string;
  proposedValue: string;
  reason: string;
  evidence: string;
}

export const STATUS_LABEL: Record<CorrectionStatus, string> = {
  draft: '草稿',
  submitted: '待审核',
  withdrawn: '已撤销'
};

export const newProposalId = (): string =>
  'CR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();

/** 同一权威字段的稳定标识，用于聚合某一字段上的所有修订 */
export function targetKeyOf(ref: CorrectionTargetRef): string {
  const seg = ref.index >= 0 ? `${ref.targetType}:${ref.index}` : ref.targetType;
  return `${ref.idiomId}|${seg}|${ref.field}`;
}

/** 依据资料卡上下文构造修订目标引用 */
export function buildTargetRef(
  profile: IdiomProfile,
  targetType: CorrectionTargetType,
  index: number,
  field: CorrectionField
): CorrectionTargetRef {
  let char: string | null = null;
  let fieldLabel = '';

  if (targetType === 'character') {
    const c = profile.characters[index];
    char = c.char;
    fieldLabel = field === 'glyph' ? `字形构形修订（${c.scriptType}）` : '本义释义修订';
  } else if (targetType === 'allusion') {
    fieldLabel = '出处年代修订';
  } else if (targetType === 'evolution') {
    fieldLabel =
      field === 'era'
        ? `流变年代修订（第 ${index + 1} 阶段）`
        : `流变释义修订（第 ${index + 1} 阶段）`;
  } else {
    fieldLabel = '现代释义修订';
  }

  return { idiomId: profile.id, idiom: profile.idiom, targetType, index, char, field, fieldLabel };
}

/** 读取权威原文（仅读取，绝不写入） */
export function getOriginalValue(profile: IdiomProfile, ref: CorrectionTargetRef): string {
  switch (ref.targetType) {
    case 'character': {
      const c = profile.characters[ref.index];
      // 字形修订以构形说解文本为权威原文（SVG 摹本的修订可在建议正文中直接给出 path）
      return ref.field === 'glyph' ? c.pictographicExplanation : c.originalMeaning;
    }
    case 'allusion':
      return `${profile.allusion.dynasty}（${profile.allusion.yearApprox}）`;
    case 'evolution': {
      const step = profile.evolutionPath[ref.index];
      return ref.field === 'era' ? step.era : step.meaning;
    }
    case 'idiom':
      return profile.modernDefinition;
  }
}

/* ----------------------------- 差异预览算法 ----------------------------- */

export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

/**
 * 基于字符级 LCS 的差异比对（中文按码点切分）。
 * 返回 equal / insert / delete 片段序列，供 UI 渲染红绿对照。
 */
export function diffTexts(before: string, after: string): DiffSegment[] {
  const a = Array.from(before);
  const b = Array.from(after);
  const n = a.length;
  const m = b.length;

  // dp[i][j] = a[i:] 与 b[j:] 的最长公共子序列长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segments: DiffSegment[] = [];
  const push = (op: DiffOp, text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.op === op) last.text += text;
    else segments.push({ op, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('delete', a[i]);
      i++;
    } else {
      push('insert', b[j]);
      j++;
    }
  }
  while (i < n) push('delete', a[i++]);
  while (j < m) push('insert', b[j++]);

  return segments;
}

/* -------------------------------- 校验 -------------------------------- */

const MAX_PROPOSED_LEN = 5000;
const MIN_EVIDENCE_LEN = 4;

export function validateDraftInput(input: Pick<CorrectionDraftInput, 'originalValue' | 'proposedValue'>): string[] {
  const errors: string[] = [];
  const proposed = input.proposedValue.trim();
  if (!proposed) {
    errors.push('修订内容不能为空');
  } else if (proposed === input.originalValue.trim()) {
    errors.push('修订内容与权威原文完全一致，无需提交');
  } else if (Array.from(input.proposedValue).length > MAX_PROPOSED_LEN) {
    errors.push(`修订内容过长（上限 ${MAX_PROPOSED_LEN} 字）`);
  }
  return errors;
}

export function validateForSubmit(proposal: Pick<CorrectionProposal, 'originalValue' | 'proposedValue' | 'evidence'>): string[] {
  const errors = validateDraftInput(proposal);
  if (proposal.evidence.trim().length < MIN_EVIDENCE_LEN) {
    errors.push('确认提交前必须填写文献 / 出处佐证（草稿阶段可暂缺）');
  }
  return errors;
}

/* ------------------------------ 状态机构造 ------------------------------ */

export function createDraftProposal(input: CorrectionDraftInput, now: number): CorrectionProposal {
  return {
    id: newProposalId(),
    target: input.target,
    targetKey: targetKeyOf(input.target),
    originalValue: input.originalValue,
    proposedValue: input.proposedValue,
    reason: input.reason.trim(),
    evidence: input.evidence.trim(),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    withdrawnAt: null
  };
}

/** 草稿 → 待审核（必须先有已保存的草稿） */
export function markSubmitted(proposal: CorrectionProposal, now: number): CorrectionProposal {
  if (proposal.status !== 'draft') {
    throw new Error(`仅草稿状态可提交，当前状态为「${STATUS_LABEL[proposal.status]}」`);
  }
  return { ...proposal, status: 'submitted', updatedAt: now, submittedAt: now, withdrawnAt: null };
}

/** 待审核 → 已撤销 */
export function markWithdrawn(proposal: CorrectionProposal, now: number): CorrectionProposal {
  if (proposal.status !== 'submitted') {
    throw new Error(`仅待审核状态可撤销，当前状态为「${STATUS_LABEL[proposal.status]}」`);
  }
  return { ...proposal, status: 'withdrawn', updatedAt: now, withdrawnAt: now };
}

/** 以一条历史提案（通常为已撤销）为蓝本，另起一份新草稿；原记录保留留痕 */
export function reDraftFrom(proposal: CorrectionProposal, now: number): CorrectionProposal {
  return {
    ...proposal,
    id: newProposalId(),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    withdrawnAt: null
  };
}
