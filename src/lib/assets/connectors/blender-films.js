/**
 * Open films for screens: hand-checked releases of Blender open movies that suit museum screens,
 * planetarium-style shows and 3D projection (stereo 3D, 4K, 60 fps).  CC BY 3.0, Blender Foundation.
 * No network: the list is below (add films the same way).
 */
export const source = {
  id: 'blender-films',
  name: 'Open films for screens',
  about: 'Checked releases of Blender open movies: Big Buck Bunny in stereo 3D, 4K and 60 fps, and Tears of Steel in 4K (CC BY 3.0).',
  homepage: 'https://studio.blender.org/films/',
  terms: 'https://www.blender.org/about/license/',
  types: ['video', 'video3d'],
  hosts: [],
  settings: {},
  keys: [],
  signup: '',
};

const BBB = {
  year: 2013,
  creator: 'Blender Foundation',
  page: 'https://peach.blender.org/',
  thumb: 'https://commons.wikimedia.org/wiki/Special:FilePath/Big_Buck_Bunny_-_forest.jpg?width=400',
  duration: 634,
};
const TOS = { year: 2012, creator: 'Blender Foundation (Ian Hubert, director)', page: 'https://mango.blender.org/', thumb: '', duration: 734 };
const DEMO = 'https://download.blender.org/demo/movies';

const FILMS = [
  {
    ...BBB,
    id: 'bbb-3d-tb-1080p60',
    title: 'Big Buck Bunny (stereo 3D, top-bottom, 1080p 60 fps)',
    stereo: 'tb',
    width: 1920,
    height: 2160,
    url: `${DEMO}/BBB/bbb_sunflower_1080p_60fps_stereo_abl.mp4.zip`,
    size: 513774940,
    zip: true,
    description:
      'The 2013 "Sunflower" re-render of Big Buck Bunny, made for stereo 3D. Full-resolution top-bottom (left eye on top), H.264 with 5.1 AC-3 and stereo MP3 sound. Video Studio can make a side-by-side copy for 3D projectors or headsets.',
    tags: '3d stereo stereoscopic film animation blender open movie bunny top-bottom',
  },
  {
    ...BBB,
    id: 'bbb-3d-tb-2160p30',
    title: 'Big Buck Bunny (stereo 3D, top-bottom, 4K 30 fps)',
    stereo: 'tb',
    width: 3840,
    height: 4320,
    url: `${DEMO}/BBB/bbb_sunflower_2160p_30fps_stereo_abl.mp4.zip`,
    size: 822661274,
    zip: true,
    description: '4K-per-eye stereo 3D release, top-bottom with the left eye on top. Needs a capable player; most 3D projectors want a 1080p side-by-side copy.',
    tags: '3d stereo stereoscopic 4k uhd film animation blender open movie bunny top-bottom',
  },
  {
    ...BBB,
    id: 'bbb-3d-tb-1080p30',
    title: 'Big Buck Bunny (stereo 3D, top-bottom, 1080p 30 fps)',
    stereo: 'tb',
    width: 1920,
    height: 2160,
    url: `${DEMO}/BBB/bbb_sunflower_1080p_30fps_stereo_abl.mp4.zip`,
    size: 434207013,
    zip: true,
    description: 'Stereo 3D at 30 fps for players that cannot keep up with 60 fps; top-bottom with the left eye on top.',
    tags: '3d stereo stereoscopic film animation blender open movie bunny top-bottom',
  },
  {
    ...BBB,
    id: 'bbb-anaglyph-1080p60',
    title: 'Big Buck Bunny (red-cyan anaglyph 3D, 1080p 60 fps)',
    stereo: 'anaglyph',
    width: 1920,
    height: 1080,
    url: `${DEMO}/BBB/bbb_sunflower_1080p_60fps_stereo_arcd.mp4.zip`,
    size: 354337697,
    zip: true,
    description: 'Anaglyph version for red-cyan paper glasses: works on any ordinary screen or projector.',
    tags: '3d anaglyph red cyan glasses film animation blender open movie bunny',
  },
  {
    ...BBB,
    id: 'bbb-2d-2160p60',
    title: 'Big Buck Bunny (2D, 4K 60 fps)',
    stereo: '',
    width: 3840,
    height: 2160,
    url: `${DEMO}/BBB/bbb_sunflower_2160p_60fps_normal.mp4.zip`,
    size: 671868845,
    zip: true,
    description: 'The 2D Sunflower release at 3840×2160 and 60 frames per second.',
    tags: '4k uhd 60fps film animation blender open movie bunny',
  },
  {
    ...TOS,
    id: 'tos-4k',
    title: 'Tears of Steel (4K)',
    stereo: '',
    width: 3840,
    height: 1714,
    url: `${DEMO}/ToS/tearsofsteel_4k.mov`,
    size: 6737592810,
    zip: false,
    description: 'Live-action science-fiction short with visual effects made in Blender. H.264 4K (3840 wide) encode of the 2013 regraded render.',
    tags: '4k uhd film sci-fi science fiction live action vfx blender open movie robots',
  },
  {
    ...TOS,
    id: 'tos-1080p',
    title: 'Tears of Steel (1080p)',
    stereo: '',
    width: 1920,
    height: 800,
    url: `${DEMO}/ToS/tears_of_steel_1080p.mov`,
    size: 583774083,
    zip: false,
    description: 'HD release of Tears of Steel.',
    tags: 'hd film sci-fi science fiction live action vfx blender open movie robots',
  },
];

export async function search(q) {
  if (q.licence === 'pd') return { items: [], more: false };
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const onlyStereo = !q.types.includes('video');
  const items = FILMS.filter((f) => !onlyStereo || f.stereo)
    .filter((f) => words.every((w) => `${f.title} ${f.tags} ${f.creator}`.toLowerCase().includes(w)))
    .map((f) => ({
      id: f.id,
      type: f.stereo ? 'video3d' : 'video',
      title: f.title,
      creator: f.creator,
      creatorUrl: 'https://www.blender.org/',
      page: f.page,
      thumb: f.thumb,
      description: f.description,
      date: String(f.year),
      licence: 'CC BY 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
      width: f.width,
      height: f.height,
      duration: f.duration,
      size: f.size,
      formats: [f.zip ? 'mp4' : 'mov'],
      tags: f.tags.split(' '),
      stereo: f.stereo || undefined,
      files: [
        {
          label: f.zip ? 'Official release (MP4 in a ZIP, unpacked after download)' : 'Official release',
          url: f.url,
          name: f.url.split('/').pop(),
          size: f.size,
          width: f.width,
          height: f.height,
          unzip: f.zip,
          original: true,
        },
      ],
      extra: {},
    }));
  return { items, total: items.length, more: false };
}
