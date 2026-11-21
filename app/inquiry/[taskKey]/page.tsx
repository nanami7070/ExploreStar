import { TaskIntro } from '@/components/inquiry/task-intro';

export const dynamic = 'force-dynamic';

export default async function InquiryTaskPage({
  params,
}: {
  params: Promise<{ taskKey: string }>;
}) {
  const { taskKey } = await params;
  return <TaskIntro taskKey={taskKey} />;
}
