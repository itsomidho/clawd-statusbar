import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { activityOf, blocks, caption, doingOf, figure, fit, mascot, yolk } from './register'

const BRANCH = '⎇ feature/checkout/fix-z-index-of-navbar-and-the-cart-drawer-overlap'
const FIGURES = [
  'model\t◆ Opus 5', 'figure\tCTX 24%', 'figure\t5h 20%', 'figure\t7d 3%',
  'figure\t⏱ 1h 20m', 'figure\tCPU 36%', 'figure\tRAM 83%',
]
const PROJECT = [`path\t~/Documents/Projects/acme/shop-frontend`, `branch\t${BRANCH}`, 'dirty\t●4']
const OUT = `${FIGURES.join('\n')}\n\n${PROJECT.join('\n')}\n`
const parts = (tagged: string[]) => tagged.map(one => ({ kind: one.split('\t')[0]!, text: one.split('\t')[1]! }))
const HINT = '? for shortcuts'
const COMMAND = {
  command: 'statusbar', args: '',
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: true, columns: 90 },
}

// The session's agents as $.agent.list answers them; a test fills it.
let agents: { id: string; description: string; type: string; status: 'running' | 'completed' }[] = []

// Stands in for the engine under the plugin: every $ call session.start makes.
function engine(on: On, ran: Record<string, string>[]) {
  agents = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1_760_000_742_000 }))
  on('clock.every', () => ({ value: undefined }))
  // The egg is put away after a wait the tests never reach; a blink's ends at once.
  on('clock.after', (_$, e) => e.ms >= 2000 ? new Promise(() => {}) : { value: undefined })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.model', () => ({ value: 'claude-opus-5' }))
  on('session.cwd', () => ({ value: '/home/dev/Documents/Projects' }))
  on('session.root', () => ({ value: '/home/dev/Documents/Projects' }))
  on('session.usage', () => ({
    value: {
      startedAt: 1_760_000_000_000,
      context: { window: 200_000, percent: 24 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 20 }],
    },
  }))
  on('process.run', (_$, e) => {
    ran.push({ ...e.init?.env, argv: e.argv.join(' ') })
    return {
      value: {
        exitCode: 0, stdout: OUT, stderr: '',
        isStdoutTruncated: false, isStderrTruncated: false,
      },
    }
  })
  on('agent.list', () => ({ value: agents }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'Text', props: { dimColor: true }, children: [HINT] }))
}

function footer($: Engine, columns = 90, isWorking = false) {
  return $.ui.mount({
    plugin: 'clawd-statusbar', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking, hint: HINT },
    viewport: { columns, rows: 22, isFullscreen: true },
  })
}

async function start($: Engine, on: On, ran: Record<string, string>[] = []) {
  engine(on, ran)
  await $.session.start({ cwd: '/home/dev/Documents/Projects', surface: 'terminal', isInteractive: true })
  // The first figures come in the background, so the session is not held for them.
  for (let i = 0; i < 1000 && ran.length === 0; i++) await Promise.resolve()
  for (let i = 0; i < 100; i++) await Promise.resolve()
}

test('fit joins in order and skips a part that overflows', () => {
  const text = (all: { text: string }[]) => all.map(one => one.text).join(' · ')
  const three = [{ text: 'CTX 24%' }, { text: 'a very long part indeed' }, { text: 'CPU 8%' }]

  expect(text(fit([{ text: 'CTX 24%' }, { text: '5h 20%' }], 16))).toBe('CTX 24% · 5h 20%')
  expect(text(fit([{ text: 'CTX 24%' }, { text: '5h 20%' }], 15))).toBe('CTX 24%')
  expect(text(fit(three, 18))).toBe('CTX 24% · CPU 8%')
  expect(fit(parts(FIGURES), 2)).toEqual([])
})

test('session.start reads the parts layout', async ($, on) => {
  const ran: Record<string, string>[] = []
  await start($, on, ran)

  expect(ran[0]?.STATUSLINE_LAYOUT).toBe('parts')
})

test('the section is two framed rows under the engine line', async ($, on) => {
  await start($, on)

  const ui = await footer($, 160)
  const drawn = await ui.drawn()
  const children = (drawn as { children: unknown[] }).children

  expect(children).toHaveLength(2)
  expect(JSON.stringify(children[0])).toContain(HINT)
  expect(JSON.stringify(children[1])).toContain('"borderStyle":"round"')
  expect(JSON.stringify(children[1])).toContain('"dimColor":true')

  // The figures first, the project under them.
  const figures = (await ui.find({ type: 'Text', text: /◆/ }))?.text ?? ''
  const project = (await ui.find({ type: 'Text', text: /^~/ }))?.text ?? ''
  expect(figures).toBe('◆ Opus 5 · CTX 24% · 5h 20% · 7d 3% · ⏱ 1h 20m · CPU 36% · RAM 83%')
  expect(project).toContain('~/Documents/Projects/acme/shop-frontend')
  expect(project).toContain('feature/checkout')

  // Each field of the project line is its own colour, so they do not run together.
  const row = JSON.stringify((await ui.drawn() as { children: unknown[] }).children[1])
  expect(row).toContain('{"color":"blue","dimColor":false},"children":["~/Documents')
  expect(row).toContain('{"color":"magenta","dimColor":false},"children":["⎇ feature')
  expect(row).toContain('{"color":"yellow","dimColor":false},"children":["●4"]')
  expect(row).toContain('{"color":"cyan","dimColor":false},"children":["◆ Opus 5"]')
  await ui.unmount()
})

test('a narrow row keeps the head of each line and drops the rest', async ($, on) => {
  await start($, on)

  const ui = await footer($, 46)
  const row = JSON.stringify(await ui.drawn())

  expect(row).toContain('◆ Opus 5')
  expect(row).not.toContain('RAM 83%')
  await ui.unmount()
})

test('a branch too long for the row is dropped whole, never cut', async ($, on) => {
  await start($, on)

  const ui = await footer($, 90)
  const project = (await ui.find({ type: 'Text', text: /^~/ }))?.text ?? ''

  expect(project).toBe('~/Documents/Projects/acme/shop-frontend · ●4')
  await ui.unmount()
})

test('the line stays inside the row, indent and right margin counted', async ($, on) => {
  await start($, on)

  const ui = await footer($, 90)
  const line = (await ui.find({ type: 'Text', text: /◆/ }))?.text ?? ''

  // Inside the frame: the row less its indent, right margin, border and
  // padding, the mascot and the caption, each with the gap before it.
  expect([...line].length).toBeLessThanOrEqual(90 - 2 - 4 - 4 - 14 - 2 - 8 - 2)
  expect(line).not.toBe('')
  await ui.unmount()
})

test('/statusbar takes the line away and brings it back', async ($, on) => {
  await start($, on)

  const off = await $.command.run(COMMAND)
  const bare = JSON.stringify(await (await footer($)).drawn())
  const back = await $.command.run(COMMAND)
  const again = JSON.stringify(await (await footer($)).drawn())

  expect(off.text).toContain('off')
  expect(bare).not.toContain('CTX 24%')
  expect(back.text).toContain('on')
  expect(again).toContain('CTX 24%')
})

// Ten cells and two rows of him, then the three cells beside: every pose
// the same size, so the figures never move.
function expectSize(one: ReturnType<typeof mascot>) {
  for (const row of [one.head, one.body]) expect([...row].length).toBe(10)
  for (const beside of [one.steam, one.pan]) expect([...beside].length).toBe(3)
}

const pose = (over: Partial<Parameters<typeof mascot>[0]> = {}) =>
  mascot({ isWorking: false, tick: 0, isBlinking: false, served: null, ...over })

test('between turns the pan is empty and Clawd stands as in the picture', () => {
  expect(pose()).toEqual({
    head: '  █▜██▛█  ', body: ' ▀██████▀ ', steam: '   ', mark: 'claude', pan: '\\_/', isHot: false,
  })
})

test('his two rows are the picture\'s grid, pixel for pixel', () => {
  expect(blocks([
    '....############....',
    '.#..##.######.##..#.',
    '..################..',
    '....############....',
  ])).toEqual(['▗ █▜██▛█ ▖', ' ▀██████▀ '])
})

test('a turn cracks the egg in, then fries it with the yolk setting', () => {
  // The egg drops in first, the pan still empty.
  expect(pose({ isWorking: true, tick: 0 })).toMatchObject({ steam: ' o ', pan: '\\_/' })
  // Then it cooks on the heat, steam rising off it.
  const frying = [4, 6, 8, 10].map(tick => pose({ isWorking: true, tick }))
  expect(frying.every(one => one.pan === '\\o/' && one.steam.includes('~') && one.isHot)).toBe(true)
  expect(new Set(frying.map(one => one.head)).size).toBe(2)
  expect(new Set(frying.map(one => one.steam)).size).toBeGreaterThan(1)
  // Runny, set, then hard as the turn runs on.
  expect(yolk(0)).toBe('o')
  // The first beats past 10 and 30 seconds (a tick is 150 ms).
  expect(yolk(66)).toBe('o')
  expect(yolk(68)).toBe('◉')
  expect(yolk(200)).toBe('●')
})

test('the turn ends with the egg held up, done or cut short', () => {
  expect(pose({ served: { mark: '✓', yolk: '◉' } })).toMatchObject({ steam: ' ✓ ', mark: 'success', pan: '\\◉/' })
  expect(pose({ served: { mark: 'x', yolk: 'o' } })).toMatchObject({ steam: ' x ', mark: 'error' })
})

test('every pose keeps his width, so the figures never move', () => {
  const all = [
    pose(), pose({ isBlinking: true }), pose({ served: { mark: '✓', yolk: '●' } }),
    ...[0, 3, 4, 5, 70, 250].map(tick => pose({ isWorking: true, tick })),
  ]
  for (const one of all) expectSize(one)
})

test('a blink shuts his eyes', () => {
  expect(pose({ isBlinking: true }).head).toBe('  ██████  ')
})

test('all he does while Claude works is shake his fingers, one hand then the other', () => {
  const kinds = ['thinking', 'reading', 'editing', 'running', 'browsing', 'delegating', 'waiting', 'asking', 'working']
  for (const activity of kinds) {
    const at = (tick: number) =>
      pose({ isWorking: true, tick, doing: { activity, tool: '', agents: 1, isBusy: true } })
    // The left hand's finger up, then the right's; his arms and eyes stay put.
    expect(at(8)).toMatchObject({ head: '▗ █▜██▛█  ', body: ' ▀██████▀ ' })
    expect(at(12)).toMatchObject({ head: '  █▜██▛█ ▖', body: ' ▀██████▀ ' })
  }
  // The same as the egg drops in.
  expect(pose({ isWorking: true, tick: 0 })).toMatchObject({ head: '▗ █▜██▛█  ', steam: ' o ' })
})

test('he stands still by the egg when the turn ends, fingers down', () => {
  expect(pose({ served: { mark: '✓', yolk: '●' } })).toMatchObject({ head: '  █▜██▛█  ', body: ' ▀██████▀ ', steam: ' ✓ ' })
  expect(pose({ served: { mark: 'x', yolk: 'o' } })).toMatchObject({ head: '  █▜██▛█  ', body: ' ▀██████▀ ', steam: ' x ' })
})

test('a finger shows just above the tip of each hand', () => {
  expect(figure('open', 'left')).toEqual({ head: '▗ █▜██▛█  ', body: ' ▀██████▀ ' })
  expect(figure('open', 'right')).toEqual({ head: '  █▜██▛█ ▖', body: ' ▀██████▀ ' })
  expect(figure('open', 'both')).toEqual({ head: '▗ █▜██▛█ ▖', body: ' ▀██████▀ ' })
  expect(figure('open')).toEqual({ head: '  █▜██▛█  ', body: ' ▀██████▀ ' })
})

test('Clawd sits at the right of the frame, frying while a turn runs', async ($, on) => {
  await start($, on)

  const idle = JSON.stringify(await (await footer($, 120)).drawn())
  const busy = JSON.stringify(await (await footer($, 120, true)).drawn())

  expect(idle).toContain(' ▀██████▀ ')
  expect(idle).toContain('"color":"claude"')
  expect(idle).not.toMatch(/~ ~|~°~|°~°/)
  // Two rows of him while a turn runs, his body over the pan.
  expect(busy).toMatch(/"children":\[" ▀██████▀ "\]/)
  expect(busy).toMatch(/ o |~ ~|~°~| ~ |°~°/)
  // The pan glows red while it is on the heat.
  expect(busy).toContain('"color":"red"')
  expect(idle).not.toContain('"color":"red"')
})

test('a narrow row gives his room to the figures', async ($, on) => {
  await start($, on)

  const row = JSON.stringify(await (await footer($, 60)).drawn())

  expect(row).not.toContain('██████')
  expect(row).toContain('◆ Opus 5')
})

test('the script is the one shipped in the plugin', async ($, on) => {
  const ran: Record<string, string>[] = []
  await start($, on, ran)

  expect(ran[0]?.argv).toMatch(/^bash \/.+\/scripts\/statusline\.sh$/)
})

test('Clawd can be turned off', { options: { mascot: false } }, async ($, on) => {
  await start($, on)

  const row = JSON.stringify(await (await footer($, 120)).drawn())

  expect(row).not.toContain('██████')
  expect(row).toContain('◆ Opus 5')
})

const IDLE = { activity: 'idle', tool: '', agents: 0, isBusy: false }

test('each tool has Clawd doing its own thing', () => {
  expect(activityOf('Read')).toBe('reading')
  expect(activityOf('Edit')).toBe('editing')
  expect(activityOf('Bash')).toBe('running')
  expect(activityOf('WebFetch')).toBe('browsing')
  expect(activityOf('mcp__claude-in-chrome__navigate')).toBe('browsing')
  expect(activityOf('Agent')).toBe('delegating')
  expect(activityOf('AskUserQuestion')).toBe('asking')
  expect(activityOf('mcp__GitKraken__git_status')).toBe('working')
})

test('a background agent keeps him busy after the main turn ends', () => {
  const none = new Map<string, string[]>()

  expect(doingOf(false, [], none, 'main')).toEqual(IDLE)
  expect(doingOf(true, [], none, 'main')).toMatchObject({ activity: 'thinking', isBusy: true })
  // The main loop idle, one agent left running: he waits on it.
  expect(doingOf(false, ['a1'], none, 'main')).toEqual({ activity: 'waiting', tool: '', agents: 1, isBusy: true })
  // And shows what that agent is doing.
  const tools = new Map([['a1', ['Grep']], ['main', ['Bash']]])
  expect(doingOf(false, ['a1'], tools, 'a1')).toMatchObject({ activity: 'reading', tool: 'Grep', agents: 1 })
  // The main loop's work comes first while it runs.
  expect(doingOf(true, ['a1'], tools, 'a1')).toMatchObject({ activity: 'running', tool: 'Bash' })
})

test('the caption names the work, then the agents or the tool', () => {
  expect(caption(IDLE)).toEqual(['', ''])
  expect(caption({ activity: 'running', tool: 'Bash', agents: 0, isBusy: true })).toEqual(['running', 'Bash'])
  expect(caption({ activity: 'waiting', tool: '', agents: 2, isBusy: true })).toEqual(['waiting', '2 agents'])
  expect(caption({ activity: 'browsing', tool: 'mcp__claude-in-chrome__navigate', agents: 0, isBusy: true }))
    .toEqual(['browsing', 'navigate'])
})

test('every activity keeps his width', () => {
  const kinds = ['thinking', 'reading', 'editing', 'running', 'browsing', 'delegating', 'waiting', 'asking', 'working']
  for (const activity of kinds) {
    for (const agents of [0, 3, 12]) {
      for (const tick of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
        const one = pose({ isWorking: true, tick, doing: { activity, tool: '', agents, isBusy: true } })
        expectSize(one)
      }
    }
  }
})

test('steam rises over the hot pan whatever the work, the word beside him in its colour', () => {
  const kinds = ['thinking', 'reading', 'editing', 'running', 'browsing', 'delegating', 'waiting', 'asking', 'working']
  for (const activity of kinds) {
    const steam = [8, 10, 12, 14].map(tick =>
      pose({ isWorking: true, tick, doing: { activity, tool: '', agents: 2, isBusy: true } }))
    expect(steam.every(one => one.isHot && /^[~° ]{3}$/.test(one.steam))).toBe(true)
    expect(new Set(steam.map(one => one.steam)).size).toBe(4)
  }
  expect(pose({ isWorking: true, tick: 8, doing: { activity: 'waiting', tool: '', agents: 2, isBusy: true } }).mark)
    .toBe('merged')
  // Off the heat between turns and once the egg is served.
  expect(pose({ served: { mark: '✓', yolk: '●' } }).isHot).toBe(false)
})

test('Clawd keeps working while a background agent runs', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  agents = [{ id: 'a1', description: 'Rename helper', type: 'wp-developer', status: 'running' }]
  await $.turn.complete({ answer: 'started', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })

  // The prompt says the main loop is idle; he still works, waiting on the agent.
  const busy = JSON.stringify(await (await footer($, 120, false)).drawn())
  expect(busy).toContain('waiting')
  expect(busy).toContain('1 agent')
  expect(busy).not.toContain(' ✓ ')

  // The agent finishes: the egg is served.
  agents = [{ id: 'a1', description: 'Rename helper', type: 'wp-developer', status: 'completed' }]
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 'a', reason: 'answer', agentId: 'a1' })
  const done = JSON.stringify(await (await footer($, 120, false)).drawn())
  expect(done).toContain(' ✓ ')
  expect(done).not.toContain('waiting')
})

test('his poses change on a beat of two ticks, never on the odd ones', () => {
  const kinds = ['thinking', 'reading', 'editing', 'running', 'browsing', 'delegating', 'waiting', 'asking', 'working']
  for (const activity of kinds) {
    const at = (tick: number) =>
      JSON.stringify(pose({ isWorking: true, tick, doing: { activity, tool: '', agents: 2, isBusy: true } }))
    // From the crack on, an odd tick looks just like the even one before it.
    for (let tick = 5; tick < 300; tick += 2) expect(at(tick)).toBe(at(tick - 1))
  }
})
