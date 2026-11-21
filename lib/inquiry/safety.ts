/**
 * Deterministic safety screening for student messages.
 *
 * This is an independent rule layer, not an LLM judgement (plan §五): a
 * message that asks for a dangerous action, or tries to redirect the tutor
 * with prompt-injection phrasing, is answered with a fixed safe reply and the
 * model is never called. The rules are intentionally conservative; a false
 * positive only costs a gentle redirect back to the safe materials.
 */

export type SafetyFlagKind = 'unsafe' | 'injection';

export interface SafetyScreenResult {
  kind: SafetyFlagKind | null;
  /** A fixed, model-free reply when `kind` is set. */
  reply?: string;
}

interface SafetyRule {
  pattern: RegExp;
  reply: string;
}

const UNSAFE_REPLY =
  '这个做法不安全，我们不能这样做。做实验要保护自己：不碰电、不用火、不喝也不尝实验材料。' +
  '我们可以用桌上的安全材料继续，你想先试哪一种？';

const INJECTION_REPLY =
  '我还是你的科学探究导师，会继续陪你做科学探究。我们回到当前的探究任务，接着往下走吧。';

const UNSAFE_RULES: readonly SafetyRule[] = [
  {
    pattern: /(插电|电源|插座|电线|通电|电池|电器)/,
    reply: UNSAFE_REPLY,
  },
  {
    pattern: /(加热|用火|点火|点火器|烧一烧|煮|开水|沸水|酒精灯)/,
    reply: UNSAFE_REPLY,
  },
  {
    // Tasting/testing an experiment sample is always unsafe. Bare 吃/喝 stay
    // scoped to the experiment context: "晚饭吃什么" is a normal (if
    // non-scientific) question, not a lab-safety event.
    pattern: /(尝一尝|尝一下|尝|吞|放进嘴里|含在嘴里)/,
    reply: UNSAFE_REPLY,
  },
  {
    pattern: /(吃|喝)[^。！？\n]{0,8}(实验|材料|药|化学|洗洁精|酒精|样品|盐水|它)/,
    reply: UNSAFE_REPLY,
  },
  {
    pattern: /(消毒液|漂白|药片|化学药品|洗洁精|酒精)/,
    reply: UNSAFE_REPLY,
  },
  {
    pattern: /(砸|敲碎|打碎|用锤子)/,
    reply: UNSAFE_REPLY,
  },
  {
    pattern: /(手机|电脑|平板).{0,8}(水|水箱)/,
    reply: UNSAFE_REPLY,
  },
  {
    pattern: /(铁钉|尖锐).{0,8}(扎|刺|划|对着).{0,6}(人|眼|同学)/,
    reply: UNSAFE_REPLY,
  },
];

const INJECTION_RULES: readonly SafetyRule[] = [
  {
    pattern:
      /(忽略|无视|忘记|跳过).{0,10}(之前|以上|前面|系统|所有).{0,10}(指令|规则|提示|要求|设定)/,
    reply: INJECTION_REPLY,
  },
  {
    pattern: /(系统提示|system\s*prompt|developer\s*mode|越狱|jailbreak)/i,
    reply: INJECTION_REPLY,
  },
  {
    pattern: /(输出|打印|重复|告诉).{0,8}(提示词|系统消息|系统指令|规则原文)/,
    reply: INJECTION_REPLY,
  },
  {
    pattern: /(你现在(?:不是|是)|假装你是|扮演).{0,10}(AI|助手|老师|机器人|角色)/,
    reply: INJECTION_REPLY,
  },
];

/** Screen one student message. Safe messages return `kind: null`. */
export function screenStudentMessage(text: string): SafetyScreenResult {
  const normalized = text.normalize('NFKC');
  if (!normalized.trim()) return { kind: null };
  for (const rule of UNSAFE_RULES) {
    if (rule.pattern.test(normalized)) return { kind: 'unsafe', reply: rule.reply };
  }
  for (const rule of INJECTION_RULES) {
    if (rule.pattern.test(normalized)) return { kind: 'injection', reply: rule.reply };
  }
  return { kind: null };
}
