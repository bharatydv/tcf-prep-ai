/* The fifteen /tcf-canada paths, and nothing else.
 *
 * App.js needs the list to declare the routes, and App.js is the entry chunk.
 * Importing pages.js there would drag its fourteen icon components and its
 * copy tables into the bundle a first-time visitor downloads before seeing the
 * landing page — the exact regression the lazy() block in App.js exists to
 * undo. This file is strings, so the cost is a few hundred bytes.
 *
 * pages.js checks in development that the two lists still agree, so adding a
 * page to one and forgetting the other is caught on the next render rather
 * than by someone finding a dead link.
 */
export const TCF_CANADA_SLUGS = [
  'tcf-canada',
  'tcf-canada-practice',
  'tcf-canada-mock-test',
  'tcf-canada-exam-simulator',
  'tcf-canada-nclc-7',
  'tcf-canada-speaking',
  'tcf-canada-writing',
  'tcf-canada-listening',
  'tcf-canada-reading',
  'tcf-canada-speaking-task-1',
  'tcf-canada-speaking-task-2',
  'tcf-canada-speaking-task-3',
  'tcf-canada-writing-task-1',
  'tcf-canada-writing-task-2',
  'tcf-canada-writing-task-3',
];

export default TCF_CANADA_SLUGS;
