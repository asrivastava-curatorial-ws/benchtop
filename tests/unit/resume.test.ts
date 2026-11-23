import { describe, expect, it } from 'vitest';
import { emptyResume, newItem, normalise, plainParts, type Resume, readResumeFile, resumeFile, resumeHtml, sampleResume, shortDate, toJsonResume } from '../../src/lib/resume';

const clean = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');

describe('résumés', () => {
  it('fills in what a file leaves out and keeps what it does not know', () => {
    const r = normalise({ basics: { name: 'Ada' }, metadata: { template: 'pikachu', css: 'x' }, extra: { keep: true } });
    expect(r.basics.name).toBe('Ada');
    expect(r.basics.website).toEqual({ url: '', label: '' });
    expect(r.sections.experience.items).toEqual([]);
    expect(r.metadata.template).toBe('pikachu');
    expect(r.metadata.css).toBe('x');
    expect(r.extra).toEqual({ keep: true });
    expect(r.metadata.layout.pages[0]?.main).toContain('experience');
    expect(r.benchtop?.template).toBe('classic');
  });

  it('round-trips its own (Reactive Resume 5) files', () => {
    const r = sampleResume();
    const { resume, format } = readResumeFile(resumeFile(r));
    expect(format).toBe('Reactive Resume');
    expect(resume).toEqual(r);
  });

  it('opens Reactive Resume 4 exports', () => {
    const v4 = {
      basics: {
        name: 'Ravi',
        headline: 'Engineer',
        email: 'r@example.com',
        phone: '',
        location: 'Pune',
        url: { label: 'Site', href: 'https://ravi.example' },
        customFields: [{ id: 'c1', icon: 'x', name: 'Twitter', value: '@ravi' }],
        picture: { url: '', size: 64, aspectRatio: 1, borderRadius: 0, effects: { hidden: false, border: false, grayscale: false } },
      },
      sections: {
        summary: { name: 'About', columns: 1, visible: true, id: 'summary', content: '<p>Hello</p>' },
        experience: {
          name: 'Work',
          columns: 1,
          visible: true,
          id: 'experience',
          items: [{ id: 'e1', visible: true, company: 'Acme', position: 'Dev', location: 'Pune', date: '2020 - 2022', summary: '<p>Did things</p>', url: { label: '', href: 'https://acme.example' } }],
        },
        education: {
          name: 'Education',
          columns: 1,
          visible: false,
          id: 'education',
          items: [{ id: 'd1', visible: false, institution: 'IIT', studyType: 'B.Tech', area: 'CS', score: '9.1', date: '2016 - 2020', summary: '', url: { label: '', href: '' } }],
        },
        custom: {
          abc: {
            name: 'Talks',
            columns: 1,
            visible: true,
            id: 'abc',
            items: [{ id: 't1', visible: true, name: 'Rust at scale', description: 'Conf', date: '2023', location: '', summary: '<p>Talk</p>', keywords: [], url: { label: '', href: '' } }],
          },
        },
      },
      metadata: {
        template: 'rhyhorn',
        layout: [[['summary', 'experience', 'custom.abc'], ['education']]],
        theme: { primary: '#ff0000', text: '#111111', background: '#ffffff' },
        typography: { font: { family: 'IBM Plex Sans', size: 11 }, lineHeight: 1.6 },
        page: { format: 'letter' },
      },
    };
    const { resume, format } = readResumeFile(JSON.stringify(v4));
    expect(format).toBe('Reactive Resume 4');
    expect(resume.basics.website.url).toBe('https://ravi.example');
    expect(resume.basics.customFields[0]?.text).toBe('@ravi');
    expect(resume.summary).toMatchObject({ title: 'About', content: '<p>Hello</p>', hidden: false });
    expect(resume.sections.experience.items[0]).toMatchObject({ company: 'Acme', position: 'Dev', period: '2020 - 2022', description: '<p>Did things</p>', website: { url: 'https://acme.example' } });
    expect(resume.sections.education.hidden).toBe(true);
    expect(resume.sections.education.items[0]).toMatchObject({ school: 'IIT', degree: 'B.Tech', grade: '9.1', hidden: true });
    expect(resume.customSections[0]).toMatchObject({ id: 'abc', title: 'Talks' });
    expect(resume.metadata.layout.pages[0]).toEqual({ fullWidth: false, main: ['summary', 'experience', 'abc'], sidebar: ['education'] });
    expect(resume.metadata.design.colors.primary).toBe('#ff0000');
    expect(resume.metadata.page.format).toBe('letter');
    expect(resume.metadata.typography.body).toMatchObject({ fontFamily: 'IBM Plex Sans', fontSize: 11, lineHeight: 1.6 });
  });

  it('opens and writes JSON Resume', () => {
    const j = {
      basics: {
        name: 'Lin',
        label: 'Designer',
        email: 'lin@example.com',
        url: 'https://lin.example',
        summary: 'Makes things.\n\nLikes tea.',
        location: { city: 'Kochi', countryCode: 'IN' },
        profiles: [{ network: 'GitHub', username: 'lin', url: 'https://github.com/lin' }],
      },
      work: [{ name: 'Studio', position: 'Lead', startDate: '2020-03-01', summary: 'Ran the studio', highlights: ['Grew the team', 'Shipped <b>v2</b>'] }],
      education: [{ institution: 'NID', area: 'Design', studyType: 'M.Des', startDate: '2016', endDate: '2018', courses: ['Typography'] }],
      skills: [{ name: 'Figma', level: 'Expert', keywords: ['UI'] }],
    };
    const { resume, format } = readResumeFile(JSON.stringify(j));
    expect(format).toBe('JSON Resume');
    expect(resume.basics).toMatchObject({ name: 'Lin', headline: 'Designer', location: 'Kochi, IN' });
    expect(resume.summary.content).toBe('<p>Makes things.</p><p>Likes tea.</p>');
    const job = resume.sections.experience.items[0] as Record<string, unknown>;
    expect(job.period).toBe('Mar 2020 – Present');
    expect(job.description).toBe('<p>Ran the studio</p><ul><li><p>Grew the team</p></li><li><p>Shipped &lt;b&gt;v2&lt;/b&gt;</p></li></ul>');
    expect(resume.sections.education.items[0]).toMatchObject({ school: 'NID', degree: 'M.Des', period: '2016 – 2018' });
    const out = toJsonResume(resume);
    expect(out.basics).toMatchObject({ name: 'Lin', label: 'Designer', summary: 'Makes things.\n\nLikes tea.' });
    expect((out.work as Record<string, unknown>[])[0]).toMatchObject({
      name: 'Studio',
      position: 'Lead',
      startDate: '2020-03',
      summary: 'Ran the studio',
      highlights: ['Grew the team', 'Shipped <b>v2</b>'],
    });
    expect((out.education as Record<string, unknown>[])[0]).toMatchObject({ institution: 'NID', startDate: '2016', endDate: '2018', courses: ['Typography'] });
  });

  it('turns dates and rich text into plain forms', () => {
    expect(shortDate('2021-11-05')).toBe('Nov 2021');
    expect(shortDate('2019')).toBe('2019');
    expect(plainParts('<p>One</p><p>Two<br>three</p><ul><li><p>A &amp; B</p></li></ul>')).toEqual({ text: 'One\n\nTwo\nthree', items: ['A & B'] });
  });

  it('refuses files it does not know', () => {
    expect(() => readResumeFile('[]')).toThrow(/does not hold/);
    expect(() => readResumeFile('{"hello":1}')).toThrow(/not a résumé/);
    expect(() => readResumeFile('x')).toThrow(/not JSON/);
  });

  it('draws pages with every template, in the layout order, leaving out what is hidden', () => {
    const r: Resume = sampleResume();
    r.basics.name = 'Meera <b>Iyer</b>';
    const evil = { ...newItem('projects'), name: 'Tricky', description: '<p>ok</p><script>alert(1)</script><img src=x onerror="alert(2)">' };
    r.sections.projects.items.push(evil);
    r.sections.languages.hidden = true;
    for (const template of ['classic', 'sidebar', 'banner', 'compact'] as const) {
      r.benchtop = { template };
      const html = resumeHtml(r, { clean });
      expect(html).toContain('Meera &lt;b&gt;Iyer&lt;/b&gt;');
      expect(html).not.toContain('<script>alert');
      expect(html).not.toContain('onerror');
      expect(html).not.toContain('Kannada');
      expect(html.indexOf('section-summary')).toBeLessThan(html.indexOf('section-experience'));
      expect(html).toContain(`class="t-${template}"`);
    }
    // An empty résumé still makes a page.
    expect(resumeHtml(emptyResume(), { clean })).toContain('Your name');
  });

  it('carries embedded fonts and the page size', () => {
    const r = sampleResume();
    r.metadata.page.format = 'letter';
    const html = resumeHtml(r, { clean, fonts: [{ family: 'Barlow', weight: '400', style: 'normal', src: 'data:font/woff2;base64,AAAA' }] });
    expect(html).toContain('@font-face{font-family:"Barlow"');
    expect(html).toContain('size: letter');
  });
});
