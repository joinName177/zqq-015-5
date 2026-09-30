import { CorrectionSubmission } from '../core/models';
import { CorrectionRepositoryPort } from '../ports/correction.port';

const STORAGE_KEY = 'zqq-015:corrections:v1';

/**
 * 本地纠错提案适配器。
 * 仅读写 localStorage 中的提案数据，不触碰 DictionaryAdapter 中的权威词条。
 */
export class LocalCorrectionAdapter implements CorrectionRepositoryPort {
  private cache: CorrectionSubmission[] | null = null;

  private read(): CorrectionSubmission[] {
    if (this.cache) return this.cache;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        this.cache = [];
      } else {
        const parsed: unknown = JSON.parse(raw);
        this.cache = Array.isArray(parsed) ? (parsed as CorrectionSubmission[]) : [];
      }
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private write(items: CorrectionSubmission[]): void {
    this.cache = items;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // 存储不可用时静默降级为内存态
    }
  }

  async list(): Promise<CorrectionSubmission[]> {
    return [...this.read()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async upsert(submission: CorrectionSubmission): Promise<void> {
    const items = this.read();
    const idx = items.findIndex(s => s.id === submission.id);
    if (idx >= 0) items[idx] = submission;
    else items.push(submission);
    this.write(items);
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter(s => s.id !== id));
  }

  async replaceAll(submissions: CorrectionSubmission[]): Promise<void> {
    this.write(submissions.map(s => ({ ...s })));
  }
}
