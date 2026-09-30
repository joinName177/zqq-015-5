import { CorrectionRepositoryPort } from '../ports/correction-repository.port';
import {
  CorrectionDraftInput,
  CorrectionProposal,
  STATUS_LABEL,
  createDraftProposal,
  markSubmitted,
  markWithdrawn,
  reDraftFrom,
  targetKeyOf,
  validateForSubmit
} from '../core/correction';

const STORAGE_KEY = 'zqq015.correction-proposals.v1';

/**
 * 本地纠错仓储：基于 localStorage 的浏览器端持久化。
 *
 * 与 DictionaryAdapter 物理隔离——本适配器从不读取、也不写入 RICH_IDIOMS，
 * 权威词条永远以词典适配器返回的内容为准。
 */
export class LocalCorrectionRepository implements CorrectionRepositoryPort {
  async listAll(): Promise<CorrectionProposal[]> {
    return this.readAll().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async latestByTargetKey(targetKey: string): Promise<CorrectionProposal | null> {
    const matched = this.readAll()
      .filter(p => p.targetKey === targetKey)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return matched[0] ?? null;
  }

  async saveDraft(input: CorrectionDraftInput, existingDraftId?: string): Promise<CorrectionProposal> {
    const now = Date.now();
    const proposals = this.readAll();
    const idx = proposals.findIndex(p => p.id === existingDraftId && p.status === 'draft');

    if (idx >= 0) {
      const updated: CorrectionProposal = {
        ...proposals[idx],
        target: input.target,
        targetKey: targetKeyOf(input.target),
        originalValue: input.originalValue,
        proposedValue: input.proposedValue,
        reason: input.reason.trim(),
        evidence: input.evidence.trim(),
        updatedAt: now
      };
      proposals[idx] = updated;
    } else {
      // 同一权威字段若已有旧草稿则覆盖，避免同一字段堆积多份草稿
      const staleIdx = proposals.findIndex(
        p => p.status === 'draft' && p.targetKey === targetKeyOf(input.target)
      );
      const draft = createDraftProposal(input, now);
      if (staleIdx >= 0) {
        proposals[staleIdx] = draft;
      } else {
        proposals.push(draft);
      }
    }

    this.writeAll(proposals);
    const saved = this.readAll()
      .filter(p => p.targetKey === targetKeyOf(input.target) && p.status === 'draft')
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return saved;
  }

  async submit(proposalId: string): Promise<CorrectionProposal> {
    return this.mutate(proposalId, p => {
      if (validateForSubmit(p).length > 0) {
        throw new Error(validateForSubmit(p).join('；'));
      }
      return markSubmitted(p, Date.now());
    });
  }

  async withdraw(proposalId: string): Promise<CorrectionProposal> {
    return this.mutate(proposalId, p => markWithdrawn(p, Date.now()));
  }

  async reDraft(proposalId: string): Promise<CorrectionProposal> {
    const proposals = this.readAll();
    const source = proposals.find(p => p.id === proposalId);
    if (!source) throw new Error('找不到该提案');
    const draft = reDraftFrom(source, Date.now());
    proposals.push(draft);
    this.writeAll(proposals);
    return draft;
  }

  async remove(proposalId: string): Promise<void> {
    const proposals = this.readAll();
    const target = proposals.find(p => p.id === proposalId);
    if (!target) return;
    if (target.status === 'submitted') {
      throw new Error(`「${STATUS_LABEL.submitted}」提案须先撤销后才能删除`);
    }
    this.writeAll(proposals.filter(p => p.id !== proposalId));
  }

  /* ------------------------------ 内部存取 ------------------------------ */

  private mutate(id: string, fn: (p: CorrectionProposal) => CorrectionProposal): CorrectionProposal {
    const proposals = this.readAll();
    const idx = proposals.findIndex(p => p.id === id);
    if (idx < 0) throw new Error('找不到该提案');
    proposals[idx] = fn(proposals[idx]);
    this.writeAll(proposals);
    return proposals[idx];
  }

  private readAll(): CorrectionProposal[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CorrectionProposal[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(proposals: CorrectionProposal[]): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(proposals));
  }
}
