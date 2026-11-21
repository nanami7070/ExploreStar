import { InquiryWorkbench } from '@/components/inquiry/inquiry-workbench';

export const dynamic = 'force-dynamic';

export default async function InquiryStudyPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  return <InquiryWorkbench studyId={studyId} />;
}
