import { describe, expect, it } from 'vitest';
import type { Assignment, Course, CaptureResult } from './index';

describe('shared types', () => {
  it('Assignment matches backend response shape', () => {
    const a: Assignment = {
      id: 1,
      name: 'Tugas 1',
      module: 'assign',
      eventType: 'due',
      duedate: 1700000000,
      overdue: false,
      course: 'Analisis & Strategi Algoritma',
      courseId: 42,
    };
    expect(a.duedate).toBe(1700000000);
  });

  it('CaptureResult has hasKulon flag', () => {
    const r: CaptureResult = {
      accessToken: 'tok',
      capturedAt: 0,
      hasSso: true,
      hasMicrosoft: false,
      hasKulon: true,
    };
    expect(r.hasKulon).toBe(true);
  });

  it('Course matches backend response shape', () => {
    const c: Course = { id: 7, fullname: 'X', shortname: 'x', idnumber: '123' };
    expect(c.fullname).toBe('X');
  });
});