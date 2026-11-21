import { describe, expect, it } from 'vitest';

import {
  TUTOR_HISTORY_MESSAGES,
  buildTutorPrompt,
  conversationTurns,
  hintTemplateFor,
  latestSoftFeedback,
} from '@/lib/inquiry/prompts/tutor';
import {
  HYPOTHESIS,
  QUESTION,
  TASK,
  YES_NO_QUESTION,
  afterDesign,
  afterEvidence,
  afterHypothesis,
  startedSession,
} from './_helpers';

describe('tutor prompt construction', () => {
  it('anchors the tutor to the current phase and its goal', () => {
    const driver = startedSession().submit('q-1', QUESTION).chat('c-1', QUESTION.text!, 'student');
    const prompt = buildTutorPrompt({ task: TASK, state: driver.state });

    expect(prompt.system).toContain('第 1/6 步');
    expect(prompt.system).toContain('提出问题');
    expect(prompt.system).toContain('阶段目标');
    expect(prompt.system).toContain('为什么木块能浮在水面上');
    expect(prompt.meta.phaseId).toBe('question');
    expect(prompt.meta.hintLevel).toBe(0);
    expect(prompt.messages).toEqual([{ role: 'user', content: QUESTION.text! }]);
  });

  it('states the teaching rules: no conclusion, no submission, no phase advance', () => {
    const prompt = buildTutorPrompt({ task: TASK, state: startedSession().state });
    expect(prompt.system).toContain('不要直接宣布实验结论');
    expect(prompt.system).toContain('不要替学生填写或提交');
    expect(prompt.system).toContain('阶段推进只能由学生自己点击完成');
    expect(prompt.system).toContain('我们先把这一步做完');
    expect(prompt.system).toContain('你直接告诉我答案');
    expect(prompt.system).toContain('学生的观察和你认为的');
    expect(prompt.system).toContain('不要讲公式');
  });

  it('feeds the scaffold level, difficulty type and the level template', () => {
    const driver = startedSession()
      .submit('q-1', QUESTION)
      .submit('q-2', QUESTION)
      .submit('q-3', QUESTION)
      .submit('q-4', QUESTION)
      .hint({ explicit: true, classifiedType: 'concept' })
      .hint({ explicit: true });

    const prompt = buildTutorPrompt({ task: TASK, state: driver.state });
    expect(prompt.meta.hintLevel).toBe(2);
    expect(prompt.system).toContain('提示等级 L2');
    expect(prompt.system).toContain('concept');

    const template = hintTemplateFor(
      TASK.phases.find((phase) => phase.id === 'question')!,
      'concept',
      2,
    );
    expect(template).toBeTruthy();
    expect(prompt.system).toContain(template!);
  });

  it('forwards the latest failing soft feedback as suggestions', () => {
    const driver = startedSession().submit('q-yn', YES_NO_QUESTION);
    const prompt = buildTutorPrompt({ task: TASK, state: driver.state });
    expect(prompt.meta.softFeedback.join('\n')).toContain('是不是');
    expect(prompt.system).toContain('来自上一次提交的建议');
    // Soft feedback is phrased as a suggestion, never as a hard error.
    expect(prompt.system).toContain('只是建议');
    expect(latestSoftFeedback(driver.state, 'question')).toHaveLength(1);
  });

  it('summarizes experiments in 浮/沉 language without physics parameters', () => {
    const driver = afterEvidence().chat('c-1', '我做了两次实验。');
    const prompt = buildTutorPrompt({ task: TASK, state: driver.state });
    expect(prompt.system).toContain('木块');
    expect(prompt.system).toContain('清水');
    expect(prompt.system).toContain('浮起来');
    expect(prompt.system).toContain('石块');
    expect(prompt.system).toContain('沉下去');
    expect(prompt.system).not.toContain('0.50');
    expect(prompt.system).not.toContain('density');
    expect(prompt.system).not.toContain('密度');
  });

  it('tells the tutor not to invent results before any experiment exists', () => {
    const driver = afterDesign();
    const prompt = buildTutorPrompt({ task: TASK, state: driver.state });
    expect(prompt.system).toContain('还没有记录任何实验');
    expect(prompt.system).toContain('不要编造结果');
  });

  it('bounds and normalizes the conversation window', () => {
    const driver = startedSession();
    for (let index = 0; index < 30; index += 1) {
      driver.chat(`c-${index}`, `学生第 ${index} 句`, index % 2 === 0 ? 'student' : 'tutor');
    }
    const turns = conversationTurns(driver.state);
    expect(turns.length).toBeLessThanOrEqual(TUTOR_HISTORY_MESSAGES);
    expect(turns[0]!.role).toBe('user');
    for (let index = 1; index < turns.length; index += 1) {
      expect(turns[index]!.role).not.toBe(turns[index - 1]!.role);
    }
  });

  it('carries the whole inquiry dossier: question, hypothesis, design and conclusion', () => {
    const driver = afterDesign()
      .experimentEvidence('t-1', 'wood-block', 'water', {
        prediction: 'sink',
        note: '我猜错了，木块浮起来了',
      })
      .experimentEvidence('t-2', 'stone-block', 'water', { prediction: 'sink' })
      .complete()
      .submit('a-1', { text: '我发现木块浮起来，石块沉下去，因为它们的轻重不同。' });

    const prompt = buildTutorPrompt({ task: TASK, state: driver.state });
    expect(prompt.system).toContain('【学生完整探究档案】');
    expect(prompt.system).toContain('最初的问题：为什么木块能浮在水面上');
    expect(prompt.system).toContain('假设历史');
    expect(prompt.system).toContain('我认为木头做的物体会浮起来');
    expect(prompt.system).toContain('当前实验设计');
    expect(prompt.system).toContain('物体的材料');
    expect(prompt.system).toContain('学生已有的结论');
    expect(prompt.system).toContain('我发现木块浮起来');
    expect(prompt.system).toContain('学生预测：沉下去');
    expect(prompt.system).toContain('实际观察：浮起来');
    expect(prompt.system).toContain('（预测与观察不一致）');
    expect(prompt.system).toContain('【预测与观察不一致】');
    expect(prompt.system).toContain('绝不要否定他');
    expect(prompt.system).toContain('我猜错了，木块浮起来了');
  });

  it('shows the original hypothesis and the revised one the student later adopted', () => {
    const driver = afterHypothesis().revert({ targetPhaseIndex: 1 });
    driver.submit('h-2', {
      text: '我改变想法：塑料块也可能浮起来，因为我见过塑料小船。',
      reason: '见过塑料小船',
    });
    const prompt = buildTutorPrompt({ task: TASK, state: driver.state });

    expect(prompt.system).toContain(HYPOTHESIS.text!);
    expect(prompt.system).toContain('第 1 稿');
    expect(prompt.system).toContain('我改变想法');
    expect(prompt.system).toContain('第 2 稿，第 2 次进入本阶段（当前采用）');
    expect(prompt.system).toContain('见过塑料小船');
  });

  it('keeps superseded trials as history without counting them as current evidence', () => {
    const driver = afterDesign()
      .experimentEvidence('t-1', 'wood-block', 'water', { prediction: 'float' })
      .complete();
    // Go back to the design and re-enter evidence: the old trial becomes
    // superseded history while the phase waits for a new one.
    driver.revert({ targetPhaseIndex: 2 });
    driver.confirm('d-1').complete();
    const prompt = buildTutorPrompt({ task: TASK, state: driver.state });
    expect(prompt.system).toContain('【被修改过的历史实验】');
    expect(prompt.system).toContain('不作为当前证据');
    expect(prompt.system).toContain('当前还没有有效的实验记录');
  });

  it('drops a leading assistant turn so the history starts with the student', () => {
    const driver = startedSession()
      .chat('c-1', '你好，我是探知星导师。', 'tutor')
      .chat('c-2', '老师好。', 'student');
    const turns = conversationTurns(driver.state);
    expect(turns[0]).toEqual({ role: 'user', content: '老师好。' });
  });
});
