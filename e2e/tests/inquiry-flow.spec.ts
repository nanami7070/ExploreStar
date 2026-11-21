/**
 * P3 acceptance: a student walks the six-phase inquiry through the real UI.
 *
 * This spec uses the real database and the configured model (the tutor turn is
 * a live stream), so it is a local acceptance test, not part of the hermetic
 * unit suite. It creates one anonymous study per run.
 */
import { expect, test } from '@playwright/test';

test.describe('science inquiry flow', () => {
  test.setTimeout(240_000);

  test('completes question → hypothesis → design → experiment → analysis and survives a refresh', async ({
    page,
  }) => {
    await page.goto('/inquiry');
    await expect(page.getByRole('heading', { name: '小学科学探究' })).toBeVisible();

    // 2. Choose the task.
    await page.getByRole('link', { name: /影响物体在水中沉浮的因素/ }).click();
    await expect(
      page.getByRole('heading', { name: '影响物体在水中沉浮的因素' }).first(),
    ).toBeVisible();

    // 3. Create the study.
    await page.getByRole('button', { name: '开始我的探究' }).click();
    await expect(page.getByTestId('phase-title')).toHaveText('提出问题');

    // 4. Talk to the tutor (real model stream).
    await page.getByPlaceholder(/把你的想法告诉导师/).fill('老师，我想研究木块为什么会浮起来。');
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page.getByTestId('chat-message')).toHaveCount(2, { timeout: 120_000 });
    await expect(page.getByTestId('chat-message').last()).not.toBeEmpty();
    await expect(page.getByTestId('chat-streaming')).toHaveCount(0, { timeout: 120_000 });

    // 5. Submit the question.
    await page
      .getByPlaceholder(/写下你想研究的问题/)
      .fill('为什么木块能浮在水面上，而石头会沉下去？');
    await page.getByRole('button', { name: '提交这一步' }).click();
    await page.getByRole('button', { name: '完成本阶段，继续下一步' }).click();
    await expect(page.getByTestId('phase-title')).toHaveText('作出假设');

    // 6. Submit an incomplete hypothesis (no reason) — allowed.
    await page.getByPlaceholder('我认为……').fill('我觉得木块会浮起来。');
    await page.getByRole('button', { name: '提交这一步' }).click();
    await page.getByRole('button', { name: '完成本阶段，继续下一步' }).click();
    await expect(page.getByTestId('phase-title')).toHaveText('设计实验');

    // 7. Design the experiment.
    await page.getByRole('checkbox', { name: '木块' }).check();
    await page.getByRole('checkbox', { name: '石块' }).check();
    await page.getByPlaceholder('例如：物体的材料').fill('物体的材料');
    await page.getByPlaceholder('例如：都用清水，放进去的方式一样').fill('都用清水，放入方式一样');
    await page.getByPlaceholder('例如：物体是浮还是沉').fill('物体是浮还是沉');
    await page.getByRole('checkbox', { name: '我已经阅读并确认安全提示' }).check();
    await page.getByRole('button', { name: '提交这一步' }).click();
    await page.getByRole('button', { name: '完成本阶段，继续下一步' }).click();
    await expect(page.getByTestId('phase-title')).toHaveText('收集证据');

    // 8–9. Predict, run the simulation, and save the trial.
    await page.getByRole('radio', { name: '浮起来' }).check();
    await page.getByRole('button', { name: '完成并记录这次实验' }).click();
    const latest = page.getByTestId('latest-experiment');
    await expect(latest).toBeVisible();
    await expect(latest).toContainText('木块');
    await expect(latest).toContainText('浮起来');

    // 10. Move into analysis.
    await page.getByRole('button', { name: '完成本阶段，继续下一步' }).click();
    await expect(page.getByTestId('phase-title')).toHaveText('分析并得出结论');
    await page
      .getByPlaceholder(/我发现……/)
      .fill('我发现木块浮在水面上，石块沉下去，因为它们的轻重不同。');
    await page.getByRole('button', { name: '提交这一步' }).click();
    // Wait for the submission to be reflected in the workbench before taking a
    // revision snapshot; the confirm button only renders once a submission of
    // the current phase exists.
    await expect(page.getByRole('button', { name: '沿用上次提交' })).toBeVisible();

    // 11–12. Refresh and verify state + history consistency.
    const revisionLabel = page.getByText(/记录版本 r\d+/);
    const revisionBefore = await revisionLabel.textContent();
    await page.reload();
    await expect(page.getByTestId('phase-title')).toHaveText('分析并得出结论');
    await expect(revisionLabel).toHaveText(revisionBefore ?? '');
    await expect(page.getByTestId('chat-message')).toHaveCount(2);
    await expect(page.getByPlaceholder(/我发现……/)).toHaveValue(/我发现木块浮在水面上/);
  });
});
