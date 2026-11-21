'use client';

export const TEACHER_TOKEN_KEY = 'inquiryTeacherToken';

export function readTeacherToken(): string {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(TEACHER_TOKEN_KEY) ?? '';
}

export function saveTeacherToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(TEACHER_TOKEN_KEY, token);
}

export function teacherHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
