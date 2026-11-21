import type { FloatSinkOutcome, PhaseStatus } from '@/lib/inquiry/domain/types';

export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  pending: '未开始',
  active: '进行中',
  completed: '已完成',
  invalidated: '需要重做',
};

export const OUTCOME_LABEL: Record<FloatSinkOutcome, string> = {
  float: '浮起来',
  sink: '沉下去',
  suspend: '停在水中',
};
