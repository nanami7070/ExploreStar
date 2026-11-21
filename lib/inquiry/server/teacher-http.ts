import {
  isTeacherRequestAuthorized,
  teacherAccessConfigured,
} from './teacher';

/**
 * Gate for teacher routes. The whole surface is 404 until an operator sets
 * INQUIRY_TEACHER_TOKEN; an unauthorized request gets 401 and never touches
 * student data.
 */
export function teacherGuard(req: Request): Response | null {
  if (!teacherAccessConfigured()) return new Response('Not found', { status: 404 });
  if (!isTeacherRequestAuthorized(req)) {
    return Response.json(
      { errorCode: 'UNAUTHENTICATED', error: 'teacher token required' },
      { status: 401 },
    );
  }
  return null;
}
