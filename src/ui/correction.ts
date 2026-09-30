import { CorrectionFieldType, CorrectionStatus, CorrectionSubmission } from '../core/models';
import { CORRECTION_FIELD_META, CORRECTION_STATUS_META, diffChars } from '../core/correction';

/* ----------------------------- 类型定义 ----------------------------- */

/** 从资料卡触发的纠错目标（权威字段快照） */
export interface CorrectionTarget {
  fieldType: CorrectionFieldType;
  idiomId: string;
  idiomText: string;
  targetLabel: string;
  fieldPath: string;
  originalValue: string;
}

export interface CorrectionModalState {
  open: boolean;
  target: CorrectionTarget | null;
  editingId: string | null;
  proposedValue: string;
  reason: string;
}

export interface CorrectionUIHandlers {
  onFieldChange: (field: 'proposedValue' | 'reason', value: string) => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
  onClose: () => void;
  onResume: (id: string) => void;
  onQuickSubmit: (id: string) => void;
  onDelete: (id: string) => void;
  onWithdraw: (id: string) => void;
  onReview: (id: string, decision: 'approved' | 'rejected') => void;
}

/* ----------------------------- 工具函数 ----------------------------- */

function esc(s: string): string {
  return s.replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

const FIELD_TYPE_TAG: Record<CorrectionFieldType, string> = {
  glyph: '字形',
  era: '年代',
  definition: '释义'
};

const STATUS_CLASS: Record<CorrectionStatus, string> = {
  draft: 'status-draft',
  pending: 'status-pending',
  approved: 'status-approved',
  rejected: 'status-rejected'
};

/** 构建差异预览 HTML：原文删除线、建议新增下划线 */
export function buildDiffHtml(original: string, proposed: string): string {
  const segs = diffChars(original, proposed);
  if (!proposed.trim()) {
    return '<span class="diff-empty">在下方填写修订内容后，此处将实时显示差异预览</span>';
  }
  return segs
    .map(s => {
      if (s.type === 'equal') return `<span class="diff-equal">${esc(s.text)}</span>`;
      if (s.type === 'del') return `<del class="diff-del">${esc(s.text)}</del>`;
      return `<ins class="diff-ins">${esc(s.text)}</ins>`;
    })
    .join('');
}

/* ----------------------------- 纠错模态框 ----------------------------- */

export function renderCorrectionModal(
  root: HTMLElement,
  state: CorrectionModalState,
  handlers: CorrectionUIHandlers
): void {
  if (!state.open || !state.target) {
    root.innerHTML = '';
    return;
  }

  const target = state.target;
  const meta = CORRECTION_FIELD_META[target.fieldType];
  const canSubmit = state.proposedValue.trim().length > 0 && state.reason.trim().length > 0;
  const canSaveDraft = state.proposedValue.trim().length > 0;

  const controlHtml =
    meta.inputType === 'select'
      ? `
        <select id="corrProposed" class="corr-input corr-select">
          <option value="">— 请选择修订后的${meta.label.replace('修订', '')} —</option>
          ${(meta.options ?? [])
            .map(opt => `<option value="${esc(opt)}" ${state.proposedValue === opt ? 'selected' : ''}>${esc(opt)}</option>`)
            .join('')}
        </select>`
      : meta.inputType === 'input'
        ? `<input type="text" id="corrProposed" class="corr-input" value="${esc(state.proposedValue)}" placeholder="${esc(meta.placeholder)}" />`
        : `<textarea id="corrProposed" class="corr-input corr-textarea" rows="3" placeholder="${esc(meta.placeholder)}">${esc(state.proposedValue)}</textarea>`;

  root.innerHTML = `
    <div class="corr-overlay" id="corrOverlay">
      <div class="corr-modal" role="dialog" aria-modal="true" aria-label="提交修订建议">
        <div class="corr-modal-header">
          <div>
            <span class="corr-type-tag">${FIELD_TYPE_TAG[target.fieldType]}修订</span>
            <h3>${state.editingId ? '继续编辑草稿' : '提交修订建议'} · ${esc(target.targetLabel)}</h3>
            <div class="corr-idiom-ref">权威词条：《${esc(target.idiomText)}》 · 字段 ${esc(target.fieldPath)}</div>
          </div>
          <button class="corr-close" id="corrClose" aria-label="关闭">×</button>
        </div>

        <div class="corr-lock-note">
          🔒 权威词条受保护：修订建议仅进入本地审核流程，<strong>不会直接覆盖或修改权威词条内容</strong>。
        </div>

        <div class="corr-field">
          <label>${esc(meta.originalHint)}（权威原值）</label>
          <div class="corr-original">${esc(target.originalValue)}</div>
        </div>

        <div class="corr-field">
          <label for="corrProposed">建议修订为 <span class="corr-required">*</span></label>
          ${controlHtml}
        </div>

        <div class="corr-field">
          <label for="corrReason">修订依据 / 理由 <span class="corr-required">*</span></label>
          <textarea id="corrReason" class="corr-input corr-textarea" rows="3" placeholder="请说明修订的考据依据，如：据《甲骨文合集》第 X 片，此字书体应为金文而非甲骨文……">${esc(state.reason)}</textarea>
        </div>

        <div class="corr-field">
          <label>差异预览（原值 → 建议值）</label>
          <div class="corr-diff-box" id="corrDiff">${buildDiffHtml(target.originalValue, state.proposedValue)}</div>
        </div>

        <div class="corr-modal-actions">
          <button class="corr-btn corr-btn-ghost" id="corrCancel">取消</button>
          <button class="corr-btn corr-btn-draft" id="corrSaveDraft" ${canSaveDraft ? '' : 'disabled'}>保存草稿</button>
          <button class="corr-btn corr-btn-submit" id="corrSubmit" ${canSubmit ? '' : 'disabled'}>确认提交审核</button>
        </div>
        <div class="corr-hint">${canSubmit ? '填写完整，可提交至本地审核。' : '提示：填写修订值后可保存草稿；提交审核需同时填写修订依据。'}</div>
      </div>
    </div>
  `;

  const proposedEl = root.querySelector('#corrProposed') as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  const reasonEl = root.querySelector('#corrReason') as HTMLTextAreaElement | null;
  const diffEl = root.querySelector('#corrDiff');

  proposedEl?.addEventListener('input', () => {
    const val = proposedEl.value;
    handlers.onFieldChange('proposedValue', val);
    if (diffEl) diffEl.innerHTML = buildDiffHtml(target.originalValue, val);
    // 刷新按钮可用态
    const saveBtn = root.querySelector('#corrSaveDraft') as HTMLButtonElement | null;
    const submitBtn = root.querySelector('#corrSubmit') as HTMLButtonElement | null;
    const hasVal = val.trim().length > 0;
    const hasReason = (reasonEl?.value ?? '').trim().length > 0;
    if (saveBtn) saveBtn.disabled = !hasVal;
    if (submitBtn) submitBtn.disabled = !(hasVal && hasReason);
  });

  reasonEl?.addEventListener('input', () => {
    handlers.onFieldChange('reason', reasonEl.value);
    const submitBtn = root.querySelector('#corrSubmit') as HTMLButtonElement | null;
    const hasVal = (proposedEl?.value ?? '').trim().length > 0;
    if (submitBtn) submitBtn.disabled = !(hasVal && reasonEl.value.trim().length > 0);
  });

  root.querySelector('#corrClose')?.addEventListener('click', handlers.onClose);
  root.querySelector('#corrCancel')?.addEventListener('click', handlers.onClose);
  root.querySelector('#corrOverlay')?.addEventListener('click', e => {
    if (e.target === root.querySelector('#corrOverlay')) handlers.onClose();
  });
  root.querySelector('#corrSaveDraft')?.addEventListener('click', handlers.onSaveDraft);
  root.querySelector('#corrSubmit')?.addEventListener('click', handlers.onSubmit);
}

/* ----------------------------- 本地审核面板 ----------------------------- */

function diffBlockHtml(sub: CorrectionSubmission): string {
  return `
    <div class="corr-diff-box corr-diff-panel">
      <div class="corr-diff-line"><span class="corr-diff-tag corr-tag-orig">权威原值</span><span class="diff-equal">${esc(sub.originalValue)}</span></div>
      <div class="corr-diff-arrow">↓</div>
      <div class="corr-diff-line"><span class="corr-diff-tag corr-tag-proposed">建议修订</span>${buildDiffHtml(sub.originalValue, sub.proposedValue)}</div>
    </div>
  `;
}

function cardActionsHtml(sub: CorrectionSubmission, handlers: CorrectionUIHandlers): string {
  const btn = (label: string, cls: string, action: string, id: string) =>
    `<button class="corr-btn ${cls}" data-action="${action}" data-id="${id}">${label}</button>`;

  switch (sub.status) {
    case 'draft':
      return (
        btn('继续编辑', 'corr-btn-ghost', 'resume', sub.id) +
        btn('提交审核', 'corr-btn-submit', 'submit', sub.id) +
        btn('删除', 'corr-btn-danger', 'delete', sub.id)
      );
    case 'pending':
      return (
        btn('撤回草稿', 'corr-btn-ghost', 'withdraw', sub.id) +
        btn('审核通过', 'corr-btn-approve', 'approve', sub.id) +
        btn('驳回', 'corr-btn-reject', 'reject', sub.id)
      );
    case 'approved':
      return btn('退回草稿', 'corr-btn-ghost', 'withdraw', sub.id) + btn('删除', 'corr-btn-danger', 'delete', sub.id);
    case 'rejected':
      return (
        btn('继续编辑', 'corr-btn-ghost', 'resume', sub.id) +
        btn('退回草稿', 'corr-btn-ghost', 'withdraw', sub.id) +
        btn('删除', 'corr-btn-danger', 'delete', sub.id)
      );
  }
}

export function renderCorrectionPanel(
  root: HTMLElement,
  subs: CorrectionSubmission[],
  handlers: CorrectionUIHandlers
): void {
  const counts = {
    draft: subs.filter(s => s.status === 'draft').length,
    pending: subs.filter(s => s.status === 'pending').length,
    approved: subs.filter(s => s.status === 'approved').length,
    rejected: subs.filter(s => s.status === 'rejected').length
  };

  root.innerHTML = `
    <section class="correction-panel">
      <div class="section-title">
        <span>📮 纠错建议与本地审核状态</span>
      </div>

      <div class="corr-lock-note">
        🔒 <strong>权威词条保护机制：</strong>所有修订建议仅保存在本地浏览器（localStorage），
        草稿保存、提交、撤回、审核通过或驳回，<strong>均不会覆盖或回写权威词条</strong>。
        审核状态仅用于本地管理。
      </div>

      <div class="corr-stats">
        <span class="corr-stat">全部 <strong>${subs.length}</strong></span>
        <span class="corr-stat">草稿 <strong>${counts.draft}</strong></span>
        <span class="corr-stat corr-stat-pending">待审核 <strong>${counts.pending}</strong></span>
        <span class="corr-stat corr-stat-approved">已通过 <strong>${counts.approved}</strong></span>
        <span class="corr-stat corr-stat-rejected">已驳回 <strong>${counts.rejected}</strong></span>
      </div>

      ${
        subs.length === 0
          ? `
        <div class="corr-empty">
          <div class="corr-empty-icon">📝</div>
          <p>暂无纠错提案</p>
          <p class="corr-empty-sub">在资料卡上点击「纠错」按钮，可对<strong>字形、年代或释义</strong>提交修订建议。<br />流程：填写内容 → 保存草稿 → 确认提交审核 → 本地审核（可随时撤回 / 撤销）。</p>
        </div>`
          : `
        <div class="corr-list">
          ${subs
            .map(
              sub => `
            <div class="corr-card ${STATUS_CLASS[sub.status]}">
              <div class="corr-card-head">
                <div class="corr-card-title">
                  <span class="corr-type-tag">${FIELD_TYPE_TAG[sub.fieldType]}修订</span>
                  <strong>${esc(sub.targetLabel)}</strong>
                  <span class="corr-idiom-ref">《${esc(sub.idiomText)}》</span>
                </div>
                <span class="corr-status-badge ${STATUS_CLASS[sub.status]}">${CORRECTION_STATUS_META[sub.status].label}</span>
              </div>
              ${diffBlockHtml(sub)}
              ${sub.reason ? `<div class="corr-reason"><span class="corr-reason-label">修订依据：</span>${esc(sub.reason)}</div>` : ''}
              <div class="corr-card-meta">
                <span>创建于 ${fmtTime(sub.createdAt)}</span>
                ${sub.submittedAt ? `<span>提交于 ${fmtTime(sub.submittedAt)}</span>` : ''}
                ${sub.reviewedAt ? `<span>审核于 ${fmtTime(sub.reviewedAt)}</span>` : ''}
              </div>
              <div class="corr-card-actions">${cardActionsHtml(sub, handlers)}</div>
            </div>
          `
            )
            .join('')}
        </div>`
      }
    </section>
  `;

  root.querySelectorAll<HTMLElement>('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-id')!;
      const action = el.getAttribute('data-action')!;
      switch (action) {
        case 'resume':
          handlers.onResume(id);
          break;
        case 'delete':
          handlers.onDelete(id);
          break;
        case 'withdraw':
          handlers.onWithdraw(id);
          break;
        case 'approve':
          handlers.onReview(id, 'approved');
          break;
        case 'reject':
          handlers.onReview(id, 'rejected');
          break;
        case 'submit':
          handlers.onQuickSubmit(id);
          break;
      }
    });
  });
}

/* ----------------------------- 撤销 Toast ----------------------------- */

export function renderCorrectionToast(
  root: HTMLElement,
  toast: { message: string } | null,
  onUndo: (() => void) | null,
  onDismiss: () => void
): void {
  if (!toast) {
    root.innerHTML = '';
    return;
  }
  root.innerHTML = `
    <div class="corr-toast" role="status">
      <span>${esc(toast.message)}</span>
      <span class="corr-toast-actions">
        ${onUndo ? '<button class="corr-toast-undo" id="corrToastUndo">撤销</button>' : ''}
        <button class="corr-toast-close" id="corrToastDismiss">×</button>
      </span>
    </div>
  `;
  root.querySelector('#corrToastDismiss')?.addEventListener('click', onDismiss);
  root.querySelector('#corrToastUndo')?.addEventListener('click', () => {
    onUndo?.();
    onDismiss();
  });
}
