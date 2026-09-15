/* The sitting is the only thing holding tâches 1 and 2 while the candidate is
   away on the recorder's route grading tâche 3. If it drops them, the paper
   silently becomes a one-tâche result. */
import { readSitting, writeSitting, saveTask, sittingComplete } from './speakingExam';

beforeEach(() => sessionStorage.clear());

describe('readSitting', () => {
  it('is empty for a sitting never taken', () => {
    expect(readSitting(7)).toEqual({});
  });

  it('is empty, not a crash, for a half-written entry', () => {
    sessionStorage.setItem('prepfrancais.speakingExam.7', '{not json');
    expect(readSitting(7)).toEqual({});
  });

  it('keeps sittings of different sets apart', () => {
    writeSitting(7, { 1: { tcf_level: 'B2' } });
    expect(readSitting(8)).toEqual({});
  });
});

describe('saveTask', () => {
  it('adds a tâche without disturbing the ones already answered', () => {
    writeSitting(7, { 1: { tcf_level: 'B1' }, 2: { tcf_level: 'B2' } });
    const sitting = saveTask(7, 3, { tcf_level: 'C1' });
    expect(Object.keys(sitting).sort()).toEqual(['1', '2', '3']);
    // and it is the STORED sitting that has to survive, not just the return
    expect(Object.keys(readSitting(7)).sort()).toEqual(['1', '2', '3']);
  });

  it('reports the sitting as it now stands, so the caller sees the paper end', () => {
    expect(sittingComplete(saveTask(7, 1, { tcf_level: 'B1' }))).toBe(false);
    expect(sittingComplete(saveTask(7, 2, { tcf_level: 'B1' }))).toBe(false);
    expect(sittingComplete(saveTask(7, 3, { tcf_level: 'B1' }))).toBe(true);
  });

  it('retaking a tâche replaces that one only', () => {
    saveTask(7, 1, { tcf_level: 'A2' });
    saveTask(7, 2, { tcf_level: 'B1' });
    const sitting = saveTask(7, 1, { tcf_level: 'B2' });
    expect(sitting[1].tcf_level).toBe('B2');
    expect(sitting[2].tcf_level).toBe('B1');
  });
});

describe('sittingComplete', () => {
  it('is false for anything short of all three, however good the answers', () => {
    expect(sittingComplete({})).toBe(false);
    expect(sittingComplete({ 1: {}, 3: {} })).toBe(false);
    expect(sittingComplete(null)).toBe(false);
  });

  it('reads a sitting that has been through storage, where keys are strings', () => {
    writeSitting(7, { 1: {}, 2: {}, 3: {} });
    expect(sittingComplete(readSitting(7))).toBe(true);
  });
});
