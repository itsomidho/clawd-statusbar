import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { fit, mascot, yolk } from './register'

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

// Stands in for the engine under the plugin: every $ call session.start makes.
function engine(on: On, ran: Record<string, string>[]) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: 1_760_000_742_000 }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
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

  const ui = await footer($, 140)
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
  // padding, and the mascot with the gap before it.
  expect([...line].length).toBeLessThanOrEqual(90 - 2 - 4 - 4 - 13 - 2)
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

const pose = (over: Partial<Parameters<typeof mascot>[0]> = {}) =>
  mascot({ isWorking: false, tick: 0, isBlinking: false, served: null, ...over })

test('between turns the pan is empty and Clawd stands still', () => {
  expect(pose()).toEqual({ head: ' ▐▛███▜▌ ', body: '▝▜█████▛▘', steam: '   ', mark: 'claude', pan: '\\_/' })
})

test('a turn cracks the egg in, then fries it with the yolk setting', () => {
  // The egg falls first, the pan still empty.
  expect(pose({ isWorking: true, tick: 0 })).toMatchObject({ steam: ' o ', pan: '\\_/' })
  // Then it sizzles, flipped from one side and the other.
  const frying = [4, 5, 6, 7].map(tick => pose({ isWorking: true, tick }))
  expect(frying.every(one => one.pan === '\\o/' && one.steam.includes('~'))).toBe(true)
  expect(new Set(frying.map(one => one.head)).size).toBe(2)
  // Runny, set, then hard as the turn runs on.
  expect(yolk(0)).toBe('o')
  expect(yolk(10_000 / 150)).toBe('◉')
  expect(yolk(30_000 / 150)).toBe('●')
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
  for (const one of all) {
    expect([...one.head].length).toBe(9)
    expect([...`${one.body} ${one.pan}`].length).toBe(13)
    expect([...one.steam].length).toBe(3)
  }
})

test('a blink shuts his eyes', () => {
  expect(pose({ isBlinking: true }).head).toBe(' ▐█████▌ ')
})

test('Clawd sits at the right of the frame, frying while a turn runs', async ($, on) => {
  await start($, on)

  const idle = JSON.stringify(await (await footer($, 120)).drawn())
  const busy = JSON.stringify(await (await footer($, 120, true)).drawn())

  expect(idle).toContain('▝▜█████▛▘')
  expect(idle).toContain('"color":"claude"')
  expect(idle).not.toMatch(/~·~|·~·|~ ~/)
  expect(busy).toMatch(/▐(▛███▜|█████)▌/)
  expect(busy).toMatch(/ o |~·~|·~·|~ ~| ~ /)
})

test('a narrow row gives his room to the figures', async ($, on) => {
  await start($, on)

  const row = JSON.stringify(await (await footer($, 60)).drawn())

  expect(row).not.toContain('▝▜█████▛▘')
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

  expect(row).not.toContain('▝▜█████▛▘')
  expect(row).toContain('◆ Opus 5')
})
