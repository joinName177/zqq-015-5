import './ui/styles.css';
import { DictionaryAdapter } from './adapters/dictionary.adapter';
import { KinshipAdapter } from './adapters/kinship.adapter';
import { LocalCorrectionRepository } from './adapters/local-correction.adapter';
import { IdiomProfile, KinshipResult } from './core/models';
import { renderIdiomApp } from './ui/app';
import { CorrectionUIController } from './ui/correction-ui';

const dictAdapter = new DictionaryAdapter();
const kinshipAdapter = new KinshipAdapter();
const correctionRepo = new LocalCorrectionRepository();

let currentMode: 'single' | 'compare' = 'single';
let currentProfile: IdiomProfile;
let compareA = '守株待兔';
let compareB = '刻舟求剑';
let kinshipResult: KinshipResult | null = null;

const rootEl = document.getElementById('app')!;

// 纠错 UI 控制器：挂载在 app 容器之外，重渲染资料卡不会销毁弹窗
const correctionUI = new CorrectionUIController(document.body, correctionRepo, refreshCorrections);

async function init() {
  currentProfile = await dictAdapter.getProfile('守株待兔');
  const profA = await dictAdapter.getProfile(compareA);
  const profB = await dictAdapter.getProfile(compareB);
  kinshipResult = kinshipAdapter.compareIdioms(profA, profB);
  await refreshCorrections();
  refreshView();
}

async function refreshCorrections() {
  // 只读取用户提案旁路数据；权威词条从不参与合并、也不会被覆盖
  const proposals = await correctionRepo.listAll();
  correctionUI.syncState(proposals);
  refreshView();
}

function refreshView() {
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
        refreshView();
      },
      onCompare: async (textA: string, textB: string) => {
        compareA = textA;
        compareB = textB;
        const pA = await dictAdapter.getProfile(textA);
        const pB = await dictAdapter.getProfile(textB);
        kinshipResult = kinshipAdapter.compareIdioms(pA, pB);
        refreshView();
      },
      onSwitchMode: (mode: 'single' | 'compare') => {
        currentMode = mode;
        refreshView();
      }
    },
    correctionUI
  );
}

init();
