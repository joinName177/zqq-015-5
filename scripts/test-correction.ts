import { diffTexts, markSubmitted, markWithdrawn, createDraftProposal, reDraftFrom, validateDraftInput, validateForSubmit, buildTargetRef, getOriginalValue, targetKeyOf, STATUS_LABEL } from '../src/core/correction';
import { LocalCorrectionRepository } from '../src/adapters/local-correction.adapter';
import type { IdiomProfile } from '../src/core/models';

// ---- localStorage 垫片 ----
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear()
};

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.error('  ✗ ' + msg); }
}
function assertThrows(fn: () => void, msg: string) {
  try { fn(); failed++; console.error('  ✗ 未抛错: ' + msg); }
  catch { passed++; console.log('  ✓ 抛错正确: ' + msg); }
}

const profile: IdiomProfile = {
  id: 'id-test', idiom: '守株待兔', pinyin: '',
  characters: [{ char: '守', pinyin: '', radical: '宀', scriptType: '甲骨文', glyphSvg: '<svg/>', originalMeaning: '戍守、守护', pictographicExplanation: '宀如屋顶，寸如手' }],
  allusion: { dynasty: '战国时期 (约公元前230年)', classicBook: '《韩非子》', author: '韩非', yearApprox: '战国末期', historicalEvent: '', originalAncientQuote: '' },
  evolutionPath: [{ era: '战国法家', meaning: '农夫守候', semanticCategory: '本义', contextSample: '' }],
  dna: { originalPercent: 1, extendedPercent: 1, metaphoricalPercent: 98, polarity: '贬义', coreSememes: [] },
  modernDefinition: '比喻心存侥幸', syntacticRole: ''
};

console.log('1) 字符级差异 LCS');
{
  const d = diffTexts('守株待兔', '守株待鹿');
  assert(d.filter(s => s.op === 'delete').map(s => s.text).join('') === '兔', '删除片段=兔');
  assert(d.filter(s => s.op === 'insert').map(s => s.text).join('') === '鹿', '新增片段=鹿');
  assert(d.filter(s => s.op === 'equal').map(s => s.text).join('') === '守株待', '相同片段保留');
  const d2 = diffTexts('abc', 'abc');
  assert(d2.length === 1 && d2[0].op === 'equal', '相同文本无差异');
}

console.log('2) 目标引用与原文快照（只读权威）');
{
  const refGlyph = buildTargetRef(profile, 'character', 0, 'glyph');
  assert(refGlyph.fieldLabel.includes('字形构形'), '字形修订标签');
  assert(getOriginalValue(profile, refGlyph) === '宀如屋顶，寸如手', '字形修订原文取构形说解');
  const refDef = buildTargetRef(profile, 'character', 0, 'definition');
  assert(getOriginalValue(profile, refDef) === '戍守、守护', '释义修订原文取本义');
  const refEra = buildTargetRef(profile, 'allusion', -1, 'era');
  assert(getOriginalValue(profile, refEra).includes('公元前230年'), '年代修订原文含朝代');
  const refEvo = buildTargetRef(profile, 'evolution', 0, 'era');
  assert(targetKeyOf(refEvo) === 'id-test|evolution:0|era', 'targetKey 稳定');
  assert(profile.characters[0].originalMeaning === '戍守、守护', '权威词条未被流程触碰');
}

console.log('3) 草稿校验');
{
  assert(validateDraftInput({ originalValue: 'a', proposedValue: '  ' }).length === 1, '空修订被拒');
  assert(validateDraftInput({ originalValue: 'a', proposedValue: 'a' }).length === 1, '与原文一致被拒');
  assert(validateDraftInput({ originalValue: 'a', proposedValue: 'b' }).length === 0, '合法草稿通过');
  assert(validateForSubmit({ originalValue: 'a', proposedValue: 'b', evidence: '' }).length >= 1, '无佐证不可提交');
  assert(validateForSubmit({ originalValue: 'a', proposedValue: 'b', evidence: '《说文》' }).length === 0, '有佐证可提交');
}

console.log('4) 状态机：草稿→待审核→已撤销→重新起草');
{
  const t0 = 1000;
  const draft = createDraftProposal({
    target: buildTargetRef(profile, 'idiom', -1, 'definition'),
    originalValue: '比喻心存侥幸', proposedValue: '比喻死守经验', reason: 'r', evidence: '《韩非子》'
  }, t0);
  assert(draft.status === 'draft', '初始为草稿');
  assertThrows(() => markWithdrawn(draft, t0 + 1), '草稿不可直接撤销');
  const submitted = markSubmitted(draft, t0 + 10);
  assert(submitted.status === 'submitted' && submitted.submittedAt === t0 + 10, '提交后待审核');
  assertThrows(() => markSubmitted(submitted, t0 + 20), '待审核不可重复提交');
  const withdrawn = markWithdrawn(submitted, t0 + 20);
  assert(withdrawn.status === 'withdrawn' && withdrawn.withdrawnAt === t0 + 20, '撤销成功');
  assertThrows(() => markWithdrawn(withdrawn, t0 + 30), '已撤销不可再撤销');
  const re = reDraftFrom(withdrawn, t0 + 40);
  assert(re.status === 'draft' && re.id !== withdrawn.id, '重新起草生成新 ID（旧记录留痕）');
  assert(withdrawn.status === 'withdrawn', '旧记录仍保持已撤销');
}

console.log('5) 本地仓储（localStorage，与权威词典隔离）');
(async () => {
  mem.clear();
  const repo = new LocalCorrectionRepository();
  const target = buildTargetRef(profile, 'idiom', -1, 'definition');
  const key = targetKeyOf(target);

  const d1 = await repo.saveDraft({ target, originalValue: '比喻心存侥幸', proposedValue: '修订v1', reason: '', evidence: '' });
  assert(d1.status === 'draft', '保存草稿');

  // 同字段再次保存草稿（不带 id）→ 覆盖旧草稿而非新增
  const d2 = await repo.saveDraft({ target, originalValue: '比喻心存侥幸', proposedValue: '修订v2', reason: '理由', evidence: '' });
  const all = await repo.listAll();
  assert(all.length === 1 && all[0].proposedValue === '修订v2', '同字段草稿覆盖，不堆积');
  assert((await repo.latestByTargetKey(key))?.proposedValue === '修订v2', '按字段取最新');

  // 提交前缺佐证 → 报错且状态不变
  let errored = false;
  try { await repo.submit(d2.id); } catch { errored = true; }
  assert(errored, '缺佐证提交被仓储拒绝');
  assert((await repo.listAll())[0].status === 'draft', '拒绝后仍是草稿');

  const d3 = await repo.saveDraft({ target, originalValue: '比喻心存侥幸', proposedValue: '修订v3', reason: '理由', evidence: '《韩非子·五蠹》' }, d2.id);
  const sub = await repo.submit(d3.id);
  assert(sub.status === 'submitted', '补全佐证后提交成功');

  // 待审核不可删除，必须先撤销
  errored = false;
  try { await repo.remove(sub.id); } catch { errored = true; }
  assert(errored, '待审核提案禁止删除');

  const wd = await repo.withdraw(sub.id);
  assert(wd.status === 'withdrawn', '撤销提交');
  await repo.remove(wd.id);
  assert((await repo.listAll()).length === 0, '撤销后可删除');

  // 持久化：新仓储实例能读到同一 localStorage 数据
  mem.clear();
  const repoA = new LocalCorrectionRepository();
  await repoA.saveDraft({ target, originalValue: 'o', proposedValue: 'p', reason: '', evidence: 'e' });
  const repoB = new LocalCorrectionRepository();
  assert((await repoB.listAll()).length === 1, 'localStorage 跨实例持久化');

  // 不同字段各自独立留痕
  const charTarget = buildTargetRef(profile, 'character', 0, 'glyph');
  await repoB.saveDraft({ target: charTarget, originalValue: 'o2', proposedValue: 'p2', reason: '', evidence: 'e2' });
  const both = await repoB.listAll();
  assert(both.length === 2, '不同修订字段各自独立');

  // 数据损坏时容错
  (globalThis as any).localStorage.setItem('zqq015.correction-proposals.v1', 'not-json{');
  assert((await new LocalCorrectionRepository().listAll()).length === 0, '损坏数据容错为空');

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) process.exit(1);
})();
