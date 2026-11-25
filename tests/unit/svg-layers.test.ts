import { describe, expect, it } from 'vitest';
import { inkBox, layerSvg, MAX_LAYERS, placeLayers, splitSvg, stageScale, svgDataUrl, withoutScripts } from '../../src/lib/svg-layers';

const DRAWING = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="200mm" height="100mm" viewBox="0 0 200 100" preserveAspectRatio="none">
  <title>Scene</title>
  <defs><linearGradient id="sky"><stop offset="0" stop-color="#08f"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
  <style>.sun { fill: gold; }</style>
  <g inkscape:label="Sky" inkscape:groupmode="layer"><rect width="200" height="100" fill="url(#sky)"/></g>
  <g id="sun-layer"><circle id="disc" class="sun" cx="150" cy="30" r="12"/></g>
  <use href="#disc" x="-100"/>
  <g style="opacity:.5; display : none"><rect width="10" height="10"/></g>
  <path d="M0 90h200" stroke="green"><title>Ground line</title></path>
</svg>`;

describe('splitting an SVG into layers', () => {
  it('makes a layer of every visible top-level element, named as the drawing names them', () => {
    const split = splitSvg(DRAWING);
    expect(split.view).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(split.layers.map((layer) => layer.name)).toEqual(['Sky', 'sun-layer', 'use 3', 'Ground line']);
    expect(split.rootAttrs).toBe('xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"');
    expect(split.shared).toContain('<linearGradient id="sky">');
    expect(split.shared).toContain('.sun { fill: gold; }');
    expect(split.shared).not.toContain('Scene');
  });

  it('writes each layer as a drawing of its own, cropped to a box', () => {
    const split = splitSvg(DRAWING);
    const whole = layerSvg(split, 0);
    expect(whole.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(whole).toContain('viewBox="0 0 200 100" width="200" height="100"');
    expect(whole).toContain('fill="url(#sky)"');
    expect(whole).not.toContain('circle');
    const sun = layerSvg(split, 1, { x: 137, y: 17, width: 26, height: 26 });
    expect(sun).toContain('viewBox="137 17 26 26" width="26" height="26"');
    expect(sun).toContain('<circle id="disc"');
    expect(svgDataUrl(sun).startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(new TextDecoder().decode(Uint8Array.from(atob(svgDataUrl('<svg>é ☀</svg>').split(',')[1] ?? ''), (c) => c.charCodeAt(0)))).toBe('<svg>é ☀</svg>');
  });

  it('brings along what a layer points at in another layer', () => {
    const split = splitSvg(DRAWING);
    // The <use> shows the sun's disc, which lives in the sun layer.
    expect(split.layers[2]?.body).toBe('<defs><g id="sun-layer"><circle id="disc" class="sun" cx="150" cy="30" r="12"/></g></defs><use href="#disc" x="-100"/>');
    expect(split.layers[1]?.body).toBe('<g id="sun-layer"><circle id="disc" class="sun" cx="150" cy="30" r="12"/></g>');
  });

  it('looks through groups that wrap the whole drawing, and keeps what they do', () => {
    const split = splitSvg(
      '<svg viewBox="0 0 10 10"><g transform="scale(2)"><defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><g fill="red"><rect id="a" width="1" height="1"/><rect id="b" x="2" width="1" height="1"/></g></g></svg>',
    );
    expect(split.layers.map((layer) => layer.name)).toEqual(['a', 'b']);
    expect(split.layers[1]?.body).toBe('<g transform="scale(2)"><defs><clipPath id="c"><rect width="1" height="1"/></clipPath></defs><g fill="red"><rect id="b" x="2" width="1" height="1"/></g></g>');
    expect(split.rootAttrs).toBe('xmlns="http://www.w3.org/2000/svg"');
  });

  it('puts neighbours together when there are too many parts', () => {
    const many = `<svg width="100" height="50">${Array.from({ length: 150 }, (_, i) => `<rect id="r${i}" x="${i}" width="1" height="1"/>`).join('')}</svg>`;
    const split = splitSvg(many);
    expect(split.view).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(split.layers.length).toBeLessThanOrEqual(MAX_LAYERS);
    expect(split.layers).toHaveLength(50);
    expect(split.layers[0]?.name).toBe('r0 …');
    expect(split.layers[49]?.body).toBe('<rect id="r147" x="147" width="1" height="1"/><rect id="r148" x="148" width="1" height="1"/><rect id="r149" x="149" width="1" height="1"/>');
  });

  it('takes scripts and event handlers out', () => {
    const cleaned = withoutScripts(
      '<svg onload="alert(1)" width="5" height="5"><script>alert(2)</script><a xlink:href=" java\nscript:alert(3)" href="#ok"><rect onclick="x()" width="5" height="5"/></a></svg>',
    );
    expect(cleaned).not.toMatch(/alert|onload|onclick|script/i);
    expect(cleaned).toContain('href="#ok"');
    expect(splitSvg('<svg width="5" height="5"><script>1</script><rect width="5" height="5"/></svg>').layers).toHaveLength(1);
    expect(() => splitSvg('<svg width="5" height="5"><script>1</script></svg>')).toThrow(/nothing to draw/);
    expect(() => splitSvg('<html></html>')).toThrow();
  });

  it('finds the drawn part of a picture from its pixels', () => {
    const width = 8;
    const height = 6;
    const data = new Uint8ClampedArray(width * height * 4);
    expect(inkBox(data, width, height)).toBeNull();
    for (const [x, y] of [
      [3, 2],
      [5, 4],
    ] as const)
      data[(y * width + x) * 4 + 3] = 255;
    expect(inkBox(data, width, height)).toEqual({ x: 2, y: 1, width: 5, height: 5 });
    data[3] = 255;
    data[(5 * width + 7) * 4 + 3] = 9;
    expect(inkBox(data, width, height)).toEqual({ x: 0, y: 0, width: 8, height: 6 });
  });

  it('places layers around the middle of the drawing, scaled for the stage', () => {
    const split = splitSvg(DRAWING);
    expect(stageScale(split.view, { width: 1280, height: 720 })).toBe(3.2);
    expect(stageScale({ x: 0, y: 0, width: 2560, height: 720 }, { width: 1280, height: 720 })).toBe(0.5);
    expect(stageScale({ x: 0, y: 0, width: 800, height: 600 }, { width: 1280, height: 720 })).toBe(1);
    const placed = placeLayers(split, [{ x: 0, y: 0, width: 200, height: 100 }, { x: 137, y: 17, width: 26, height: 26 }, null, { x: 0, y: 89, width: 200, height: 2 }], 2);
    expect(placed.map((layer) => [layer.name, layer.x, layer.y, layer.width, layer.height])).toEqual([
      ['Sky', 0, 0, 400, 200],
      ['sun-layer', 100, -40, 52, 52],
      ['Ground line', 0, 80, 400, 4],
    ]);
    expect(placed[1]?.picture.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});
