/**
 * The connectors that come with Asset Finder, as source text: each runs in its own
 * sandboxed worker, and the Sources tab shows and edits this same text.
 */

import aic from './connectors/aic.js?raw';
import ambientcg from './connectors/ambientcg.js?raw';
import archive from './connectors/archive.js?raw';
import bhl from './connectors/bhl.js?raw';
import blenderFilms from './connectors/blender-films.js?raw';
import cleveland from './connectors/cleveland.js?raw';
import commons from './connectors/commons.js?raw';
import europeana from './connectors/europeana.js?raw';
import fontsource from './connectors/fontsource.js?raw';
import freecad from './connectors/freecad.js?raw';
import freesound from './connectors/freesound.js?raw';
import gutenberg from './connectors/gutenberg.js?raw';
import iconify from './connectors/iconify.js?raw';
import jamendo from './connectors/jamendo.js?raw';
import librivox from './connectors/librivox.js?raw';
import loc from './connectors/loc.js?raw';
import met from './connectors/met.js?raw';
import nasa3d from './connectors/nasa-3d.js?raw';
import nasaImages from './connectors/nasa-images.js?raw';
import nasaSvs from './connectors/nasa-svs.js?raw';
import oapen from './connectors/oapen.js?raw';
import openlibrary from './connectors/openlibrary.js?raw';
import openverse from './connectors/openverse.js?raw';
import pexels from './connectors/pexels.js?raw';
import pixabay from './connectors/pixabay.js?raw';
import polyhaven from './connectors/polyhaven.js?raw';
import sketchfab from './connectors/sketchfab.js?raw';
import smithsonian from './connectors/smithsonian.js?raw';
import smk from './connectors/smk.js?raw';
import thingiverse from './connectors/thingiverse.js?raw';
import unsplash from './connectors/unsplash.js?raw';
import wellcome from './connectors/wellcome.js?raw';
import wikipedia from './connectors/wikipedia.js?raw';
import wikisource from './connectors/wikisource.js?raw';

/** Built-in connectors, in the order they are listed and asked. */
export const BUILTIN_CONNECTORS: readonly { readonly id: string; readonly code: string }[] = [
  { id: 'openverse', code: openverse },
  { id: 'commons', code: commons },
  { id: 'archive', code: archive },
  { id: 'europeana', code: europeana },
  { id: 'met', code: met },
  { id: 'aic', code: aic },
  { id: 'cleveland', code: cleveland },
  { id: 'smithsonian', code: smithsonian },
  { id: 'smk', code: smk },
  { id: 'wellcome', code: wellcome },
  { id: 'loc', code: loc },
  { id: 'nasa-images', code: nasaImages },
  { id: 'nasa-svs', code: nasaSvs },
  { id: 'sketchfab', code: sketchfab },
  { id: 'nasa-3d', code: nasa3d },
  { id: 'freecad', code: freecad },
  { id: 'thingiverse', code: thingiverse },
  { id: 'polyhaven', code: polyhaven },
  { id: 'ambientcg', code: ambientcg },
  { id: 'freesound', code: freesound },
  { id: 'jamendo', code: jamendo },
  { id: 'librivox', code: librivox },
  { id: 'gutenberg', code: gutenberg },
  { id: 'wikisource', code: wikisource },
  { id: 'wikipedia', code: wikipedia },
  { id: 'openlibrary', code: openlibrary },
  { id: 'oapen', code: oapen },
  { id: 'bhl', code: bhl },
  { id: 'iconify', code: iconify },
  { id: 'fontsource', code: fontsource },
  { id: 'blender-films', code: blenderFilms },
  { id: 'pexels', code: pexels },
  { id: 'pixabay', code: pixabay },
  { id: 'unsplash', code: unsplash },
];

export const builtinCode = (id: string): string | undefined => BUILTIN_CONNECTORS.find((c) => c.id === id)?.code;
