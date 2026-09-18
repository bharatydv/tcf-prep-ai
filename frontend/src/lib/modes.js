/* Which practice modes the reading and listening pages offer.
 *
 * Both papers have always had two ways in: untimed practice, which marks one
 * question at a time and records no attempt, and test mode, which runs the
 * official clock and produces a score report. Only test mode is offered now.
 *
 * A flag rather than a deletion, deliberately. Practice mode is not gone: the
 * routes still resolve, /reading/practice and /listening/practice still work,
 * the picker and the per-question marking are untouched, and every attempt
 * already taken in it still reads back. The only change is that nothing on
 * the two landing pages points at it. Flip this to true and both mode cards
 * come back exactly as they were.
 *
 * Kept in one place so the two pages cannot disagree about it — which is the
 * failure a boolean copied into two files eventually produces.
 */
export const PRACTICE_MODE_VISIBLE = false;
