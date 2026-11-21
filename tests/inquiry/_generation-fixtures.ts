/** Shared fixtures for the generation tests. Not a test file itself. */
import type { TaskDefinitionDraft } from '@/lib/inquiry/generation/task-schema';

const PHASES = [
  {
    id: 'question' as const,
    title: '提出问题',
    goal: '说出你注意到的现象，并把它变成一个可以研究的问题。',
    studentTasks: ['观察绿豆苗', '写下一个问题'],
    tutorGuidance: '你注意到的现象是什么？把它变成“为什么”或“怎样”的问题。',
  },
  {
    id: 'hypothesis' as const,
    title: '猜想与假设',
    goal: '对植物向阳生长作出猜想并说出理由。',
    studentTasks: ['写下我认为……', '写下因为……'],
    tutorGuidance: '你觉得植物为什么会朝着光长？说说你的理由。',
  },
  {
    id: 'experiment-design' as const,
    title: '设计实验',
    goal: '选出观察材料，说清改变与保持不变的条件。',
    studentTasks: ['选择观察材料', '写下要改变的条件'],
    tutorGuidance: '你打算把哪一盆植物放在窗边，哪一盆放在暗处？',
  },
  {
    id: 'evidence' as const,
    title: '收集证据',
    goal: '按计划做真实观察并如实记录。',
    studentTasks: ['每天观察一次', '记录你看到的现象'],
    tutorGuidance: '今天的观察和前几天的有什么不一样？',
  },
  {
    id: 'analysis' as const,
    title: '分析结果',
    goal: '根据观察记录写出结论并用证据支持。',
    studentTasks: ['比较两次观察', '写下结论'],
    tutorGuidance: '哪一次观察最支持你的想法？',
  },
  {
    id: 'reflection' as const,
    title: '反思与修正',
    goal: '回顾探究过程，说出可以改进的地方。',
    studentTasks: ['回顾探究', '写下下次的改进'],
    tutorGuidance: '如果再做一次，你会把观察做得更好吗？',
  },
];

/** A valid observation-task draft (plants turning toward light). */
export function observationDraft(): TaskDefinitionDraft {
  return {
    name: '植物向着太阳生长',
    refinedQuestion: '放在窗边的绿豆苗会朝什么方向生长？',
    grade: '3-4',
    context: {
      title: '窗台上的绿豆苗',
      text: '教室窗台上的绿豆苗过了一周，茎慢慢朝着窗户弯了过去。它是怎么知道光在哪边的呢？',
    },
    objectives: [
      '能提出一个关于植物生长方向的问题',
      '能设计对照观察并坚持记录',
      '能依据观察到的事实说出结论',
    ],
    concepts: ['植物向光生长', '对照观察'],
    materials: [
      { id: 'mung-bean', name: '绿豆' },
      { id: 'flower-pot', name: '花盆' },
      { id: 'water', name: '清水' },
    ],
    liquids: [],
    safety: ['浇水后擦干桌面，避免滑倒', '观察时不要把泥土弄进眼睛'],
    suggestedTrials: 4,
    experimentCapability: 'observation',
    phases: PHASES,
  };
}

/** A valid float/sink draft using only catalog ids. */
export function floatSinkDraft(): TaskDefinitionDraft {
  const base = observationDraft();
  return {
    ...base,
    name: '哪种材料最容易浮起来',
    refinedQuestion: '不同的固体材料放进清水里，沉浮表现一样吗？',
    context: {
      title: '水箱边的问题',
      text: '水箱里泡着木块和铁钉，一个浮着，一个沉到了水底。',
    },
    materials: [
      { id: 'wood-block', name: '木块' },
      { id: 'stone-block', name: '石块' },
      { id: 'iron-nail', name: '铁钉' },
    ],
    liquids: [
      { id: 'water', name: '清水' },
      { id: 'salt-water', name: '盐水' },
    ],
    experimentCapability: 'density-compare',
  };
}

/** A draft that claims a simulation but uses non-catalog materials. */
export function fakeSimulationDraft(): TaskDefinitionDraft {
  return {
    ...observationDraft(),
    materials: [
      { id: 'paper-plane', name: '纸飞机' },
      { id: 'ruler', name: '直尺' },
    ],
    liquids: [{ id: 'tap-water', name: '自来水' }],
    experimentCapability: 'density-compare',
  };
}
