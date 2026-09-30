import { IdiomProfile } from '../core/models';
import { CorrectionRepositoryPort } from '../ports/correction-repository.port';
import {
  CorrectionField,
  CorrectionProposal,
  CorrectionTargetRef,
  CorrectionTargetType,
  DiffSegment,
  STATUS_LABEL,
  buildTargetRef,
  diffTexts,
  getOriginalValue,
  targetKeyOf,
  validateDraftInput,
  validateForSubmit
} from '../core/correction';

/* ------------------------------- 对外契约 ------------------------------- */

export interface CorrectionContext {
  /** 权威字段标识 → 该字段最新一条提案（资料卡徽标用） */
  latestByTargetKey: Map<string, CorrectionProposal>;
  pendingCount: number;
  draftCount: number;
  openEditor: (req: OpenEditorRequest) => void;
  openProposal: (proposalId: string) => void;
  openReviewCenter: () => void;
}

export interface OpenEditorRequest {
  profile?: IdiomProfile;
  /** 新建时必填；从已有草稿 / 历史提案继续时仅传 proposal 即可 */
  targetType?: CorrectionTargetType;
  index?: number;
  field?: CorrectionField;
  proposal?: CorrectionProposal;
}

interface EditorSession {
  ref: CorrectionTargetRef;
  originalValue: string;
  draftId?: string;
  proposed: string;
  reason: string;
  evidence: string;
  step: 'edit' | 'preview' | 'done';
  doneStatus: 'submitted' | 'withdrawn';
  agreed: boolean;
  dirty: boolean;
  errors: string[];
  flash: string | null;
  savedAt: number | null;
  cameFromReview: boolean;
}

const esc = (s: string) =>
  s.replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));

const nl2br = (s: string) => esc(s).replace(/\r?\n/g, '<br/>');

export function formatTime(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderDiffHtml(before: string, after: string): string {
  const segs: DiffSegment[] = diffTexts(before, after);
  return segs
    .map(seg => {
      const text = esc(seg.text);
      if (seg.op === 'delete') return `<del class="corr-diff-del">${text}</del>`;
      if (seg.op === 'insert') return `<ins class="corr-diff-ins">${text}</ins>`;
      return `<span>${text}</span>`;
    })
    .join('');
}

/** 资料卡上的本地审核状态徽标 */
export function renderStatusBadge(p: CorrectionProposal | undefined): string {
  if (!p) return '';
  return `
    <button type="button" class="corr-badge corr-badge-${p.status}" data-proposal-id="${p.id}"
            title="查看修订建议（编号 ${p.id}）">
      <span class="corr-badge-dot"></span>${STATUS_LABEL[p.status]}
    </button>`;
}

/* ------------------------------- 控制器 ------------------------------- */

export class CorrectionUIController implements CorrectionContext {
  latestByTargetKey = new Map<string, CorrectionProposal>();
  pendingCount = 0;
  draftCount = 0;

  private overlay: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private view: 'none' | 'editor' | 'proposal' | 'review' = 'none';
  private session: EditorSession | null = null;
  private activeProposalId: string | null = null;
  private proposals: CorrectionProposal[] = [];
  private cameFromReview = false;

  constructor(
    private host: HTMLElement,
    private repo: CorrectionRepositoryPort,
    private onMutate: () => void
  ) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'corr-overlay corr-hidden';
    this.host.appendChild(this.overlay);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'corr-toast';
    this.host.appendChild(this.toastEl);

    this.overlay.addEventListener('click', e => {
      if ((e.target as HTMLElement).classList.contains('corr-backdrop')) this.requestClose();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.view !== 'none') this.requestClose();
    });
  }

  /** 由 main 在数据刷新后调用，同步徽标计数 */
  syncState(proposals: CorrectionProposal[]): void {
    this.proposals = proposals;
    this.latestByTargetKey.clear();
    for (const p of [...proposals].sort((a, b) => a.updatedAt - b.updatedAt)) {
      this.latestByTargetKey.set(p.targetKey, p); // 后写覆盖，留下最新
    }
    this.pendingCount = proposals.filter(p => p.status === 'submitted').length;
    this.draftCount = proposals.filter(p => p.status === 'draft').length;
    if (this.view === 'review' || this.view === 'proposal') this.render();
  }

  /* ------------------------------ 打开视图 ------------------------------ */

  openEditor(req: OpenEditorRequest): void {
    let ref: CorrectionTargetRef;
    let originalValue: string;
    let prefill: Pick<CorrectionProposal, 'proposedValue' | 'reason' | 'evidence'> | null = null;
    let draftId: string | undefined;

    if (req.proposal) {
      const p = req.proposal;
      ref = p.target;
      originalValue = p.originalValue;
      prefill = { proposedValue: p.proposedValue, reason: p.reason, evidence: p.evidence };
      if (p.status === 'draft') draftId = p.id;
    } else if (req.profile && req.targetType && req.field) {
      ref = buildTargetRef(req.profile, req.targetType, req.index ?? -1, req.field);
      originalValue = getOriginalValue(req.profile, ref);
    } else {
      return;
    }

    this.session = {
      ref,
      originalValue,
      draftId,
      proposed: prefill?.proposedValue ?? '',
      reason: prefill?.reason ?? '',
      evidence: prefill?.evidence ?? '',
      step: 'edit',
      doneStatus: 'submitted',
      agreed: false,
      dirty: false,
      errors: [],
      flash: null,
      savedAt: null,
      cameFromReview: this.cameFromReview
    };
    this.view = 'editor';
    this.render();
  }

  async openProposal(proposalId: string): Promise<void> {
    this.proposals = await this.repo.listAll();
    const p = this.proposals.find(x => x.id === proposalId);
    if (!p) return;
    this.activeProposalId = proposalId;
    this.view = 'proposal';
    this.render();
  }

  async openReviewCenter(): Promise<void> {
    this.proposals = await this.repo.listAll();
    this.view = 'review';
    this.render();
  }

  private requestClose(): void {
    if (this.view === 'editor' && this.session?.dirty && this.session.step !== 'done') {
      if (!window.confirm('尚有未保存的修改，确定关闭吗？')) return;
    }
    this.close();
  }

  private close(): void {
    this.view = 'none';
    this.session = null;
    this.activeProposalId = null;
    this.cameFromReview = false;
    this.overlay.classList.add('corr-hidden');
    this.overlay.innerHTML = '';
  }

  private toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('corr-toast-show');
    window.setTimeout(() => this.toastEl.classList.remove('corr-toast-show'), 2200);
  }

  /* ------------------------------ 主渲染 ------------------------------ */

  private render(): void {
    if (this.view === 'none') return;
    this.overlay.classList.remove('corr-hidden');
    if (this.view === 'editor') this.overlay.innerHTML = this.editorHtml();
    else if (this.view === 'proposal') this.overlay.innerHTML = this.proposalHtml();
    else this.overlay.innerHTML = this.reviewHtml();
    this.bind();
  }

  private shell(inner: string, wide = false): string {
    return `
      <div class="corr-backdrop"></div>
      <div class="corr-modal ${wide ? 'corr-modal-wide' : ''}" role="dialog" aria-modal="true">
        ${inner}
      </div>`;
  }

  /* ------------------------------ 编辑 / 预览 ------------------------------ */

  private fieldHint(ref: CorrectionTargetRef): string {
    if (ref.field === 'glyph') {
      return '请描述字形构形修订意见（如部件、笔势、断代形态）；若拟替换 SVG 摹本，可直接在正文中给出 path 数据。';
    }
    if (ref.field === 'era') return '请给出考订后的年代 / 朝代，并在佐证中注明文献依据。';
    return '请撰写修订后的释义文本，保持与原词条体例一致。';
  }

  private editorHtml(): string {
    const s = this.session!;
    const targetName =
      `${s.ref.char ? `「${esc(s.ref.char)}」字 · ` : ''}${esc(s.ref.fieldLabel)}`;

    const stepOrder = { edit: 1, preview: 2, done: 3 } as const;
    const currentStep = stepOrder[s.step];
    const steps = [
      { n: 1, label: '编辑并保存草稿' },
      { n: 2, label: '差异预览' },
      { n: 3, label: '确认提交' }
    ];

    let body = '';
    if (s.step === 'edit') {
      body = `
        <div class="corr-field">
          <label>权威原文（只读，不会被修改）</label>
          <div class="corr-original-box">
            <span class="corr-lock">🔒 权威词条</span>${nl2br(s.originalValue)}
          </div>
        </div>
        <div class="corr-field">
          <label for="corr-proposed">修订建议 <span class="corr-req">*</span></label>
          <textarea id="corr-proposed" rows="5" placeholder="${esc(this.fieldHint(s.ref))}">${esc(s.proposed)}</textarea>
          <p class="corr-hint">${esc(this.fieldHint(s.ref))}</p>
        </div>
        <div class="corr-field-row">
          <div class="corr-field">
            <label for="corr-reason">修订理由</label>
            <textarea id="corr-reason" rows="2" placeholder="简述原说有何不妥、修订依据">${esc(s.reason)}</textarea>
          </div>
          <div class="corr-field">
            <label for="corr-evidence">文献 / 出处佐证 ${s.draftId ? '' : '<span class="corr-hint-inline">（确认提交前必填）</span>'}</label>
            <textarea id="corr-evidence" rows="2" placeholder="如：《说文解字》卷七、某考古报告…">${esc(s.evidence)}</textarea>
          </div>
        </div>
        ${this.errorsHtml(s.errors)}
        ${s.flash ? `<div class="corr-flash">${esc(s.flash)}</div>` : ''}
        <div class="corr-footer">
          <span class="corr-flow-hint">流程：保存草稿 → 差异预览 → 确认提交</span>
          <button class="corr-btn corr-btn-primary" id="corr-save-draft">保存草稿</button>
        </div>`;
    } else if (s.step === 'preview') {
      body = `
        <div class="corr-field">
          <label>差异预览（<del style="color:#e0847a;">删除</del> / <ins style="color:#7fd6a3;">新增</ins>）</label>
          <div class="corr-diff-box">${renderDiffHtml(s.originalValue, s.proposed) || '<span class="corr-hint">无差异</span>'}</div>
        </div>
        <div class="corr-compare-grid">
          <div class="corr-field">
            <label>权威原文</label>
            <div class="corr-original-box corr-small">${nl2br(s.originalValue)}</div>
          </div>
          <div class="corr-field">
            <label>修订建议</label>
            <div class="corr-new-box corr-small">${nl2br(s.proposed)}</div>
          </div>
        </div>
        <div class="corr-meta-list">
          <div><span>修订理由</span><p>${s.reason ? nl2br(s.reason) : '<em class="corr-hint">未填写</em>'}</p></div>
          <div><span>文献佐证</span><p>${s.evidence ? nl2br(s.evidence) : '<em class="corr-hint">未填写</em>'}</p></div>
        </div>
        ${this.errorsHtml(s.errors)}
        <label class="corr-agree">
          <input type="checkbox" id="corr-agree" ${s.agreed ? 'checked' : ''} />
          我已知晓：本次提交只进入<span class="corr-strong">本机本地审核队列</span>用于留痕，
          <span class="corr-strong">不会直接覆盖权威词条</span>，权威原文仍以典籍词典为准。
        </label>
        <div class="corr-footer">
          <button class="corr-btn" id="corr-back-edit">← 返回修改</button>
          <button class="corr-btn corr-btn-primary" id="corr-confirm-submit" ${s.agreed ? '' : 'disabled'}>
            确认提交
          </button>
        </div>`;
    } else {
      const submitted = s.doneStatus === 'submitted';
      const submittedAt = this.proposals.find(p => p.id === s.draftId)?.submittedAt ?? null;
      body = `
        <div class="corr-done">
          <div class="corr-done-icon">${submitted ? '📨' : '↩️'}</div>
          <h3>${submitted ? '修订建议已提交，进入本地审核队列' : '提交已撤销'}</h3>
          <p class="corr-hint">
            ${submitted
              ? `编号 ${esc(s.draftId ?? '')} · 提交于 ${formatTime(submittedAt)}<br/>
                 该建议仅保存在本机浏览器中留痕，权威词条内容保持原样、未被覆盖。<br/>
                 审核结论出具前，你可以随时撤销本次提交。`
              : '该提案已标记为「已撤销」，不再占用待审核队列；记录保留留痕，可重新起草。'}
          </p>
          <div class="corr-done-actions">
            ${submitted
              ? `<button class="corr-btn corr-btn-danger-ghost" id="corr-withdraw-done">撤销提交</button>`
              : `<button class="corr-btn" id="corr-redraft-done">重新起草</button>`}
            <button class="corr-btn corr-btn-primary" id="corr-finish">完成</button>
          </div>
        </div>`;
    }

    return this.shell(`
      <div class="corr-modal-head">
        <div>
          <h2>用户纠错提交</h2>
          <div class="corr-subtitle">《${esc(s.ref.idiom)}》 · ${targetName}</div>
        </div>
        <button class="corr-close" id="corr-close" title="关闭">✕</button>
      </div>
      <div class="corr-steps">
        ${steps
          .map(
            st => `
          <div class="corr-step ${st.n === currentStep ? 'corr-step-active' : ''} ${
              st.n < currentStep ? 'corr-step-done' : ''
            }">
            <span class="corr-step-n">${st.n}</span>${esc(st.label)}
          </div>`
          )
          .join('<span class="corr-step-arrow">→</span>')}
      </div>
      <div class="corr-modal-body">${body}</div>
    `);
  }

  private errorsHtml(errors: string[]): string {
    if (errors.length === 0) return '';
    return `<ul class="corr-errors">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
  }

  /* ------------------------------ 提案详情 ------------------------------ */

  private proposalHtml(): string {
    const p = this.proposals.find(x => x.id === this.activeProposalId);
    if (!p) return this.shell('<div class="corr-modal-body">提案不存在或已删除。<div class="corr-footer"><button class="corr-btn corr-btn-primary" id="corr-finish">关闭</button></div></div>');

    const targetName = `${p.target.char ? `「${esc(p.target.char)}」字 · ` : ''}${esc(p.target.fieldLabel)}`;

    const actions: string[] = [];
    if (p.status === 'draft') {
      actions.push('<button class="corr-btn corr-btn-primary" id="corr-p-edit">继续编辑</button>');
      actions.push('<button class="corr-btn corr-btn-danger-ghost" id="corr-p-delete">删除草稿</button>');
    } else if (p.status === 'submitted') {
      actions.push('<button class="corr-btn corr-btn-danger-ghost" id="corr-p-withdraw">撤销提交</button>');
    } else {
      actions.push('<button class="corr-btn corr-btn-primary" id="corr-p-redraft">重新起草</button>');
      actions.push('<button class="corr-btn corr-btn-danger-ghost" id="corr-p-delete">删除记录</button>');
    }

    return this.shell(`
      <div class="corr-modal-head">
        <div>
          <h2>纠错建议详情</h2>
          <div class="corr-subtitle">《${esc(p.target.idiom)}》 · ${targetName}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="corr-pill corr-pill-${p.status}">${STATUS_LABEL[p.status]}</span>
          <button class="corr-close" id="corr-close">✕</button>
        </div>
      </div>
      <div class="corr-modal-body">
        <div class="corr-field">
          <label>差异预览</label>
          <div class="corr-diff-box">${renderDiffHtml(p.originalValue, p.proposedValue)}</div>
        </div>
        <div class="corr-meta-list">
          <div><span>修订理由</span><p>${p.reason ? nl2br(p.reason) : '<em class="corr-hint">未填写</em>'}</p></div>
          <div><span>文献佐证</span><p>${p.evidence ? nl2br(p.evidence) : '<em class="corr-hint">未填写</em>'}</p></div>
        </div>
        <div class="corr-timeline">
          <div>创建草稿：${formatTime(p.createdAt)}</div>
          <div>确认提交：${formatTime(p.submittedAt)}</div>
          <div>撤销时间：${formatTime(p.withdrawnAt)}</div>
          <div class="corr-hint">提案编号：${esc(p.id)}</div>
        </div>
        <div class="corr-notice">
          🔒 本建议为用户提交的旁路修订，仅保存在本机用于留痕与本地审核，不会覆盖权威词条。
        </div>
        <div class="corr-footer">${actions.join('')}</div>
      </div>
    `);
  }

  /* ------------------------------ 审核中心 ------------------------------ */

  private reviewHtml(): string {
    const groups: Array<{ status: CorrectionProposal['status']; title: string }> = [
      { status: 'submitted', title: `待审核（${this.pendingCount}）` },
      { status: 'draft', title: `草稿箱（${this.draftCount}）` },
      { status: 'withdrawn', title: '已撤销留痕' }
    ];

    const sections = groups
      .map(g => {
        const items = this.proposals.filter(p => p.status === g.status);
        return `
          <section class="corr-review-group">
            <h3>${g.title}</h3>
            ${
              items.length === 0
                ? '<p class="corr-hint corr-empty">暂无记录</p>'
                : items
                    .map(p => {
                      const name = `${p.target.char ? `「${esc(p.target.char)}」` : ''}${esc(p.target.fieldLabel)}`;
                      return `
                      <button class="corr-review-item" data-proposal-id="${p.id}">
                        <span class="corr-pill corr-pill-${p.status} corr-pill-sm">${STATUS_LABEL[p.status]}</span>
                        <span class="corr-review-main">
                          <strong>《${esc(p.target.idiom)}》</strong>
                          <span class="corr-review-name">${name}</span>
                          <span class="corr-review-preview">${esc(p.proposedValue.slice(0, 48))}${
                            p.proposedValue.length > 48 ? '…' : ''
                          }</span>
                        </span>
                        <span class="corr-review-time">${formatTime(p.updatedAt)}</span>
                      </button>`;
                    })
                    .join('')
            }
          </section>`;
      })
      .join('');

    return `
      <div class="corr-backdrop"></div>
      <aside class="corr-drawer" role="dialog" aria-modal="true">
        <div class="corr-drawer-head">
          <div>
            <h2>本地审核中心</h2>
            <p class="corr-hint">本机留痕 · 不影响典籍权威词条</p>
          </div>
          <button class="corr-close" id="corr-close">✕</button>
        </div>
        <div class="corr-notice">
          🔒 所有修订建议均为旁路数据：待审核 ${this.pendingCount} 条、草稿 ${this.draftCount} 条。
          审核流程在本地完成，<strong>系统不会以用户建议直接覆盖权威词条</strong>。
        </div>
        <div class="corr-drawer-body">${sections}</div>
      </aside>`;
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  private bind(): void {
    this.overlay.querySelector('#corr-close')?.addEventListener('click', () => this.requestClose());

    if (this.view === 'editor') this.bindEditor();
    else if (this.view === 'proposal') this.bindProposal();
    else this.bindReview();
  }

  private bindEditor(): void {
    const s = this.session!;
    const proposedEl = this.overlay.querySelector('#corr-proposed') as HTMLTextAreaElement | null;
    const reasonEl = this.overlay.querySelector('#corr-reason') as HTMLTextAreaElement | null;
    const evidenceEl = this.overlay.querySelector('#corr-evidence') as HTMLTextAreaElement | null;

    proposedEl?.addEventListener('input', () => {
      s.proposed = proposedEl.value;
      s.dirty = true;
    });
    reasonEl?.addEventListener('input', () => {
      s.reason = reasonEl.value;
      s.dirty = true;
    });
    evidenceEl?.addEventListener('input', () => {
      s.evidence = evidenceEl.value;
      s.dirty = true;
    });

    this.overlay.querySelector('#corr-save-draft')?.addEventListener('click', () => this.handleSaveDraft());
    this.overlay.querySelector('#corr-back-edit')?.addEventListener('click', () => {
      s.step = 'edit';
      s.errors = [];
      this.render();
    });
    this.overlay
      .querySelector('#corr-agree')
      ?.addEventListener('change', e => {
        s.agreed = (e.target as HTMLInputElement).checked;
        const btn = this.overlay.querySelector('#corr-confirm-submit') as HTMLButtonElement | null;
        if (btn) btn.disabled = !s.agreed;
      });
    this.overlay.querySelector('#corr-confirm-submit')?.addEventListener('click', () => this.handleConfirmSubmit());
    this.overlay.querySelector('#corr-finish')?.addEventListener('click', () => this.close());
    this.overlay.querySelector('#corr-withdraw-done')?.addEventListener('click', () => this.handleWithdrawDone());
    this.overlay.querySelector('#corr-redraft-done')?.addEventListener('click', () => this.handleRedraftDone());
  }

  private async handleSaveDraft(): Promise<void> {
    const s = this.session!;
    const errors = validateDraftInput({
      originalValue: s.originalValue,
      proposedValue: s.proposed
    });
    if (errors.length > 0) {
      s.errors = errors;
      this.render();
      return;
    }
    try {
      const saved = await this.repo.saveDraft(
        {
          target: s.ref,
          originalValue: s.originalValue,
          proposedValue: s.proposed,
          reason: s.reason,
          evidence: s.evidence
        },
        s.draftId
      );
      s.draftId = saved.id;
      s.dirty = false;
      s.errors = [];
      s.savedAt = saved.updatedAt;
      s.flash = `草稿已保存至本机（${formatTime(saved.updatedAt)}），可继续预览或稍后在审核中心找回。`;
      s.step = 'preview';
      this.onMutate();
      this.render();
    } catch (err) {
      s.errors = [(err as Error).message];
      this.render();
    }
  }

  private async handleConfirmSubmit(): Promise<void> {
    const s = this.session!;
    if (!s.draftId) {
      s.errors = ['请先保存草稿，再确认提交'];
      this.render();
      return;
    }
    const errors = validateForSubmit({
      originalValue: s.originalValue,
      proposedValue: s.proposed,
      evidence: s.evidence
    });
    if (errors.length > 0) {
      s.errors = errors;
      this.render();
      return;
    }
    try {
      await this.repo.submit(s.draftId);
      s.step = 'done';
      s.doneStatus = 'submitted';
      s.dirty = false;
      this.onMutate();
      this.render();
    } catch (err) {
      s.errors = [(err as Error).message];
      this.render();
    }
  }

  private async handleWithdrawDone(): Promise<void> {
    const s = this.session!;
    if (!s.draftId || !window.confirm('确定撤销这条已提交的修订建议吗？撤销后可重新起草。')) return;
    try {
      await this.repo.withdraw(s.draftId);
      s.doneStatus = 'withdrawn';
      this.onMutate();
      this.render();
    } catch (err) {
      this.toast((err as Error).message);
    }
  }

  private async handleRedraftDone(): Promise<void> {
    const s = this.session!;
    if (!s.draftId) return;
    try {
      const draft = await this.repo.reDraft(s.draftId);
      this.openEditor({ proposal: draft });
      this.onMutate();
    } catch (err) {
      this.toast((err as Error).message);
    }
  }

  private bindProposal(): void {
    const p = this.proposals.find(x => x.id === this.activeProposalId);
    if (!p) return;

    this.overlay.querySelector('#corr-finish')?.addEventListener('click', () => this.close());

    this.overlay.querySelector('#corr-p-edit')?.addEventListener('click', () => {
      this.cameFromReview = true;
      this.openEditor({ proposal: p });
    });
    this.overlay.querySelector('#corr-p-redraft')?.addEventListener('click', async () => {
      try {
        const draft = await this.repo.reDraft(p.id);
        this.openEditor({ proposal: draft });
        this.onMutate();
      } catch (err) {
        this.toast((err as Error).message);
      }
    });
    this.overlay.querySelector('#corr-p-withdraw')?.addEventListener('click', async () => {
      if (!window.confirm('确定撤销这条已提交的修订建议吗？')) return;
      try {
        await this.repo.withdraw(p.id);
        this.toast('已撤销提交');
        this.proposals = await this.repo.listAll();
        this.onMutate();
      } catch (err) {
        this.toast((err as Error).message);
      }
    });
    this.overlay.querySelector('#corr-p-delete')?.addEventListener('click', async () => {
      if (!window.confirm('确定删除这条记录吗？此操作不可恢复。')) return;
      try {
        await this.repo.remove(p.id);
        this.toast('记录已删除');
        this.proposals = await this.repo.listAll();
        if (this.cameFromReview) {
          this.view = 'review';
        } else {
          this.close();
        }
        this.onMutate();
      } catch (err) {
        this.toast((err as Error).message);
      }
    });
  }

  private bindReview(): void {
    this.overlay.querySelectorAll<HTMLElement>('.corr-review-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-proposal-id');
        if (id) {
          this.cameFromReview = true;
          this.activeProposalId = id;
          this.view = 'proposal';
          this.render();
        }
      });
    });
  }
}
