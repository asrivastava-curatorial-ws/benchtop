/** The list of Bootstrap's customisable Sass variables, read from its own sources. */

import variablesScss from 'bootstrap/scss/_variables.scss?raw';
import variablesDarkScss from 'bootstrap/scss/_variables-dark.scss?raw';
import { parseVariables, type ThemeVariable } from './bootstrap-theme';

let catalogue: ThemeVariable[] | undefined;

/** Every customisable Bootstrap variable, light mode first. */
export function themeCatalogue(): ThemeVariable[] {
  catalogue ??= [...parseVariables(variablesScss), ...parseVariables(variablesDarkScss, { dark: true, prefix: 'Dark mode' })];
  return catalogue;
}
