/**
 * The six-dimension inquiry rubric (plan §二).
 *
 * Levels are written for grade 3–4: Level 1 not yet shown, Level 2 with
 * prompting, Level 3 mostly independent, Level 4 actively using evidence.
 * The rubric deliberately does NOT reward guessing the result correctly;
 * expression quality (short sentences, dialect, spelling) is never a proxy
 * for scientific understanding.
 */
import type { RubricDimension } from './types';

export const INQUIRY_RUBRIC: readonly RubricDimension[] = [
  {
    dimension: 'question',
    title: '科学问题提出',
    objective: '能提出一个与本探究主题相关、可以动手探究的问题。',
    indicators: [
      '问题与本探究主题相关',
      '问题能用“为什么 / 怎样 / 如果……会……”等方式提出',
      '问题可以通过观察或实验找到线索',
    ],
    levels: [
      { level: 1, descriptor: '还没有提出自己的问题，或只重复了任务要求。' },
      { level: 2, descriptor: '在提示下提出了一个问题，但比较宽泛，或只是“是不是”的判断题。' },
      { level: 3, descriptor: '能自己提出一个与主题相关、可以动手研究的问题。' },
      { level: 4, descriptor: '能根据观察或上一次探究，主动把问题改得更清楚、更值得研究。' },
    ],
    evidenceTypes: ['问题提交原文', '问题修改记录', '与问题相关的导师对话'],
    avoid: [
      '不要因为句子短、口语化或有个别错字就判定能力低。',
      '不要只按问题字数或是否使用“专业词”打分。',
    ],
  },
  {
    dimension: 'hypothesis',
    title: '猜想与假设',
    objective: '能对问题作出猜想，并说出自己的理由。',
    indicators: [
      '写出了“我认为……”的猜想',
      '给出了“因为……”的理由（生活经验也可以）',
      '在获得新证据后，愿意修改或补充猜想',
    ],
    levels: [
      { level: 1, descriptor: '还没有作出猜想。' },
      { level: 2, descriptor: '在提示下写出了猜想，但没有说明理由。' },
      { level: 3, descriptor: '能自己写出比较清楚的猜想，并给出一个理由。' },
      { level: 4, descriptor: '能根据新的观察或证据，主动修改猜想并说明为什么改变。' },
    ],
    evidenceTypes: ['假设提交原文', '假设修改记录', '实验前预测'],
    avoid: [
      '猜想与“正确结论”不一致不代表猜想能力差，鼓励的是有理由的猜想。',
      '不要因为理由朴素（“木块轻”）就降级，生活经验是重要依据。',
    ],
  },
  {
    dimension: 'design',
    title: '实验设计',
    objective: '能选择材料，说明要改变和保持不变的条件，并注意安全。',
    indicators: [
      '选择了要比较的材料或观察对象',
      '说清了要改变的条件',
      '考虑到保持不变的公平条件与观察目标',
      '阅读并确认了安全提示',
    ],
    levels: [
      { level: 1, descriptor: '还没有选择材料或观察对象，或没有说明要做什么。' },
      { level: 2, descriptor: '在提示下选择了材料或观察对象，并写出了想改变的一个条件。' },
      { level: 3, descriptor: '能自己说清改变的条件、保持不变的条件和观察目标，并确认安全。' },
      { level: 4, descriptor: '能根据问题或前一次结果调整设计，让比较更公平、更有说服力。' },
    ],
    evidenceTypes: ['实验设计提交', '设计修改记录', '实验记录中的条件快照'],
    avoid: [
      '不要只数填写了多少栏；能用一句话说清关键条件同样值得肯定。',
      '不要要求学生使用“变量”“控制变量”等术语。',
    ],
  },
  {
    dimension: 'evidence',
    title: '证据收集',
    objective: '能动手做实验或进行真实观察，先预测再记录，并完整收集证据。',
    indicators: [
      '完成了实验或观察并记录了结果',
      '开始前记录了自己的预测或猜测',
      '覆盖不同的材料、条件或观察对象，能进行比较',
      '遇到预测与实际不一致时愿意重复验证',
    ],
    levels: [
      { level: 1, descriptor: '还没有完成实验或观察，或没有留下记录。' },
      { level: 2, descriptor: '完成了一次实验或观察，并记录了结果。' },
      { level: 3, descriptor: '多次实验或观察，每次都先预测再记录，并比较了不同的材料、条件或观察对象。' },
      { level: 4, descriptor: '能针对预测与实际不一致的地方主动重复或改变条件验证，记录完整。' },
    ],
    evidenceTypes: ['实验或真实观察记录（预测、观察、备注）', '预测与观察对比', '重复实验或重复观察'],
    avoid: [
      '实验次数多不等于能力强；重复应服务于验证某个想法。',
      '预测是否正确不作为证据收集的评分标准。',
      '真实实验与模拟实验同等有效，不因方式不同扣分。',
    ],
  },
  {
    dimension: 'analysis',
    title: '分析与解释',
    objective: '能依据自己的实验或观察记录写出结论，并说明证据如何支持结论。',
    indicators: [
      '写出了结论',
      '结论能引用具体实验或观察记录',
      '结论与观察结果一致',
      '证据不支持时愿意修正结论',
    ],
    levels: [
      { level: 1, descriptor: '还没有写出结论。' },
      { level: 2, descriptor: '在提示下写出了一个结论，但没有引用实验或观察记录。' },
      { level: 3, descriptor: '结论能引用具体的一次实验、观察或数据，并与记录一致。' },
      { level: 4, descriptor: '能比较多次结果、说出其中的规律，并在证据不支持时修正结论。' },
    ],
    evidenceTypes: ['结论提交', '实验或观察记录', '结论修改记录', '预测与观察对比'],
    avoid: [
      '不要只判断结论是否“正确”，重点是结论是否有证据支持。',
      '表达简短但指向明确时，不应评为能力低。',
      '学生观察与模拟结果不一致时，不能把它当成错误。',
    ],
  },
  {
    dimension: 'reflection',
    title: '反思与修正',
    objective: '能回顾探究过程，说出不足，并愿意根据证据改进。',
    indicators: [
      '回顾了自己的探究过程',
      '能指出实验的不足或可改进之处',
      '能结合预测与实际的不一致提出下一步想法',
      '在多轮探究中体现修正',
    ],
    levels: [
      { level: 1, descriptor: '还没有对自己的探究进行回顾。' },
      { level: 2, descriptor: '在提示下说出一句简单的回顾。' },
      { level: 3, descriptor: '能说出实验的不足或下一次可以改进的地方。' },
      { level: 4, descriptor: '能根据预测与实际的不一致或新的证据，提出具体的改进办法并再次尝试。' },
    ],
    evidenceTypes: ['反思提交', '假设 / 设计 / 结论的修改记录', '重复实验或观察记录'],
    avoid: [
      '不要按字数评价反思，一句话说到要点同样好。',
      '“这次很顺利，没有困难”不等于反思能力差，可继续追问。',
      '拼音、错别字和口语表达不作为降级依据。',
    ],
  },
];

export function rubricFor(dimension: RubricDimension['dimension']): RubricDimension {
  return INQUIRY_RUBRIC.find((entry) => entry.dimension === dimension)!;
}
