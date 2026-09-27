/* The examiner's voice, heard back through the microphone, must never be
   graded as the candidate's French. */
import { stripEcho } from './echo';

const AGENT = 'Très bien. Nous avons des vélos de ville, des vélos électriques et des VTT.';
const OPENING = 'Bonjour. Présentez-vous, s’il vous plaît.';

describe('stripEcho', () => {
  it("cuts the end of the examiner's line off the start of the turn", () => {
    expect(stripEcho('des vélos électriques et des VTT d\'accord et combien ça coûte', AGENT))
      .toBe("d'accord et combien ça coûte");
  });

  it("cuts the tail of the tâche 1 instruction, whatever the apostrophe", () => {
    expect(stripEcho("s'il vous plaît bonjour je m'appelle Dana", OPENING))
      .toBe("bonjour je m'appelle Dana");
  });

  it('drops a turn that was nothing but echo', () => {
    expect(stripEcho('des vélos électriques et des VTT.', AGENT)).toBe('');
  });

  it('cuts a long run of the examiner even when it is not the end of the line', () => {
    expect(stripEcho('nous avons des vélos de ville je voudrais un vélo', AGENT))
      .toBe('je voudrais un vélo');
  });

  it("keeps a candidate who reuses a few of the examiner's words", () => {
    expect(stripEcho('des vélos de ville, s’il vous plaît', AGENT))
      .toBe('des vélos de ville, s’il vous plaît');
    expect(stripEcho('nous avons besoin de deux vélos', AGENT))
      .toBe('nous avons besoin de deux vélos');
  });

  it('keeps a candidate who simply says hello back', () => {
    expect(stripEcho("Bonjour, je m'appelle Anna.", OPENING)).toBe("Bonjour, je m'appelle Anna.");
  });

  it('only looks at the start of the turn', () => {
    expect(stripEcho('je voudrais des vélos électriques et des VTT', AGENT))
      .toBe('je voudrais des vélos électriques et des VTT');
  });

  it('leaves the turn alone when there is no examiner line', () => {
    expect(stripEcho('bonjour', '')).toBe('bonjour');
    expect(stripEcho('', AGENT)).toBe('');
  });
});
