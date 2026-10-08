/* The sitting is the only thing holding tâches 1 and 2 while the candidate is
   away on the recorder's route grading tâche 3. If it drops them, the paper
   silently becomes a one-tâche result. */
import {
  readSitting, writeSitting, saveTask, sittingComplete, submissionSkill,
} from './speakingExam';

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

/* The bug this function exists to end: the dashboard decided which paper an
   answer belonged to from a hand-written list of source names, the list had
   never heard of the `speaking_exam` that Test Mode writes, and so every
   spoken answer given in a speaking paper was filed as WRITING — oral marks
   in the written level, and "Speaking: not practised yet" over a candidate's
   whole test history. */
describe('submissionSkill', () => {
  it('believes the row when the server has said which skill it is', () => {
    expect(submissionSkill({ skill: 'speaking', source: 'practice' })).toBe('speaking');
    expect(submissionSkill({ skill: 'writing', source: 'speaking' })).toBe('writing');
  });

  it('counts every spoken source as speaking when it has to guess', () => {
    for (const source of ['speaking', 'speaking_exam', 'conversation']) {
      expect(submissionSkill({ source })).toBe('speaking');
    }
  });

  it('counts a written source as writing', () => {
    expect(submissionSkill({ source: 'practice' })).toBe('writing');
    expect(submissionSkill({ source: 'paste' })).toBe('writing');
  });

  /* A source nobody has taught it about is writing rather than a crash or a
     blank: three of the four papers are not graded this way at all, and the
     only other thing a graded submission can be is a text. */
  it('is writing, not nothing, for a row it cannot place', () => {
    expect(submissionSkill({})).toBe('writing');
    expect(submissionSkill(null)).toBe('writing');
    expect(submissionSkill({ skill: 'reading' })).toBe('writing');
  });
});
