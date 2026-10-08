import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Served } from '../types'

// The script ships with the plugin and is the one place the figures live;
// `parts` hands them over plain, one per line, in reading order.
const SCRIPT = 'scripts/statusline.sh'
const REFRESH_MS = 5000
const COMMAND = 'statusbar'
const SEP = ' · '
// The row's own cells: the engine's two-column indent at the left and the room
// it keeps at the right. Filling past these is what `truncate-end` cuts.
const INDENT = 2
const TRAIL = 4
// The frame's two columns of border and two of padding, inside that width.
const FRAME = 4
const FALLBACK_COLUMNS = 80

// Clawd, the creature on Claude Code's welcome screen, at the right of the
// frame, frying an egg through each turn: he cracks it into the pan, flips it
// while it sizzles, the yolk setting as the turn runs long, and holds it up
// done when the turn ends (`x` if it was cut short). Between turns the pan is
// empty and he only blinks. Two rows, the frame's own height.
const TICK_MS = 150
const BLINK_EVERY_MS = 4500
const BLINK_MS = 160
const SERVED_MS = 2000
// The egg falls into the pan for the first ticks of a turn.
const CRACK_TICKS = 4
const SIZZLE = ['~·~', '·~·', '~ ~', ' ~ ']
// How set the yolk is, by the turn's length so far: runny, then set, then hard.
const YOLKS: readonly (readonly [number, string])[] = [[30_000, '●'], [10_000, '◉'], [0, 'o']]
// Clawd's own nine cells and the pan's three, a space between.
const MASCOT_WIDTH = 13
const GAP = 2
// Below this the figures need the room more than he does.
const MASCOT_MIN_COLUMNS = 72

const BODY = '▝▜█████▛▘'
const PAN = '\\_/'

export function yolk(tick: number) {
  const ms = tick * TICK_MS
  return YOLKS.find(([from]) => ms >= from)![1]
}

export function mascot(state: { isWorking: boolean; tick: number; isBlinking: boolean; served: Served | null }) {
  const { isWorking, tick, isBlinking, served } = state
  const eyes = isBlinking ? '█████' : '▛███▜'
  if (isWorking) {
    if (tick < CRACK_TICKS) {
      return { head: ` ▐${eyes}▌▗`, body: BODY, steam: ' o ', mark: 'claude', pan: PAN }
    }
    // An arm up on one side, then the other: the flip.
    const isLeft = Math.floor(tick / 2) % 2 === 0
    const head = isLeft ? `▖▐${eyes}▌ ` : ` ▐${eyes}▌▗`

    return { head, body: BODY, steam: SIZZLE[tick % SIZZLE.length]!, mark: 'claude', pan: `\\${yolk(tick)}/` }
  }

  if (served !== null) {
    const mark = served.mark === '✓' ? 'success' : 'error'
    return { head: ` ▐${eyes}▌▗`, body: BODY, steam: ` ${served.mark} `, mark, pan: `\\${served.yolk}/` }
  }

  return { head: ` ▐${eyes}▌ `, body: BODY, steam: '   ', mark: 'claude', pan: PAN }
}

// One group per line of the section: the figures, then the project.
const bar = atom({ plugin: 'clawd-statusbar', key: 'groups' } as const, [])
const tick = atom({ plugin: 'clawd-statusbar', key: 'tick' } as const, 0)
const blinking = atom({ plugin: 'clawd-statusbar', key: 'isBlinking' } as const, false)
const plated = atom({ plugin: 'clawd-statusbar', key: 'served' } as const, null)

// What each kind of part is drawn in, so a line of several reads as several:
// the path, the branch and the change count do not run together. A kind with
// no colour here is dim, as the separators are.
const COLORS: Record<string, string> = {
  model: 'cyan', path: 'blue', branch: 'magenta', dirty: 'yellow', sync: 'green',
  worktree: 'cyan', alert: 'red', error: 'red',
  'review-ok': 'green', 'review-fail': 'red', 'review-run': 'yellow',
}

let isOff = false
// The person's settings (the manifest's userConfig), read as the module loads.
let config = { sites: '', hasMascot: true }
// The running turn's animation; a reload drops it with the old module.
let animation: { cancel: () => void } | undefined
let servings = 0

// A fresh egg each turn: the count starts over and the last one is cleared.
async function animate($: EngineInterface) {
  animation?.cancel()
  await update($, tick, () => 0)
  await update($, plated, () => null)
  animation = $.clock.every(TICK_MS, () => void update($, tick, n => (n ?? 0) + 1).catch(() => {}))
}

// The egg held up as the turn ends, then put away.
async function serve($: EngineInterface, isDone: boolean) {
  animation?.cancel()
  animation = undefined
  const serving = ++servings
  const egg = { mark: isDone ? '✓' : 'x', yolk: yolk(await read($, tick)) }
  await update($, plated, () => egg)
  // Put away unless a later turn has served its own since.
  $.clock.after(SERVED_MS, () => {
    if (serving === servings) void update($, plated, () => null).catch(() => {})
  })
}

async function refresh($: EngineInterface) {
  const [usage, model, cwd, root] = await Promise.all([
    $.session.usage(), $.session.model(), $.session.cwd(), $.session.root(),
  ])
  const now = await $.clock.now()
  const rate: Record<string, unknown> = {}
  for (const r of usage.rateLimits) {
    rate[r.kind] = {
      used_percentage: r.percentUsed,
      resets_at: r.resetsAt ? Math.floor(Date.parse(r.resetsAt) / 1000) : undefined,
    }
  }
  const input = {
    model: { display_name: model },
    workspace: { current_dir: cwd, project_dir: root },
    cost: { total_duration_ms: now - usage.startedAt, total_cost_usd: usage.cost?.usd },
    context_window: {
      used_percentage: usage.context.percent,
      total_input_tokens: usage.context.tokens,
      context_window_size: usage.context.window,
    },
    rate_limits: rate,
  }
  const run = await $.process.run(['bash', `${$.plugin.root}/${SCRIPT}`], {
    stdin: JSON.stringify(input),
    env: { STATUSLINE_LAYOUT: 'parts', STATUSLINE_SITES: config.sites },
    timeoutMs: 4000,
  })
  // Each line is `kind<TAB>text`; a line without a tab is its own text, dim.
  const groups = run.stdout
    .split('\n\n')
    .map(group => group.split('\n').filter(one => one.trim() !== '').map(one => {
      const at = one.indexOf('\t')

      return at === -1 ? { kind: '', text: one } : { kind: one.slice(0, at), text: one.slice(at + 1) }
    }))
    .filter(group => group.length > 0)
  if (groups.length === 0) throw new Error(`statusline.sh wrote nothing (exit ${run.exitCode})`)
  // /statusbar may have turned it off while the script ran.
  if (isOff) return
  await update($, bar, () => groups)
}

// A silent failure leaves the row empty with nothing to go on, so the reason
// takes its place.
async function show($: EngineInterface) {
  if (isOff) return
  try {
    await refresh($)
  } catch (thrown) {
    const why = thrown instanceof Error ? thrown.message : String(thrown)
    if (!isOff) await update($, bar, () => [[{ kind: 'error', text: `status bar: ${why}` }]])
  }
}

// As many parts as the line holds, in order; one that overflows is skipped, not
// a full stop, so a shorter one behind it still shows.
export function fit<T extends { text: string }>(all: readonly T[], room: number) {
  const kept: T[] = []
  let used = 0
  for (const part of all) {
    const width = [...part.text].length + (kept.length === 0 ? 0 : SEP.length)
    if (used + width <= room) {
      kept.push(part)
      used += width
    }
  }

  return kept
}

export const register: Register = (on, options) => {
  config = {
    sites: typeof options.localSites === 'string' ? options.localSites : '',
    hasMascot: options.mascot !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Turn the status line under the prompt off and on',
    })
    // An earlier build of this plugin pinned a $.ui.status line; the engine
    // keeps one across a reload, so it goes here.
    $.ui.status(undefined)
    await show($)
    // A tick that lands while the session is going away is nobody's error.
    $.clock.every(REFRESH_MS, () => void show($).catch(() => {}))
    $.clock.every(BLINK_EVERY_MS, () => {
      if (animation !== undefined) return
      void update($, blinking, () => true)
        .then(() => $.clock.after(BLINK_MS, () => void update($, blinking, () => false).catch(() => {})))
        .catch(() => {})
    })

    return next(e)
  })

  // The main loop's turns; a subagent's run raises no turn.start.
  on('turn.start', async ($, e, next) => {
    await animate($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await serve($, e.reason === 'answer')
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    isOff = !isOff
    if (isOff) {
      await update($, bar, () => [])
      return { text: 'Status line off. /statusbar brings it back.' }
    }

    await show($)
    return { text: 'Status line on, under the prompt.' }
  }).catch(() => ({ text: 'The status line could not be switched; see the debug log.' }))

  // The engine's line first, so this row falls under the footer: the last row
  // inside the box.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const groups = await read($, bar)
    const engine = await next(e)
    if (groups.length === 0) return engine

    const columns = e.viewport?.columns ?? FALLBACK_COLUMNS
    const width = columns - INDENT - TRAIL
    const hasMascot = config.hasMascot && columns >= MASCOT_MIN_COLUMNS
    const room = width - FRAME - (hasMascot ? MASCOT_WIDTH + GAP : 0)
    const rows = groups.map(group => fit(group, room)).filter(row => row.length > 0)
    if (rows.length === 0) return engine

    const { Box, Text } = $.ui.resolve(e)
    const clawd = hasMascot
      ? mascot({
          isWorking: e.props.isWorking,
          tick: await read($, tick),
          isBlinking: await read($, blinking),
          served: await read($, plated),
        })
      : undefined
    return (
      <Box flexDirection="column">
        {engine}
        <Box borderStyle="round" borderDimColor paddingX={1} width={width} flexDirection="row">
          <Box flexDirection="column" flexGrow={1}>
            {rows.map((row, i) => (
              <Text key={`row${i}`} wrap="truncate-end">
                {row.flatMap((part, j) => {
                  const text = (
                    <Text key={`p${i}-${j}`} color={COLORS[part.kind]} dimColor={COLORS[part.kind] === undefined}>
                      {part.text}
                    </Text>
                  )

                  return j === 0
                    ? [text]
                    : [<Text key={`s${i}-${j}`} dimColor>{SEP}</Text>, text]
                })}
              </Text>
            ))}
          </Box>
          {clawd && (
            <Box flexDirection="column" marginLeft={GAP} flexShrink={0}>
              <Text>
                <Text color="claude">{clawd.head}</Text>
                <Text color={clawd.mark}>{' ' + clawd.steam}</Text>
              </Text>
              <Text>
                <Text color="claude">{clawd.body}</Text>
                <Text dimColor>{' ' + clawd.pan[0]}</Text>
                <Text color="yellow">{clawd.pan[1]}</Text>
                <Text dimColor>{clawd.pan[2]}</Text>
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
