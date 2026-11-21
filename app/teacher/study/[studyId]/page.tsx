import { TeacherStudy } from '@/components/inquiry/teacher-study';

export const dynamic = 'force-dynamic';

export default async function TeacherStudyPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  return <TeacherStudy studyId={studyId} />;
}
