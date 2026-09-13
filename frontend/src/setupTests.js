/* Jest setup, picked up automatically by react-scripts.
 *
 * React 19 refuses to believe it is inside act() unless this global says so,
 * and without it every mount and unmount in a component test prints an "not
 * wrapped in act(...)" warning that has nothing wrong behind it. The warning
 * is the useful kind everywhere else, so it is switched on properly rather
 * than filtered out.
 */
global.IS_REACT_ACT_ENVIRONMENT = true;
