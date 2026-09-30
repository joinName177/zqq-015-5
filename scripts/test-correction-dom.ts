import { JSDOM } from 'jsdom';
import { DictionaryAdapter } from '../src/adapters/dictionary.adapter';
import { LocalCorrectionRepository } from '../src/adapters/local-correction.adapter';
import { renderIdiomApp } from '../src/ui/app';
import { CorrectionUIController } from '../src/ui/correction-ui';
import type { IdiomProfile } from '../src/core/models';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
dom.window.confirm = () => true;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).Node = dom.window.Node;
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, String(v)),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear()
};

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => { c ? (passed++, console.log('  ✓ ' + m)) : (failed++, console.error('  ✗ ' + m)); };
const click = (el: Element | null) => (el as HTMLElement | null)?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
const tick = () => new Promise(r => setTimeout(r, 10));
const clickAwait = async (sel: string) => { click($(sel)); await tick(); };
const $ = (sel: string) => document.querySelector(sel);
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel));

(async () => {
  const dict = new DictionaryAdapter();
  const repo = new LocalCorrectionRepository();
  const profile: IdiomProfile = await dict.getProfile('守株待兔');
  const host = document.body;
  const root = document.getElementById('app')!;

  let renderCount = 0;
  const corr = new CorrectionUIController(host, repo, async () => {
    corr.syncState(await repo.listAll());
    renderApp();
    renderCount++;
  });
  function renderApp() {
    renderIdiomApp(root, profile, dict.getPresets(), 'single', null, '守株待兔', '刻舟求剑', {
      onSearch: () => {}, onCompare: () => {}, onSwitchMode: () => {}
    }, corr);
  }
  corr.syncState(await repo.listAll());
  renderApp();

  console.log('1) 资料卡纠错入口渲染');
  assert($$('#app [data-corr-target]').length >= 10, `资料卡纠错按钮数量=${$$('#app [data-corr-target]').length}（字形/年代/释义）`);
  assert(!!$('#btnReviewCenter'), '头部有本地审核中心入口');
  assert(!document.querySelector('.corr-header-count'), '初始无未处理计数');

  console.log('2) 打开字形纠错弹窗');
  const glyphBtn = $('#app [data-corr-target="character"][data-cindex="0"][data-cfield="glyph"]');
  assert(!!glyphBtn, '「守」字资料卡上有字形纠错按钮');
  click(glyphBtn);
  assert(!$('.corr-overlay')?.classList.contains('corr-hidden'), '弹窗打开');
  assert(($('#corr-proposed') as HTMLTextAreaElement), '有修订建议输入框');
  assert($('.corr-original-box')?.textContent?.includes('宀') && $('.corr-original-box')?.textContent?.includes('如屋顶'), '权威原文（构形说解）只读展示');
  assert(!!$('#corr-save-draft') && !$('#corr-confirm-submit'), '第一步只有保存草稿，不能直接提交');

  console.log('3) 空内容不能保存草稿');
  await clickAwait('#corr-save-draft');
  assert(!!$('.corr-errors')?.textContent?.includes('不能为空'), '提示不能为空，停留在编辑步');
  assert((await repo.listAll()).length === 0, '未产生任何记录');

  console.log('4) 保存草稿 → 进入差异预览');
  const ta = $('#corr-proposed') as HTMLTextAreaElement;
  ta.value = '甲骨文中“宀”像宗庙屋顶，“寸”像持器之手，合意为守庙祭祀。';
  ta.dispatchEvent(new dom.window.Event('input'));
  ($('#corr-reason') as HTMLTextAreaElement).value = '旧说“在家把守”不确';
  ($('#corr-reason') as HTMLTextAreaElement).dispatchEvent(new dom.window.Event('input'));
  await clickAwait('#corr-save-draft');
  assert(!!$('.corr-diff-box'), '进入差异预览');
  const diff = $('.corr-diff-box')!;
  assert(!!diff.querySelector('ins') && !!diff.querySelector('del'), '差异含新增/新增与删除标色片段');
  assert(!!$('#corr-confirm-submit'), '预览步有确认提交按钮');
  assert(($('#corr-confirm-submit') as HTMLButtonElement).disabled, '未勾选承诺前提交按钮禁用');

  console.log('5) 资料卡出现草稿徽标，头部计数 +1');
  const badge = $('#app .oracle-card .corr-badge');
  assert(!!badge && badge.textContent?.includes('草稿'), '字形资料卡出现「草稿」徽标');
  assert($('#btnReviewCenter .corr-header-count')?.textContent === '1', '头部计数为 1');

  console.log('6) 无佐证不能确认提交');
  ($('#corr-agree') as HTMLInputElement).checked = true;
  $('#corr-agree')!.dispatchEvent(new dom.window.Event('change'));
  await clickAwait('#corr-confirm-submit');
  assert(!!$('.corr-errors')?.textContent?.includes('佐证'), '提示必须填写文献佐证');
  assert((await repo.listAll())[0].status === 'draft', '状态仍为草稿（先草稿后提交）');

  console.log('7) 返回修改补佐证 → 确认提交');
  click($('#corr-back-edit'));
  ($('#corr-evidence') as HTMLTextAreaElement).value = '《说文解字·宀部》';
  $('#corr-evidence')!.dispatchEvent(new dom.window.Event('input'));
  await clickAwait('#corr-save-draft');
  ($('#corr-agree') as HTMLInputElement).checked = true;
  $('#corr-agree')!.dispatchEvent(new dom.window.Event('change'));
  await clickAwait('#corr-confirm-submit');
  assert(!!$('.corr-done')?.textContent?.includes('本地审核队列'), '显示已提交完成态');
  assert((await repo.listAll())[0].status === 'submitted', '提案状态=待审核');
  assert($('#app .corr-badge')?.textContent?.includes('待审核'), '资料卡徽标变为「待审核」');

  console.log('8) 撤销提交');
  await clickAwait('#corr-withdraw-done');
  assert(!!$('.corr-done')?.textContent?.includes('已撤销'), '完成态切换为已撤销');
  assert((await repo.listAll())[0].status === 'withdrawn', '仓储状态=已撤销');
  assert($('#app .corr-badge')?.textContent?.includes('已撤销'), '资料卡徽标变为「已撤销」');

  console.log('9) 已撤销可重新起草（新 ID，旧记录留痕）');
  await clickAwait('#corr-redraft-done');
  assert(!!$('#corr-proposed'), '重新打开编辑器且内容回填');
  const all = await repo.listAll();
  assert(all.length === 2, '产生新草稿且旧撤销记录保留');
  assert(all.some(p => p.status === 'draft') && all.some(p => p.status === 'withdrawn'), '草稿+已撤销并存');

  console.log('10) 权威词条始终未被覆盖');
  assert(profile.characters[0].pictographicExplanation === '甲骨文中“宀”如屋顶，“寸”如手，合意为在家中把守防备。', '内存中的权威构形说解原样');
  assert(profile.characters[0].originalMeaning.includes('戍守'), '权威本义原样');
  const fresh = await dict.getProfile('守株待兔');
  assert(fresh.characters[0].pictographicExplanation.includes('在家中把守防备'), '词典适配器返回值原样');

  console.log('11) 审核中心：分组与计数');
  await clickAwait('#btnReviewCenter');
  assert(!!$('.corr-drawer'), '审核中心抽屉打开');
  assert($$('.corr-review-group h3').some(h => h.textContent?.includes('草稿箱')), '有草稿箱分组');
  assert($$('.corr-review-item').length === 2, '抽屉列出 2 条提案（草稿 + 已撤销）');
  assert($('.corr-drawer')?.textContent?.includes('不会以用户建议直接覆盖权威词条'), '展示不覆盖权威的声明');

  console.log('12) 点审核项进入详情，草稿可继续编辑');
  const draftItem = $$('.corr-review-item').find(b => b.textContent?.includes('草稿'));
  await (click(draftItem!), tick());
  assert(!!$('.corr-pill-draft'), '详情页显示草稿状态');
  await (click($('#corr-p-edit')), tick());
  assert(!!$('#corr-proposed'), '草稿详情可继续编辑');

  console.log(`\n结果: ${passed} 通过, ${failed} 失败（视图重渲染 ${renderCount} 次）`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
