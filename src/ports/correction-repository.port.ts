import { CorrectionDraftInput, CorrectionProposal } from '../core/correction';

/**
 * 纠错提案仓储端口。
 *
 * 实现方必须保证：只持久化用户提案，不得对 IdiomProfile / 权威词典做任何写入。
 */
export interface CorrectionRepositoryPort {
  /** 读取本机全部提案（按更新时间倒序） */
  listAll(): Promise<CorrectionProposal[]>;
  /** 按权威字段标识聚合，返回该字段最新一条提案（用于资料卡状态徽标） */
  latestByTargetKey(targetKey: string): Promise<CorrectionProposal | null>;
  /** 保存草稿：存在同字段旧草稿则覆盖该草稿（同一字段同时只保留一份草稿），否则新建 */
  saveDraft(input: CorrectionDraftInput, existingDraftId?: string): Promise<CorrectionProposal>;
  /** 草稿 → 待审核 */
  submit(proposalId: string): Promise<CorrectionProposal>;
  /** 待审核 → 已撤销 */
  withdraw(proposalId: string): Promise<CorrectionProposal>;
  /** 以历史提案为蓝本另起草稿 */
  reDraft(proposalId: string): Promise<CorrectionProposal>;
  /** 删除草稿或已撤销提案（待审核提案须先撤销） */
  remove(proposalId: string): Promise<void>;
}
