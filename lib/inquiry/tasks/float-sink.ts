/**
 * The MVP inquiry task: 《影响物体在水中沉浮的因素》.
 *
 * Everything here is reviewed, deterministic configuration — no model output.
 * Densities are nominal values for dry, solid, fixed-shape objects (plan §3.6);
 * hollow objects and clay reshaped into a boat are deliberately out of scope.
 * Student-facing hint text stays qualitative: figures and formulas live in the
 * physics module's records, not in grade 3–4 explanations.
 */
import type { InquiryTask } from '@/lib/inquiry/domain/types';
import { LIQUID_CATALOG, MATERIAL_CATALOG } from '@/lib/inquiry/experiments/catalog';

// The deterministic simulation catalog is shared with AI task generation so
// there is exactly one source of densities.
const MATERIALS = MATERIAL_CATALOG;
const LIQUIDS = LIQUID_CATALOG;

const MATERIAL_IDS = MATERIALS.map((material) => material.id);
const LIQUID_IDS = LIQUIDS.map((liquid) => liquid.id);

export const FLOAT_SINK_TASK: InquiryTask = {
  id: 'task-float-sink',
  key: 'float-sink',
  name: '影响物体在水中沉浮的因素',
  grade: '3-4',
  version: '1.0.0',
  goals: [
    '能提出一个可以动手探究的沉浮问题',
    '能对物体沉浮作出有理由的猜想',
    '能在实验设计中分清要改变的条件和要保持不变的条件',
    '能通过多次实验收集并记录证据',
    '能依据证据得出结论并反思实验的不足',
  ],
  concepts: [
    '有的物体在水中会浮起来，有的会沉下去',
    '同样大小的不同物体，轻重不同，沉浮表现可能不同',
    '同样一种物体，在清水和盐水里的沉浮表现可能不同',
  ],
  knowledge: {
    source: '教科版《科学》三年级下册《物体在水中的沉浮》单元（教师审核依据）',
    reviewer: '待指定教研审核人',
    reviewedAt: null,
  },
  intro: {
    title: '小科学家的水箱实验室',
    text:
      '实验室里有两个水箱：一个装清水，一个装盐水。桌上放着木块、塑料块、蜡块、石块、铁钉和一块橡皮泥。' +
      '把物体放进水里，有的浮起来，有的沉下去。这背后藏着什么秘密呢？今天，请你当小科学家，自己找出答案。',
  },
  topicKeywords: ['沉', '浮', '水', '液体', '材料', '物体', '盐水', '清水', '轻重', '大小'],
  materials: MATERIALS,
  liquids: LIQUIDS,
  safety: [
    '实验材料只能看、不能吃，实验后要洗手',
    '铁钉等尖锐材料要小心取放，不要对着眼睛',
    '模拟实验在电脑上操作；做真实实验时需要老师或家长陪同',
    '倒水、收材料时保持桌面整洁，避免滑倒',
  ],
  suggestedTrials: 3,
  phases: [
    {
      id: 'question',
      title: '提出问题',
      goal: '观察情境，提出一个可以动手探究的沉浮问题',
      studentTasks: ['观察情境里的物体', '写下你想研究的问题'],
      hardChecks: ['question.text-valid'],
      softChecks: ['question.form', 'question.relevance'],
      hintTemplates: {
        default: [
          '你在生活里见过哪些东西浮在水上、哪些沉下去？说说你的发现。',
          '想一想：这些物体的沉浮和物体本身的什么特点有关？',
          '可以试试这个句式：“________________ 的物体，为什么在水里会 ________ ？”',
        ],
        concept: [
          '你见过木块和石头放进水里分别怎么样？',
          '它们都是物体，可是沉浮不一样，你觉得可能和什么有关？',
          '这里有一张物体卡片清单，挑一个你最想研究的，用“为什么”或“怎样”提问。',
        ],
        'off-task': [
          '我们现在的任务是提出一个关于沉浮的问题哦。',
          '回到这一步：你在水里见过什么有趣的现象？把它变成一个问题。',
          '请从这张情境卡里选一个现象，写下你的问题。',
        ],
      },
    },
    {
      id: 'hypothesis',
      title: '作出假设',
      goal: '对问题作出猜想，并说出理由',
      studentTasks: ['写下“我认为……”', '补充“因为……”的理由'],
      hardChecks: ['hypothesis.text-present'],
      softChecks: ['hypothesis.reason', 'hypothesis.relevance'],
      hintTemplates: {
        default: [
          '你觉得答案可能是什么？大胆猜一猜，猜错也没关系。',
          '说说看：你这样猜的理由是什么？',
          '可以用“我认为________，因为________”的句式把猜想写完整。',
        ],
        expression: [
          '没关系，慢慢想。用一句“我认为……”开个头试试。',
          '把你想到的词先写下来：轻、重、大、小、什么材料……再连成一句话。',
          '这里有一个填空句式，选一个说法补完整：“我认为________会浮，因为________。”',
        ],
        concept: [
          '想一想你见过的木块和石头，它们放水里有什么不一样？',
          '猜一猜：沉浮可能和物体的轻重有关，还是和大小有关？',
          '有的同学认为“轻的会浮”，你觉得有道理吗？试着说一下你的理由。',
        ],
        'off-task': [
          '我们正在对刚才的问题作猜想，先猜一猜答案吧。',
          '回到你的问题：你认为会怎样？为什么这样认为？',
          '可以用这个句式开头：“我认为________，因为________。”',
        ],
      },
    },
    {
      id: 'experiment-design',
      title: '设计实验',
      goal: '选择材料，分清要改变的条件和保持不变的条件，确认安全要求',
      studentTasks: ['选择要用的材料', '写下要改变的条件', '确认安全提示'],
      hardChecks: ['design.materials', 'design.changed-condition', 'design.safety-confirmed'],
      softChecks: ['design.variables', 'design.single-variable'],
      hintTemplates: {
        default: [
          '先想一想：你打算改变哪一样东西，让两次实验不一样？',
          '为了让比较公平，哪些条件要保持一样？你准备观察什么？',
          '请填一填这张小表：改变的条件是________；保持不变的条件是________；我要观察________。',
        ],
        method: [
          '先挑两样材料，想一想它们哪里不一样。',
          '做比较实验时，一次只改变一个条件，其他条件要保持一样。',
          '按这张表逐行填写：材料________；改变的条件________；保持不变的条件________；观察________。填完再确认安全提示。',
        ],
        'off-task': [
          '我们正在设计实验哦，先想好要用哪两样材料。',
          '回到这一步：你要改变什么？什么保持不变？',
          '照着这张小表填一填，就能完成实验设计。',
        ],
      },
    },
    {
      id: 'evidence',
      title: '收集证据',
      goal: '动手完成模拟实验，把每一次结果记录下来',
      studentTasks: ['选择材料放进液体中观察', '记录每一次实验的结果'],
      hardChecks: ['evidence.min-records'],
      softChecks: ['evidence.suggested-count', 'evidence.control'],
      experiment: {
        model: 'density-compare',
        materialIds: MATERIAL_IDS,
        liquidIds: LIQUID_IDS,
      },
      hintTemplates: {
        default: [
          '动手试一试，观察它最后是浮起来还是沉下去，然后把结果记下来。',
          '看看记录表：你已经记录了哪些？还想再比较哪一种材料？',
          '照这样完成一次记录：材料________，液体________，结果是________。',
        ],
        method: [
          '每次只改变一样材料，其他保持一样，再看结果。',
          '记录表有三栏：材料、液体、结果。每次实验后立刻填一栏。',
          '演示一次完整记录：材料“木块”、液体“清水”、结果“浮起来”。你来完成下一次。',
        ],
        analysis: [
          '观察一下：同一种材料换一种液体，结果一样吗？',
          '比较记录表里的两行：有什么相同、什么不同？',
          '可以挑这两行来比较：________ 和 ________，结果是 ________ 和 ________。',
        ],
        'off-task': [
          '我们现在在收集证据哦，先去做一次实验吧。',
          '回到实验区：选一样材料，放进液体里，看结果。',
          '按记录表的第一行示例，完成一次实验记录。',
        ],
      },
    },
    {
      id: 'analysis',
      title: '分析并得出结论',
      goal: '根据记录的结果写出结论，并用证据支持它',
      studentTasks: ['看一看自己的记录表', '写下结论，并说明是哪次实验支持它'],
      hardChecks: ['analysis.text-present'],
      softChecks: ['analysis.evidence-link'],
      hintTemplates: {
        default: [
          '你手上的记录支持哪个说法？',
          '能不能引用其中一次实验的结果来说明？',
          '试试这个句式：“我发现________，因为第____次实验中________。”',
        ],
        analysis: [
          '你还在收集证据吗？可以先回到记录表看看。',
          '先不说结论，能指出表格里哪一行最支持你的想法吗？',
          '用这个句式检查一下：我的结论是________，支持它的记录是________。',
        ],
        expression: [
          '把你想说的先写成一小句话，不用完美。',
          '可以说说：哪个物体浮、哪个沉？你比较了什么？',
          '参考这个句式补完整：“我发现________，因为________。”',
        ],
        'off-task': [
          '我们正在根据实验结果得结论哦。',
          '回到记录表：你观察到了什么规律？',
          '照这个句式写一句结论：“我发现……因为……”。',
        ],
      },
    },
    {
      id: 'reflection',
      title: '交流反思与评价',
      goal: '回顾探究过程，反思实验还可以怎么改进',
      studentTasks: ['回顾自己的探究过程', '写一写这次实验的不足和下次的改进'],
      hardChecks: ['reflection.text-present'],
      softChecks: ['reflection.depth'],
      hintTemplates: {
        default: [
          '这次探究里，你最满意的地方是什么？',
          '如果再做一次，你会怎么改进？',
          '可以从这些角度挑一个写：材料够不够、次数多不多、条件控制得怎么样。',
        ],
        expression: [
          '想到什么就写什么，一句话也可以。',
          '比如：这次实验做得好的地方是________；还可以改进的地方是________。',
          '用这个句式补完整：“这次探究我做得好的地方是________；下次我想改进________。”',
        ],
        'off-task': [
          '我们正在回顾这次探究。',
          '回到这次实验：有哪些地方还可以做得更好？',
          '从“材料、次数、条件”里挑一个，说说下次怎么做得更好。',
        ],
      },
    },
  ],
  published: false,
};
