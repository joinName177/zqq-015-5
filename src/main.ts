import './ui/styles.css';
import { DictionaryAdapter } from './adapters/dictionary.adapter';
import { KinshipAdapter } from './adapters/kinship.adapter';
import { LocalCorrectionAdapter } from './adapters/correction.adapter';
import { IdiomProfile, KinshipResult, CorrectionSubmission } from './core/models';
import { createCorrection } from './core/correction';
import { renderIdiomApp } from './ui/app';
import {
  CorrectionModalState,
  CorrectionTarget,
  renderCorrectionModal,
  renderCorrectionPanel,
  renderCorrectionToast
} from './ui/correction';

const dictAdapter = new DictionaryAdapter();
const kinshipAdapter = new KinshipAdapter();
const correctionRepo = new LocalCorrectionAdapter();

let currentMode: 'single' | 'compare' = 'single';
let currentProfile: IdiomProfile;
let compareA = '守株待兔';
let compareB = '刻舟求剑';
let kinshipResult: KinshipResult | null = null;

/* --------------------------- 纠错提案本地状态 --------------------------- */

let corrections: CorrectionSubmission[] = [];
let modal: CorrectionModalState = { open: false, target: null, editingId: null, proposedValue: '', reason: '' };
let toast: { message: string } | null = null;
let toastUndo: (() => void) | null = null;

interface UndoFrame {
  snapshot: CorrectionSubmission[];
  description: string;
}
const undoStack: UndoFrame[] = [];

const rootEl = document.getElementById('app')!;
const modalRoot = document.createElement('div');
const panelRoot = document.createElement('div');
const toastRoot = document.createElement('div');
document.body.appendChild(modalRoot);
document.body.appendChild(panelRoot);
document.body.appendChild(toastRoot);

async function refreshCorrections() {
  corrections = await correctionRepo.list();
}

function pushUndo(description: string) {
  undoStack.push({ snapshot: corrections.map(s => ({ ...s })), description });
  if (undoStack.length > 10) undoStack.shift();
}

async function undoLast() {
  const frame = undoStack.pop();
  if (!frame) return;
  corrections = frame.snapshot;
  await correctionRepo.replaceAll(corrections);
  renderAll();
  showToast(`已撤销：${frame.description}`);
}

function showToast(message: string, undo?: () => void) {
  toast = { message };
  toastUndo = undo ?? null;
  renderToastView();
}

function dismissToast() {
  toast = null;
  toastUndo = null;
  renderToastView();
}

/* ------------------------------- 模态框 ------------------------------- */

function openNewCorrection(target: CorrectionTarget) {
  modal = { open: true, target, editingId: null, proposedValue: '', reason: '' };
  renderModal();
}

function resumeDraft(id: string) {
  const sub = corrections.find(s => s.id === id);
  if (!sub) return;
  modal = {
    open: true,
    target: {
      fieldType: sub.fieldType,
      idiomId: sub.idiomId,
      idiomText: sub.idiomText,
      targetLabel: sub.targetLabel,
      fieldPath: sub.fieldPath,
      originalValue: sub.originalValue
    },
    editingId: sub.id,
    proposedValue: sub.proposedValue,
    reason: sub.reason
  };
  renderModal();
}

function closeModal() {
  modal = { open: false, target: null, editingId: null, proposedValue: '', reason: '' };
  renderModal();
}

function onFieldChange(field: 'proposedValue' | 'reason', value: string) {
  // 输入时仅同步内存状态（差异预览与按钮态由模态框局部更新，避免整体重渲染导致失焦）
  modal = { ...modal, [field]: value };
}

function buildSubmission(overrides: Partial<CorrectionSubmission> = {}): CorrectionSubmission | null {
  if (!modal.target) return null;
  const existing = modal.editingId ? corrections.find(s => s.id === modal.editingId) : undefined;
  const sub = createCorrection(
    {
      idiomId: modal.target.idiomId,
      idiomText: modal.target.idiomText,
      fieldType: modal.target.fieldType,
      targetLabel: modal.target.targetLabel,
      fieldPath: modal.target.fieldPath,
      originalValue: modal.target.originalValue,
      proposedValue: modal.proposedValue,
      reason: modal.reason
    },
    modal.editingId ?? undefined
  );
  if (existing) sub.createdAt = existing.createdAt;
  return { ...sub, ...overrides };
}

async function saveDraft() {
  if (modal.proposedValue.trim().length === 0) return;
  pushUndo('保存草稿');
  await correctionRepo.upsert(buildSubmission()!);
  await refreshCorrections();
  closeModal();
  renderAll();
  showToast('草稿已保存至本地，可随时继续编辑或提交审核', () => undoLast());
}

async function submitCorrection() {
  if (modal.proposedValue.trim().length === 0 || modal.reason.trim().length === 0) return;
  pushUndo('提交审核');
  const sub = buildSubmission({ status: 'pending', submittedAt: Date.now() })!;
  await correctionRepo.upsert(sub);
  await refreshCorrections();
  closeModal();
  renderAll();
  showToast('已提交至本地审核；权威词条未被修改', () => undoLast());
}

/* ----------------------------- 面板操作 ----------------------------- */

async function quickSubmit(id: string) {
  const sub = corrections.find(s => s.id === id);
  if (!sub) return;
  if (sub.proposedValue.trim().length === 0 || sub.reason.trim().length === 0) {
    resumeDraft(id);
    showToast('该草稿缺少修订值或修订依据，补全后即可提交');
    return;
  }
  pushUndo('提交审核');
  await correctionRepo.upsert({ ...sub, status: 'pending', submittedAt: Date.now(), updatedAt: Date.now() });
  await refreshCorrections();
  renderAll();
  showToast('已提交至本地审核；权威词条未被修改', () => undoLast());
}

async function withdraw(id: string) {
  const sub = corrections.find(s => s.id === id);
  if (!sub) return;
  pushUndo('撤回修改');
  await correctionRepo.upsert({
    ...sub,
    status: 'draft',
    submittedAt: undefined,
    reviewedAt: undefined,
    updatedAt: Date.now()
  });
  await refreshCorrections();
  renderAll();
  showToast('已撤回，恢复为草稿', () => undoLast());
}

async function review(id: string, decision: 'approved' | 'rejected') {
  const sub = corrections.find(s => s.id === id);
  if (!sub) return;
  pushUndo(decision === 'approved' ? '审核通过' : '审核驳回');
  await correctionRepo.upsert({ ...sub, status: decision, reviewedAt: Date.now(), updatedAt: Date.now() });
  await refreshCorrections();
  renderAll();
  showToast(decision === 'approved' ? '本地审核已通过（建议不会回写权威词条）' : '本地审核已驳回', () => undoLast());
}

async function removeCorrection(id: string) {
  pushUndo('删除提案');
  await correctionRepo.remove(id);
  await refreshCorrections();
  renderAll();
  showToast('提案已删除', () => undoLast());
}

/* ------------------------------- 渲染 ------------------------------- */

const correctionHandlers = {
  onFieldChange,
  onSaveDraft: saveDraft,
  onSubmit: submitCorrection,
  onClose: closeModal,
  onResume: resumeDraft,
  onQuickSubmit: quickSubmit,
  onDelete: removeCorrection,
  onWithdraw: withdraw,
  onReview: review
};

function renderModal() {
  renderCorrectionModal(modalRoot, modal, correctionHandlers);
}

function renderPanel() {
  renderCorrectionPanel(panelRoot, corrections, correctionHandlers);
}

function renderToastView() {
  renderCorrectionToast(toastRoot, toast, toastUndo, dismissToast);
}

function renderAll() {
  renderIdiomApp(
    rootEl,
    currentProfile,
    dictAdapter.getPresets(),
    currentMode,
    kinshipResult,
    compareA,
    compareB,
    {
      onSearch: async (text: string) => {
        currentProfile = await dictAdapter.getProfile(text);
        kinshipResult = null;
        renderAll();
      },
      onCompare: async (textA: string, textB: string) => {
        compareA = textA;
        compareB = textB;
        const pA = await dictAdapter.getProfile(textA);
        const pB = await dictAdapter.getProfile(textB);
        kinshipResult = kinshipAdapter.compareIdioms(pA, pB);
        renderAll();
      },
      onSwitchMode: (mode: 'single' | 'compare') => {
        currentMode = mode;
        renderAll();
      },
      onOpenCorrection: openNewCorrection
    }
  );
  renderModal();
  renderPanel();
  renderToastView();
}

async function init() {
  currentProfile = await dictAdapter.getProfile('守株待兔');
  const profA = await dictAdapter.getProfile(compareA);
  const profB = await dictAdapter.getProfile(compareB);
  kinshipResult = kinshipAdapter.compareIdioms(profA, profB);
  await refreshCorrections();
  renderAll();
}

init();
