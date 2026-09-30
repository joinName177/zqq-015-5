import { CorrectionSubmission } from '../core/models';

/**
 * 纠错提案存储端口。
 * 提案仅在本地持久化，适配器不得修改任何权威词条数据。
 */
export interface CorrectionRepositoryPort {
  /** 读取全部纠错提案（含草稿与各审核状态） */
  list(): Promise<CorrectionSubmission[]>;
  /** 新建或更新一条提案（upsert） */
  upsert(submission: CorrectionSubmission): Promise<void>;
  /** 按 id 删除一条提案 */
  remove(id: string): Promise<void>;
  /** 全量替换（用于撤销操作的状态回滚） */
  replaceAll(submissions: CorrectionSubmission[]): Promise<void>;
}
