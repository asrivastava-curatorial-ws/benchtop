/**
 * The Live Quiz builder: the list of slides, the form for the slide that is
 * chosen, and the settings of the whole deck.
 */
import type { ComponentChildren } from 'preact';
import { type Deck, HIDEABLE, isQuiz, newSlide, type Option, problems, readSettings, readSlide, type Settings, SLIDE_NAMES, type Slide, type SlideType } from '../../lib/quiz';
import { pickFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt } from '../../ui/toast';

/** The kinds of slide on offer, grouped as the "add" list shows them. */
const KINDS: readonly { readonly group: string; readonly items: readonly { readonly key: string; readonly label: string; readonly make: () => Slide }[] }[] = [
  {
    group: 'Quiz questions (scored)',
    items: [
      { key: 'pick', label: 'Pick answer', make: () => newSlide('pick') },
      { key: 'truefalse', label: 'True or false', make: () => newSlide('pick', { title: 'True or false: ', options: [{ text: 'True', correct: true }, { text: 'False' }] }) },
      { key: 'type', label: 'Type answer', make: () => newSlide('type') },
      { key: 'match', label: 'Match pairs', make: () => newSlide('match') },
      { key: 'order', label: 'Correct order', make: () => newSlide('order') },
      { key: 'categorise', label: 'Categorise', make: () => newSlide('categorise') },
    ],
  },
  {
    group: 'Ask the audience',
    items: [
      { key: 'poll', label: 'Poll', make: () => newSlide('poll') },
      { key: 'cloud', label: 'Word cloud', make: () => newSlide('cloud') },
      { key: 'open', label: 'Open ended', make: () => newSlide('open') },
      { key: 'scale', label: 'Rating scale', make: () => newSlide('scale') },
      { key: 'ranking', label: 'Ranking', make: () => newSlide('ranking') },
      { key: 'pin', label: 'Pin on image', make: () => newSlide('pin') },
      { key: 'qa', label: 'Q&A', make: () => newSlide('qa') },
      { key: 'brainstorm', label: 'Brainstorm', make: () => newSlide('brainstorm') },
    ],
  },
  {
    group: 'Show',
    items: [
      { key: 'content', label: 'Content', make: () => newSlide('content') },
      { key: 'wheel', label: 'Spinner wheel', make: () => newSlide('wheel') },
      { key: 'leaderboard', label: 'Leaderboard', make: () => newSlide('leaderboard') },
    ],
  },
];

/** What each kind of slide is for, shown above its form. */
const ABOUT: Record<SlideType, string> = {
  pick: 'People choose from the answers; mark every right one. With several right answers, people may choose several.',
  type: 'People type the answer. Capitals, accents and extra spaces do not matter; list every spelling that should count.',
  match: 'People pair each item on the left with one on the right. Write the pairs as they belong together; the right-hand side is shuffled.',
  order: 'People put the items in order. Write them in the right order; they are shown shuffled.',
  categorise: 'People sort the items into the categories. Write each item under the category it belongs to.',
  poll: 'People vote for an option; the votes are counted on the big screen as they come in.',
  cloud: 'People send a word or a short phrase; words sent more often are shown larger.',
  open: 'People write a reply of any length; the replies are shown as a wall of notes.',
  scale: 'People rate each statement on a scale; the big screen shows the average.',
  ranking: 'People put the options in their own order of preference; first place counts most.',
  pin: 'People put a pin on your picture: a map, a floor plan, a photograph. The big screen shows every pin.',
  qa: 'People ask questions and vote for the ones they want answered; mark them answered as you go.',
  brainstorm: 'People send ideas, then vote for the best, then see them in order.',
  wheel: 'A wheel that picks one entry at random: one of the people who joined, or one of your own entries.',
  content: 'A heading with text and a picture, to say or show something between questions.',
  leaderboard: 'The standings so far: the top players, and the teams when the quiz is played in teams.',
};

const MAX_PICTURE = 2_900_000;

/** A picture file as a data URL small enough to send to phones: scaled down, JPEG unless it has see-through parts. */
async function shrinkPicture(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, GIF, WebP or AVIF picture.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This picture could not be read.');
  });
  try {
    for (const side of [1280, 960, 640, 400]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This picture could not be prepared.');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let clear = false;
      for (let i = 3; i < data.length && !clear; i += 4) clear = (data[i] as number) < 250;
      const url = clear ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86);
      if (url.length < MAX_PICTURE) return url;
    }
  } finally {
    bitmap.close();
  }
  throw new Error('This picture is too large to send to phones, even scaled down.');
}

function Field({ label, help, children, wide }: { label: string; help?: string; children: ComponentChildren; wide?: boolean }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control arrives as children
    <label class={`control${wide ? ' qb-wide' : ''}`}>
      <span class="control-label">{label}</span>
      {children}
      {help && <span class="control-help">{help}</span>}
    </label>
  );
}

function Check({ label, checked, onChange, testId, help }: { label: string; checked: boolean; onChange: (on: boolean) => void; testId?: string; help?: string }) {
  return (
    <div class="qb-check">
      <label class="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} data-testid={testId} />
        {label}
      </label>
      {help && <p class="control-help">{help}</p>}
    </div>
  );
}

/** A whole number that is taken when the box is left, so that typing "15" is not cut short at "1". */
function Whole({ label, value, min, max, onChange, testId, help }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; testId?: string; help?: string }) {
  return (
    <Field label={label} help={help}>
      <input
        class="input input-number"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => {
          const typed = Number(e.currentTarget.value);
          const next = Number.isFinite(typed) && e.currentTarget.value.trim() !== '' ? Math.min(max, Math.max(min, Math.round(typed))) : value;
          e.currentTarget.value = String(next);
          onChange(next);
        }}
        data-testid={testId}
      />
    </Field>
  );
}

/** A list of short lines: one box each, with a way to add and to take away. */
function Lines({
  label,
  items,
  max,
  min = 0,
  onChange,
  placeholder,
  testId,
  help,
  noun,
}: {
  label: string;
  items: readonly string[];
  max: number;
  min?: number;
  onChange: (items: string[]) => void;
  placeholder?: string;
  testId: string;
  help?: string;
  noun: string;
}) {
  return (
    <fieldset class="qb-lines">
      <legend class="control-label">{label}</legend>
      {items.map((item, index) => (
        <div class="qb-line" key={index}>
          <span class="qb-number">{index + 1}</span>
          <input
            class="input"
            value={item}
            placeholder={placeholder}
            aria-label={`${noun} ${index + 1}`}
            onInput={(e) => onChange(items.map((old, i) => (i === index ? e.currentTarget.value : old)))}
            data-testid={testId}
          />
          <button
            type="button"
            class="icon-button"
            aria-label={`Remove ${noun.toLowerCase()} ${index + 1}`}
            disabled={items.length <= min}
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
      <div class="button-row">
        <button type="button" class="button button-small" disabled={items.length >= max} onClick={() => onChange([...items, ''])} data-testid={`${testId}-add`}>
          <Icon name="plus" size={13} /> Add
        </button>
      </div>
      {help && <p class="control-help">{help}</p>}
    </fieldset>
  );
}

function Picture({ value, onChange, label, testId }: { value: string | undefined; onChange: (value: string | undefined) => void; label: string; testId?: string }) {
  const choose = () =>
    attempt(async () => {
      const file = await pickFile('image/png,image/jpeg,image/gif,image/webp,image/avif');
      if (file) onChange(await shrinkPicture(file));
    });
  return (
    <span class="qb-picture">
      {value && <img src={value} alt="" />}
      <button type="button" class="button button-small" onClick={choose} data-testid={testId}>
        <Icon name="image" size={13} /> {value ? 'Change' : label}
      </button>
      {value && (
        <button type="button" class="button button-small button-quiet" onClick={() => onChange(undefined)}>
          Remove
        </button>
      )}
    </span>
  );
}

function Options({ slide, set, withCorrect, withPictures, max }: { slide: Slide; set: (patch: Record<string, unknown>) => void; withCorrect: boolean; withPictures: boolean; max: number }) {
  const change = (index: number, patch: Partial<Option> & { image?: string | undefined }) =>
    set({
      options: slide.options.map((option, i) => {
        if (i !== index) return option;
        const { image, ...rest } = { ...option, ...patch };
        return image ? { ...rest, image } : rest;
      }),
    });
  return (
    <fieldset class="qb-lines">
      <legend class="control-label">{withCorrect ? 'Answers (tick every right one)' : 'Options'}</legend>
      {slide.options.map((option, index) => (
        <div class="qb-line" key={index}>
          {withCorrect ? (
            <input
              type="checkbox"
              checked={option.correct === true}
              aria-label={`Answer ${index + 1} is right`}
              onChange={(e) => change(index, { correct: e.currentTarget.checked })}
              data-testid="qb-correct"
            />
          ) : (
            <span class="qb-number">{index + 1}</span>
          )}
          <input
            class="input"
            value={option.text}
            maxLength={200}
            aria-label={`${withCorrect ? 'Answer' : 'Option'} ${index + 1}`}
            onInput={(e) => change(index, { text: e.currentTarget.value })}
            data-testid="qb-option"
          />
          {withPictures && <Picture value={option.image} label="Picture" onChange={(image) => change(index, { image })} />}
          <button
            type="button"
            class="icon-button"
            aria-label={`Remove ${withCorrect ? 'answer' : 'option'} ${index + 1}`}
            disabled={slide.options.length <= 2}
            onClick={() => set({ options: slide.options.filter((_, i) => i !== index) })}
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      ))}
      <div class="button-row">
        <button type="button" class="button button-small" disabled={slide.options.length >= max} onClick={() => set({ options: [...slide.options, { text: '' }] })} data-testid="qb-add-option">
          <Icon name="plus" size={13} /> Add
        </button>
      </div>
    </fieldset>
  );
}

function SlideForm({ slide, set }: { slide: Slide; set: (patch: Record<string, unknown>) => void }) {
  const quiz = isQuiz(slide.type);
  const rightCount = slide.options.filter((o) => o.correct).length;
  const timed = quiz || HIDEABLE.includes(slide.type);
  return (
    <div class="qb-form">
      {slide.type !== 'leaderboard' && (
        <Field label={slide.type === 'content' ? 'Heading' : quiz ? 'Question' : 'Question or prompt'} wide>
          <textarea class="input" rows={2} maxLength={300} value={slide.title} onInput={(e) => set({ title: e.currentTarget.value })} data-testid="qb-question" />
        </Field>
      )}
      {slide.type === 'leaderboard' && (
        <Field label="Heading" wide>
          <input class="input" maxLength={300} value={slide.title} onInput={(e) => set({ title: e.currentTarget.value })} data-testid="qb-question" />
        </Field>
      )}
      {slide.type !== 'leaderboard' && slide.type !== 'wheel' && (
        <div class="control">
          <span class="control-label">Picture</span>
          <Picture value={slide.image} label="Add a picture" onChange={(image) => set({ image })} testId="qb-picture" />
        </div>
      )}

      {slide.type === 'content' && (
        <Field label="Text" wide>
          <textarea class="input" rows={5} maxLength={3000} value={slide.text} onInput={(e) => set({ text: e.currentTarget.value })} data-testid="qb-text" />
        </Field>
      )}

      {slide.type === 'pick' && (
        <>
          <Options slide={slide} set={set} withCorrect withPictures max={8} />
          {rightCount > 1 && (
            <Check label="Part marks for some of the right answers" checked={slide.partial} onChange={(partial) => set({ partial })} testId="qb-partial" help="A wrong choice still earns nothing." />
          )}
          <Lines label="Hints (you choose when to show each)" noun="Hint" items={slide.hints} max={3} onChange={(hints) => set({ hints })} testId="qb-hint" />
        </>
      )}

      {slide.type === 'type' && (
        <Lines
          label="Right answers"
          noun="Answer"
          items={slide.accepted}
          max={20}
          min={1}
          onChange={(accepted) => set({ accepted })}
          testId="qb-accepted"
          help="The first one is shown as the answer; the others count as right too."
        />
      )}

      {slide.type === 'match' && (
        <fieldset class="qb-lines">
          <legend class="control-label">Pairs</legend>
          {slide.pairs.map((pair, index) => (
            <div class="qb-line" key={index}>
              <input
                class="input"
                value={pair.left}
                maxLength={120}
                aria-label={`Pair ${index + 1}, left`}
                onInput={(e) => set({ pairs: slide.pairs.map((p, i) => (i === index ? { ...p, left: e.currentTarget.value } : p)) })}
                data-testid="qb-left"
              />
              <span aria-hidden="true">→</span>
              <input
                class="input"
                value={pair.right}
                maxLength={120}
                aria-label={`Pair ${index + 1}, right`}
                onInput={(e) => set({ pairs: slide.pairs.map((p, i) => (i === index ? { ...p, right: e.currentTarget.value } : p)) })}
                data-testid="qb-right"
              />
              <button
                type="button"
                class="icon-button"
                aria-label={`Remove pair ${index + 1}`}
                disabled={slide.pairs.length <= 2}
                onClick={() => set({ pairs: slide.pairs.filter((_, i) => i !== index) })}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <div class="button-row">
            <button type="button" class="button button-small" disabled={slide.pairs.length >= 8} onClick={() => set({ pairs: [...slide.pairs, { left: '', right: '' }] })}>
              <Icon name="plus" size={13} /> Add
            </button>
          </div>
        </fieldset>
      )}

      {slide.type === 'order' && <Lines label="Items, in the right order" noun="Item" items={slide.items} max={10} min={2} onChange={(items) => set({ items })} testId="qb-item" />}

      {slide.type === 'categorise' && (
        <fieldset class="qb-lines">
          <legend class="control-label">Categories and the items that belong to each</legend>
          <div class="qb-categories">
            {slide.categories.map((category, index) => (
              <div class="qb-category" key={index}>
                <input
                  class="input"
                  value={category.name}
                  maxLength={60}
                  aria-label={`Category ${index + 1}`}
                  onInput={(e) => set({ categories: slide.categories.map((c, i) => (i === index ? { ...c, name: e.currentTarget.value } : c)) })}
                  data-testid="qb-category"
                />
                <textarea
                  class="input"
                  rows={4}
                  value={category.items.join('\n')}
                  aria-label={`Items of category ${index + 1}, one on each line`}
                  placeholder="One item on each line"
                  onInput={(e) => set({ categories: slide.categories.map((c, i) => (i === index ? { ...c, items: e.currentTarget.value.split('\n').slice(0, 10) } : c)) })}
                  data-testid="qb-category-items"
                />
                <button
                  type="button"
                  class="button button-small button-quiet"
                  disabled={slide.categories.length <= 2}
                  onClick={() => set({ categories: slide.categories.filter((_, i) => i !== index) })}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div class="button-row">
            <button
              type="button"
              class="button button-small"
              disabled={slide.categories.length >= 4}
              onClick={() => set({ categories: [...slide.categories, { name: `Group ${slide.categories.length + 1}`, items: [] }] })}
            >
              <Icon name="plus" size={13} /> Add a category
            </button>
          </div>
        </fieldset>
      )}

      {(slide.type === 'match' || slide.type === 'categorise') && (
        <Check label="Part marks for a partly right answer" checked={slide.partial} onChange={(partial) => set({ partial })} testId="qb-partial" />
      )}

      {slide.type === 'poll' && (
        <>
          <Options slide={slide} set={set} withCorrect={false} withPictures max={12} />
          <div class="control-row">
            <Check label="People may choose several" checked={slide.multiple} onChange={(multiple) => set({ multiple })} testId="qb-multiple" />
            <Field label="Shown as" help={slide.options.length > 6 && slide.chart !== 'bar' ? 'A ring or a pie reads well up to six options; with more, bars are shown.' : undefined}>
              <select class="select" value={slide.chart} onChange={(e) => set({ chart: e.currentTarget.value })} data-testid="qb-chart">
                <option value="bar">Bars</option>
                <option value="donut">Ring</option>
                <option value="pie">Pie</option>
              </select>
            </Field>
          </div>
        </>
      )}

      {slide.type === 'ranking' && <Options slide={slide} set={set} withCorrect={false} withPictures={false} max={12} />}

      {slide.type === 'cloud' && <Whole label="Words each person may send" value={slide.entries} min={1} max={10} onChange={(entries) => set({ entries })} testId="qb-entries" />}
      {slide.type === 'brainstorm' && <Whole label="Votes each person has" value={slide.entries} min={1} max={10} onChange={(entries) => set({ entries })} testId="qb-entries" />}

      {slide.type === 'scale' && (
        <>
          <Lines label="Statements to rate" noun="Statement" items={slide.statements} max={8} min={1} onChange={(statements) => set({ statements })} testId="qb-statement" />
          <div class="control-row">
            <Whole label="From" value={slide.low} min={0} max={9} onChange={(low) => set({ low, high: Math.max(slide.high, low + 1) })} testId="qb-low" />
            <Whole label="To" value={slide.high} min={slide.low + 1} max={10} onChange={(high) => set({ high })} testId="qb-high" />
            <Field label="Lowest means">
              <input class="input" maxLength={40} value={slide.lowLabel} onInput={(e) => set({ lowLabel: e.currentTarget.value })} />
            </Field>
            <Field label="Highest means">
              <input class="input" maxLength={40} value={slide.highLabel} onInput={(e) => set({ highLabel: e.currentTarget.value })} />
            </Field>
          </div>
        </>
      )}

      {slide.type === 'wheel' && (
        <>
          <Check label="Use the names of the people who joined" checked={slide.useNames} onChange={(useNames) => set({ useNames })} testId="qb-use-names" />
          {!slide.useNames && (
            <Field label="Entries, one on each line" wide>
              <textarea class="input" rows={6} value={slide.wheel.join('\n')} onInput={(e) => set({ wheel: e.currentTarget.value.split('\n').slice(0, 60) })} data-testid="qb-wheel" />
            </Field>
          )}
        </>
      )}

      {HIDEABLE.includes(slide.type) && (
        <Check
          label="Keep the results off the big screen until answering has ended"
          checked={slide.hide}
          onChange={(hide) => set({ hide })}
          testId="qb-hide"
          help="So that nobody is swayed by what the others chose. The results are shown when you end the answering, or when the time is up."
        />
      )}

      {timed && (
        <div class="control-row qb-timing">
          <Whole
            label={quiz ? 'Seconds to answer' : 'Seconds to answer (0 for no limit)'}
            value={slide.seconds}
            min={quiz ? 5 : 0}
            max={1200}
            onChange={(seconds) => set({ seconds })}
            testId="qb-seconds"
          />
          {quiz && (
            <>
              <Whole
                label="Points for a right answer"
                value={slide.points.max}
                min={1}
                max={1000}
                onChange={(max) => set({ points: { ...slide.points, max, min: Math.min(slide.points.min, max) } })}
                testId="qb-points"
              />
              <Check label="Faster answers earn more" checked={slide.points.speed} onChange={(speed) => set({ points: { ...slide.points, speed } })} testId="qb-speed" />
              {slide.points.speed && (
                <Whole label="Points at the last moment" value={slide.points.min} min={0} max={slide.points.max} onChange={(min) => set({ points: { ...slide.points, min } })} testId="qb-points-min" />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsForm({ settings, set }: { settings: Settings; set: (patch: Partial<Settings>) => void }) {
  return (
    <details class="qb-settings" data-testid="qb-settings">
      <summary>Settings for the whole quiz</summary>
      <div class="qb-settings-body">
        <div class="qb-settings-group">
          <Check
            label="Everyone goes at their own pace"
            checked={settings.selfPaced}
            onChange={(selfPaced) => set({ selfPaced })}
            testId="qb-self-paced"
            help="People move through the questions by themselves and see each result at once. Q&A, brainstorm, wheel and leaderboard slides are passed over."
          />
          <Check label="Play in teams" checked={settings.teams} onChange={(teams) => set({ teams })} testId="qb-teams" />
          {settings.teams && (
            <>
              <Field label="Team names, one on each line (2 to 12)">
                <textarea
                  class="input"
                  rows={3}
                  value={settings.teamNames.join('\n')}
                  onChange={(e) => {
                    const names = e.currentTarget.value
                      .split('\n')
                      .map((name) => name.trim())
                      .filter(Boolean)
                      .slice(0, 12);
                    if (names.length >= 2) set({ teamNames: names });
                    else e.currentTarget.value = settings.teamNames.join('\n');
                  }}
                  data-testid="qb-team-names"
                />
              </Field>
              <Field label="A team's score is">
                <select class="select" value={settings.teamRule} onChange={(e) => set({ teamRule: e.currentTarget.value as Settings['teamRule'] })} data-testid="qb-team-rule">
                  <option value="average">the average of its members</option>
                  <option value="total">the total of its members</option>
                  <option value="best">its best member's score</option>
                </select>
              </Field>
            </>
          )}
        </div>
        <div class="qb-settings-group">
          <Whole label="Countdown before each quiz question (seconds, 0 for none)" value={settings.countdown} min={0} max={30} onChange={(countdown) => set({ countdown })} testId="qb-countdown" />
          <Check label="Shuffle the answers for each person" checked={settings.shuffle} onChange={(shuffle) => set({ shuffle })} testId="qb-shuffle" />
          <Check
            label="I show the right answers myself"
            checked={settings.manualReveal}
            onChange={(manualReveal) => set({ manualReveal })}
            testId="qb-manual"
            help="Otherwise they are shown as soon as the time is up or everyone has answered."
          />
        </div>
        <div class="qb-settings-group">
          <Check label="People pick a face to go with their name" checked={settings.avatars} onChange={(avatars) => set({ avatars })} testId="qb-avatars" />
          <Check label="People can chat while they wait for the start" checked={settings.chat} onChange={(chat) => set({ chat })} testId="qb-chat" />
          <Check label="Sounds on the big screen" checked={settings.sounds} onChange={(sounds) => set({ sounds })} testId="qb-sounds" />
          <Field label="Words to star out in names and in what people write, one on each line">
            <textarea
              class="input"
              rows={3}
              value={settings.hidden.join('\n')}
              onChange={(e) =>
                set({
                  hidden: e.currentTarget.value
                    .split('\n')
                    .map((word) => word.trim())
                    .filter(Boolean)
                    .slice(0, 200),
                })
              }
              data-testid="qb-hidden"
            />
          </Field>
        </div>
      </div>
    </details>
  );
}

export function QuizBuilder({ deck, chosen, onChoose, onChange }: { deck: Deck; chosen: number; onChoose: (index: number) => void; onChange: (deck: Deck) => void }) {
  const slide = deck.slides[chosen];
  const setSlides = (slides: readonly Slide[], choose = chosen) => {
    onChange({ ...deck, slides });
    onChoose(Math.min(Math.max(choose, 0), Math.max(slides.length - 1, 0)));
  };
  const setSlide = (patch: Record<string, unknown>) => {
    if (!slide) return;
    // Through the same door as a slide read from a file, so that limits hold whatever is typed.
    const next = readSlide({ ...slide, ...patch });
    if (next) onChange({ ...deck, slides: deck.slides.map((old, i) => (i === chosen ? next : old)) });
  };
  const add = (key: string) => {
    const kind = KINDS.flatMap((group) => group.items).find((item) => item.key === key);
    if (!kind || deck.slides.length >= 200) return;
    const at = deck.slides.length === 0 ? 0 : chosen + 1;
    setSlides([...deck.slides.slice(0, at), kind.make(), ...deck.slides.slice(at)], at);
  };
  const move = (step: number) => {
    const to = chosen + step;
    if (!slide || to < 0 || to >= deck.slides.length) return;
    const slides = [...deck.slides];
    slides[chosen] = slides[to] as Slide;
    slides[to] = slide;
    setSlides(slides, to);
  };
  const found = slide ? problems(slide) : [];

  return (
    <div class="qb" data-testid="qb">
      <div class="qb-side">
        <div class="qb-scroll" {...scrollRegion('Slides')}>
          <ol class="qb-list" data-testid="qb-list">
            {deck.slides.map((item, index) => {
              const wrong = problems(item).length > 0;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    class={`qb-slide${index === chosen ? ' is-chosen' : ''}`}
                    aria-current={index === chosen ? 'true' : undefined}
                    onClick={() => onChoose(index)}
                    data-testid="qb-slide"
                  >
                    <span class="qb-number">{index + 1}</span>
                    <span class="qb-slide-text">
                      <span class="qb-slide-kind">{SLIDE_NAMES[item.type]}</span>
                      <span class="qb-slide-title">{item.title.trim() || 'No heading yet'}</span>
                    </span>
                    {wrong && (
                      <span class="qb-slide-wrong" title="This slide is not ready">
                        <Icon name="alert" size={14} />
                        <span class="visually-hidden">Not ready</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <div class="qb-add">
          <label class="control">
            <span class="control-label">Add a slide</span>
            <select
              class="select"
              value=""
              onChange={(e) => {
                add(e.currentTarget.value);
                e.currentTarget.value = '';
              }}
              data-testid="qb-add"
            >
              <option value="">Choose a kind…</option>
              {KINDS.map((group) => (
                <optgroup key={group.group} label={group.group}>
                  {group.items.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div class="qb-main">
        {slide ? (
          <>
            <div class="qb-head">
              <h3 class="qb-kind" data-testid="qb-kind">
                {chosen + 1}. {SLIDE_NAMES[slide.type]}
              </h3>
              <span class="button-row">
                <button type="button" class="icon-button" aria-label="Move this slide up" disabled={chosen === 0} onClick={() => move(-1)} data-testid="qb-up">
                  <Icon name="up" size={15} />
                </button>
                <button type="button" class="icon-button" aria-label="Move this slide down" disabled={chosen >= deck.slides.length - 1} onClick={() => move(1)} data-testid="qb-down">
                  <Icon name="down" size={15} />
                </button>
                <button
                  type="button"
                  class="button button-small"
                  disabled={deck.slides.length >= 200}
                  onClick={() => {
                    const copy = readSlide({ ...slide, id: undefined });
                    if (copy) setSlides([...deck.slides.slice(0, chosen + 1), copy, ...deck.slides.slice(chosen + 1)], chosen + 1);
                  }}
                  data-testid="qb-duplicate"
                >
                  <Icon name="copy" size={13} /> Duplicate
                </button>
                <button
                  type="button"
                  class="button button-small button-danger"
                  onClick={() =>
                    setSlides(
                      deck.slides.filter((_, i) => i !== chosen),
                      Math.max(0, chosen - 1),
                    )
                  }
                  data-testid="qb-delete"
                >
                  <Icon name="trash" size={13} /> Delete
                </button>
              </span>
            </div>
            <p class="control-help qb-about">{ABOUT[slide.type]}</p>
            {found.length > 0 && (
              <ul class="qb-problems" data-testid="qb-problems">
                {found.map((problem) => (
                  <li key={problem}>
                    <Icon name="alert" size={14} /> {problem}
                  </li>
                ))}
              </ul>
            )}
            <SlideForm key={slide.id} slide={slide} set={setSlide} />
          </>
        ) : (
          <p class="qb-empty">This quiz has no slides yet. Add one from the list on the left, import questions from a table, or load the sample.</p>
        )}
        <SettingsForm settings={deck.settings} set={(patch) => onChange({ ...deck, settings: readSettings({ ...deck.settings, ...patch }) })} />
      </div>
    </div>
  );
}
