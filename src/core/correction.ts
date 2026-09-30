import { CorrectionFieldType, CorrectionStatus, CorrectionSubmission } from './models';

export interface DiffSegment {
  type: 'equal' | 'add' | 'del';
  text: string;
}

/**
 * 基于最长公共子序列（LCS）的字符级差异比对。
 * 返回连续片段：equal（相同）/ del（原文删除）/ add（建议新增）。
 */
export function diffChars(oldText: string, newText: string): DiffSegment[] {
  const a = Array.from(oldText ?? '');
  const b = Array.from(newText ?? '');
  const m = a.length;
  const n = b.length;

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segs: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], text: string) => {
    if (!text) return;
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.text += text;
    else segs.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', a[i]);
      i++;
    } else {
      push('add', b[j]);
      j++;
    }
  }
  while (i < m) {
    push('del', a[i]);
    i++;
  }
  while (j < n) {
    push('add', b[j]);
    j++;
  }
  return segs;
}

export interface FieldMeta {
  label: string;
  /** 模态框中权威原值的说明 */
  originalHint: string;
  /** 建议值输入控件类型 */
  inputType: 'select' | 'input' | 'textarea';
  options?: string[];
  placeholder: string;
}

export const CORRECTION_FIELD_META: Record<CorrectionFieldType, FieldMeta> = {
  glyph: {
    label: '字形修订',
    originalHint: '当前著录书体（甲骨文 / 金文 / 小篆）',
    inputType: 'select',
    options: ['甲骨文', '金文', '小篆'],
    placeholder: '请选择正确的书体断代'
  },
  era: {
    label: '年代修订',
    originalHint: '当前著录朝代与纪年',
    inputType: 'input',
    placeholder: '如：战国时期（约公元前 280 年）'
  },
  definition: {
    label: '释义修订',
    originalHint: '当前权威释义',
    inputType: 'textarea',
    placeholder: '请填写修订后的释义内容'
  }
};

export interface StatusMeta {
  label: string;
  /** 流转中的状态说明 */
  hint: string;
}

export const CORRECTION_STATUS_META: Record<CorrectionStatus, StatusMeta> = {
  draft: { label: '草稿', hint: '已保存草稿，尚未提交' },
  pending: { label: '待本地审核', hint: '已提交，等待本地审核' },
  approved: { label: '已通过本地审核', hint: '本地审核通过（不会回写权威词条）' },
  rejected: { label: '已驳回', hint: '本地审核驳回，可修改后重新提交' }
};

let seq = 0;
function uid(): string {
  seq += 1;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `corr-${rand}-${seq}`;
}

export interface NewCorrectionInput {
  idiomId: string;
  idiomText: string;
  fieldType: CorrectionFieldType;
  targetLabel: string;
  fieldPath: string;
  originalValue: string;
  proposedValue: string;
  reason: string;
}

/** 创建一条草稿态提案（新建或由已有提案更新时复用 id） */
export function createCorrection(input: NewCorrectionInput, existingId?: string): CorrectionSubmission {
  const now = Date.now();
  return {
    id: existingId ?? uid(),
    idiomId: input.idiomId,
    idiomText: input.idiomText,
    fieldType: input.fieldType,
    targetLabel: input.targetLabel,
    fieldPath: input.fieldPath,
    originalValue: input.originalValue,
    proposedValue: input.proposedValue.trim(),
    reason: input.reason.trim(),
    status: 'draft',
    createdAt: now,
    updatedAt: now
  };
}
