import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doing, Served } from '../types'

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
// The word for what he is doing, left of him, and under it the tool or how many
// agents run; on a row this wide or wider, so the figures keep their room.
const CAPTION_WIDTH = 8
const CAPTION_MIN_COLUMNS = 84
// How often the session's agents are counted: a background agent runs with no
// turn of the main loop, so the prompt's own `isWorking` says nothing of it.
const AGENTS_EVERY_MS = 1000
// The main loop's key among the loops' tools in flight.
const MAIN = 'main'

const PAN = '\\_/'
const SPIN = ['◜', '◝', '◞', '◟']
const GLOBE = ['◐', '◓', '◑', '◒']

// What each tool has him doing; a tool not named here is plain cooking.
const ACTIVITIES: Record<string, string> = {
  Read: 'reading', Grep: 'reading', Glob: 'reading', LS: 'reading', LSP: 'reading',
  NotebookRead: 'reading', ToolSearch: 'reading', ListMcpResourcesTool: 'reading', ReadMcpResourceTool: 'reading',
  Edit: 'editing', MultiEdit: 'editing', Write: 'editing', NotebookEdit: 'editing',
  Bash: 'running', PowerShell: 'running', Monitor: 'running',
  WebFetch: 'browsing', WebSearch: 'browsing',
  Agent: 'delegating', Task: 'delegating', SendMessage: 'delegating',
  AskUserQuestion: 'asking', ExitPlanMode: 'asking',
}
const BROWSER = /^mcp__.*(chrome|devtools|browser|playwright)/i
const CAPTIONS: Record<string, string> = {
  thinking: 'thinking', reading: 'reading', editing: 'editing', running: 'running',
  browsing: 'browsing', delegating: 'spawning', asking: 'asking', waiting: 'waiting', working: 'cooking',
}
const IDLE: Doing = { activity: 'idle', tool: '', agents: 0, isBusy: false }

export function activityOf(tool: string) {
  return ACTIVITIES[tool] ?? (BROWSER.test(tool) ? 'browsing' : 'working')
}

// One frame of a loop, `every` ticks to a frame. Every loop steps on a beat of
// two ticks (or four), so his poses change together and the bar is redrawn at
// most every other tick: a tick that changes nothing draws nothing.
function frame<T>(tick: number, every: number, frames: readonly T[]) {
  return frames[Math.floor(tick / every) % frames.length]!
}

// How many agents run, in the two cells after the spinner.
function count(agents: number) {
  if (agents === 0) return '  '
  return agents > 9 ? '9+' : `×${agents}`
}

// The two lines left of him: what he is doing, then the tool or the agents.
export function caption(doing: Doing): [string, string] {
  if (!doing.isBusy) return ['', '']
  const agents = doing.agents === 0 ? '' : `${doing.agents} agent${doing.agents === 1 ? '' : 's'}`
  const tool = doing.tool.split('__').pop() ?? ''
  const cut = (text: string) => [...text].slice(0, CAPTION_WIDTH).join('')

  return [cut(CAPTIONS[doing.activity] ?? ''), cut(agents || tool)]
}

export function yolk(tick: number) {
  // On the beat too: counted from the even tick.
  const ms = (tick - (tick % 2)) * TICK_MS
  return YOLKS.find(([from]) => ms >= from)![1]
}

// Clawd as on the welcome screen, pixel for pixel: a grid 17 wide and 5 tall,
// his body 13 wide with two eye holes, his arms out on the third row and four
// legs. Each text cell holds 2x2 of it in quarter blocks, so he is nine cells
// wide and three rows tall, the legs in the top half of the last.
const BODY = '..#############..'
const ARMS = '#################'
const QUARTERS = ' ▗▖▄▝▐▞▟▘▚▌▙▀▜▛█'
type Arm = 'down' | 'up'

// Where his eye holes are: open, shut, wide (two rows tall), glancing a step to
// either side, or cast down in his arms' row.
export const EYES = {
  open: { row: 1, at: [4, 12] }, shut: { row: 1, at: [] }, wide: { row: 0, at: [4, 12] },
  left: { row: 1, at: [3, 11] }, right: { row: 1, at: [5, 13] }, down: { row: 2, at: [4, 12] },
} as const
export type Eyes = keyof typeof EYES
const LEGS = [[2, 4, 12, 14], [3, 5, 11, 13]] as const

// A grid of '#' and '.' to three rows of quarter blocks.
export function blocks(grid: readonly string[]) {
  const at = (r: number, c: number) => (grid[r]?.[c] === '#' ? 1 : 0)
  return [0, 2, 4].map(r => {
    let row = ''
    for (let c = 0; c < 18; c += 2) {
      row += QUARTERS[at(r, c) * 8 + at(r, c + 1) * 4 + at(r + 1, c) * 2 + at(r + 1, c + 1)]
    }
    return row
  })
}

// His grid for a pose: the eyes cut out, a raised arm moved up a row, the legs
// standing or stepped out. Returns his three rows.
export function figure(eyes: Eyes, left: Arm, right: Arm, isStepping = false) {
  const rows = [BODY, BODY, ARMS, BODY, ''].map(row => [...row])
  const look = EYES[eyes]
  for (const c of look.at) {
    rows[look.row]![c] = '.'
    if (eyes === 'wide') rows[1]![c] = '.'
  }
  const raise = (from: number) => {
    rows[2]![from] = '.'; rows[2]![from + 1] = '.'
    rows[1]![from] = '#'; rows[1]![from + 1] = '#'
  }
  if (left === 'up') raise(0)
  if (right === 'up') raise(15)
  rows[4] = [...'.'.repeat(17)]
  for (const c of LEGS[isStepping ? 1 : 0]) rows[4]![c] = '#'
  const [head, body, legs] = blocks(rows.map(row => row.join('')))

  return { head: head!, body: body!, legs: legs! }
}

export function mascot(state: {
  isWorking: boolean; tick: number; isBlinking: boolean; served: Served | null; doing?: Doing
}) {
  const { isWorking, tick, isBlinking, served, doing } = state
  // Open, unless he is blinking.
  const eyes = (open: Eyes = 'open'): Eyes => (isBlinking ? 'shut' : open)
  const glance = () => eyes(frame(tick, 8, ['open', 'left', 'open', 'right'] as const))
  if (isWorking) {
    // Wide-eyed, an arm up, as the egg drops from above into the pan.
    if (tick < CRACK_TICKS) {
      const isHigh = tick < CRACK_TICKS / 2
      return { ...figure(eyes('wide'), 'down', 'up'), top: isHigh ? ' o ' : '   ', steam: isHigh ? '   ' : ' o ', mark: 'claude', pan: PAN }
    }
    const pan = `\\${yolk(tick)}/`
    const top = '   '
    switch (doing?.activity) {
      // Mulling it over, glancing about: thought dots rise from the pan.
      case 'thinking':
        return { ...figure(glance(), 'down', 'down'), top, steam: frame(tick, 4, ['   ', '·  ', '·· ', '···']), mark: 'claude', pan }
      // The recipe held up and read across.
      case 'reading':
        return { ...figure(eyes(), 'down', 'up'), top, steam: frame(tick, 4, ['≡  ', ' ≡ ', '  ≡', ' ≡ ']), mark: 'suggestion', pan }
      // Scuttling on the spot by a shell prompt, its cursor blinking.
      case 'running':
        return {
          ...figure(eyes(), 'up', 'down', frame(tick, 2, [false, true])),
          top, steam: frame(tick, 4, ['>_ ', '>  ']), mark: 'success', pan,
        }
      case 'browsing':
        return { ...figure(eyes(), 'down', 'up'), top, steam: ` ${frame(tick, 2, GLOBE)} `, mark: 'ide', pan }
      // Tapping his feet and glancing about while other cooks work, how many
      // beside the spinner.
      case 'delegating':
      case 'waiting':
        return {
          ...figure(glance(), 'down', 'down', frame(tick, 4, [false, true])),
          top, steam: `${frame(tick, 2, SPIN)}${count(doing.agents)}`, mark: 'merged', pan,
        }
      // Both arms up, eyes wide: he needs an answer.
      case 'asking':
        return { ...figure(eyes('wide'), 'up', 'up'), top, steam: frame(tick, 4, [' ! ', '   ']), mark: 'warning', pan }
    }
    // One arm up, then the other: the flip.
    const isLeft = Math.floor(tick / 4) % 2 === 0

    return { ...figure(eyes(), isLeft ? 'up' : 'down', isLeft ? 'down' : 'up'), top, steam: frame(tick, 2, SIZZLE), mark: 'claude', pan }
  }

  // The egg held up when the turn is done; eyes cast down when it was cut short.
  if (served !== null) {
    const isDone = served.mark === '✓'
    return {
      ...figure(isDone ? eyes() : 'down', 'down', isDone ? 'up' : 'down'),
      top: '   ', steam: ` ${served.mark} `, mark: isDone ? 'success' : 'error', pan: `\\${served.yolk}/`,
    }
  }

  return { ...figure(eyes(), 'down', 'down'), top: '   ', steam: '   ', mark: 'claude', pan: PAN }
}

// One group per line of the section: the figures, then the project.
const bar = atom({ plugin: 'clawd-statusbar', key: 'groups' } as const, [])
const tick = atom({ plugin: 'clawd-statusbar', key: 'tick' } as const, 0)
const blinking = atom({ plugin: 'clawd-statusbar', key: 'isBlinking' } as const, false)
const plated = atom({ plugin: 'clawd-statusbar', key: 'served' } as const, null)
const busy = atom({ plugin: 'clawd-statusbar', key: 'doing' } as const, IDLE)

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
let config = { hasMascot: true }
// The running turn's animation; a reload drops it with the old module.
let animation: { cancel: () => void } | undefined
let isAnimating = false
let servings = 0
// What runs: the main loop's turn, the agents the session counts as running,
// the tools in flight in each loop (newest last), and the loop that last
// started one. How the main turn ended is held until the agents are done too.
let isMainWorking = false
let agentIds: string[] = []
const inFlight = new Map<string, string[]>()
let lastLoop = MAIN
let isDone = true
let doingNow = IDLE
let shown = JSON.stringify(IDLE)
// The animation's own count, and the pose last drawn: a tick that would draw
// him the same as the last one writes nothing, so the bar is not redrawn.
let ticks = 0
let drawn = ''
// The bar's lines as last drawn, so a refresh that changed nothing redraws nothing.
let lines = ''

function poseOf(n: number) {
  const one = mascot({ isWorking: true, tick: n, isBlinking: false, served: null, doing: doingNow })
  return `${one.head}${one.body}${one.legs}${one.top}${one.steam}${one.pan}${one.mark}`
}

function tickOn($: EngineInterface) {
  isAnimating = true
  animation = $.clock.every(TICK_MS, () => {
    ticks += 1
    const pose = poseOf(ticks)
    if (pose === drawn) return
    drawn = pose
    const at = ticks
    void update($, tick, () => at).catch(() => {})
  })
}

// A fresh egg each turn: the count starts over and the last one is cleared.
async function animate($: EngineInterface) {
  animation?.cancel()
  ticks = 0
  drawn = poseOf(0)
  await update($, tick, () => 0)
  await update($, plated, () => null)
  tickOn($)
}

// What he shows, from what runs: the main loop's work first, else the agent
// that last started a tool. He keeps cooking while any agent runs, and holds
// the egg up only once the main turn and every agent are done.
export function doingOf(isMain: boolean, agents: readonly string[], tools: ReadonlyMap<string, readonly string[]>, last: string): Doing {
  const isBusy = isMain || agents.length > 0
  if (!isBusy) return IDLE
  const loop = isMain ? MAIN : agents.includes(last) ? last : agents[agents.length - 1]!
  const running = tools.get(loop) ?? []
  const tool = running[running.length - 1] ?? ''
  const activity = tool !== '' ? activityOf(tool) : isMain ? 'thinking' : 'waiting'

  return { activity, tool, agents: agents.length, isBusy }
}

async function publish($: EngineInterface) {
  const doing = doingOf(isMainWorking, agentIds, inFlight, lastLoop)
  doingNow = doing
  const key = JSON.stringify(doing)
  if (key !== shown) {
    shown = key
    await update($, busy, () => doing)
  }
  if (doing.isBusy && !isAnimating) tickOn($)
  if (!doing.isBusy && isAnimating) await serve($, isDone)
}

// The agents that still run; one that is gone takes its tools with it.
async function countAgents($: EngineInterface) {
  const all = await $.agent.list()
  agentIds = all.filter(one => one.status === 'running' || one.status === 'pending').map(one => one.id)
  for (const loop of inFlight.keys()) {
    if (loop !== MAIN && !agentIds.includes(loop)) inFlight.delete(loop)
  }
  await publish($)
}

// The egg held up as the turn ends, then put away.
async function serve($: EngineInterface, isDone: boolean) {
  animation?.cancel()
  animation = undefined
  isAnimating = false
  const serving = ++servings
  const egg = { mark: isDone ? '✓' : 'x', yolk: yolk(ticks) }
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
    env: { STATUSLINE_LAYOUT: 'parts' },
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
  const key = JSON.stringify(groups)
  if (key === lines) return
  lines = key
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
  config = { hasMascot: options.mascot !== false }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Turn the status line under the prompt off and on',
    })
    // An earlier build of this plugin pinned a $.ui.status line; the engine
    // keeps one across a reload, so it goes here.
    $.ui.status(undefined)
    // The first figures are drawn when the script answers; the session goes on.
    void show($).catch(() => {})
    // A tick that lands while the session is going away is nobody's error.
    $.clock.every(REFRESH_MS, () => void show($).catch(() => {}))
    $.clock.every(AGENTS_EVERY_MS, () => void countAgents($).catch(() => {}))
    $.clock.every(BLINK_EVERY_MS, () => {
      if (isAnimating) return
      void update($, blinking, () => true)
        .then(() => $.clock.after(BLINK_MS, () => void update($, blinking, () => false).catch(() => {})))
        .catch(() => {})
    })

    return next(e)
  })

  // The main loop's turns; a subagent's run raises no turn.start.
  on('turn.start', async ($, e, next) => {
    isMainWorking = true
    inFlight.delete(MAIN)
    // Set off the animation without holding the turn for it.
    void animate($).then(() => publish($)).catch(() => {})
    return next(e)
  })

  // The main turn ends, or an agent's run does; the egg is served once
  // nothing runs (publish).
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      isMainWorking = false
      isDone = e.reason === 'answer'
      inFlight.delete(MAIN)
    } else {
      agentIds = agentIds.filter(id => id !== e.agentId)
      inFlight.delete(e.agentId)
    }
    void countAgents($).catch(() => publish($)).catch(() => {})
    return next(e)
  })

  // Each tool call, the main loop's or an agent's, is what he does while it runs.
  on('tool.call', async ($, e, next) => {
    const loop = e.agentId ?? MAIN
    const tool = String(e.tool)
    inFlight.set(loop, [...(inFlight.get(loop) ?? []), tool])
    lastLoop = loop
    void publish($).catch(() => {})
    try {
      return await next(e)
    } finally {
      const tools = inFlight.get(loop)
      const at = tools?.lastIndexOf(tool) ?? -1
      if (tools && at !== -1) inFlight.set(loop, [...tools.slice(0, at), ...tools.slice(at + 1)])
      void publish($).catch(() => {})
    }
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async $ => {
    isOff = !isOff
    if (isOff) {
      lines = ''
      await update($, bar, () => [])
      return { text: 'Status line off. /statusbar brings it back.' }
    }

    await show($)
    return { text: 'Status line on, under the prompt.' }
  }).catch(() => ({ text: 'The status line could not be switched; see the debug log.' }))

  // The engine's line first, so this row falls under the footer: the last row
  // inside the box.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const columns = e.viewport?.columns ?? FALLBACK_COLUMNS
    const width = columns - INDENT - TRAIL
    const hasMascot = config.hasMascot && columns >= MASCOT_MIN_COLUMNS
    const hasCaption = hasMascot && columns >= CAPTION_MIN_COLUMNS
    // Each read is a trip to the host, so they go together, beside the engine's
    // own line; his frames are read only while he is drawn.
    const [groups, engine, doing, at, isBlinking, served] = await Promise.all([
      read($, bar), next(e), read($, busy),
      hasMascot ? read($, tick) : 0,
      hasMascot ? read($, blinking) : false,
      hasMascot ? read($, plated) : null,
    ])
    if (groups.length === 0) return engine

    const room = width - FRAME - (hasMascot ? MASCOT_WIDTH + GAP : 0) - (hasCaption ? CAPTION_WIDTH + GAP : 0)
    const rows = groups.map(group => fit(group, room)).filter(row => row.length > 0)
    if (rows.length === 0) return engine

    const { Box, Text } = $.ui.resolve(e)
    const isWorking = e.props.isWorking || doing.isBusy
    const clawd = hasMascot
      ? mascot({
          isWorking, tick: at, isBlinking, served,
          doing: e.props.isWorking && !doing.isBusy ? undefined : doing,
        })
      : undefined
    // A turn the module did not see start (it reloaded mid-turn) reads as cooking.
    const words = caption(doing.isBusy || !isWorking ? doing : { ...doing, activity: 'working', isBusy: true })
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
          {hasCaption && (
            <Box flexDirection="column" marginLeft={GAP} width={CAPTION_WIDTH} flexShrink={0} alignItems="flex-end">
              <Text color={clawd?.mark} wrap="truncate-end">{words[0] || ' '}</Text>
              <Text dimColor wrap="truncate-end">{words[1] || ' '}</Text>
            </Box>
          )}
          {clawd && (
            <Box flexDirection="column" marginLeft={GAP} flexShrink={0}>
              <Text>
                <Text color="claude">{clawd.head}</Text>
                <Text color={clawd.mark}>{' ' + clawd.top}</Text>
              </Text>
              <Text>
                <Text color="claude">{clawd.body}</Text>
                <Text color={clawd.mark}>{' ' + clawd.steam}</Text>
              </Text>
              <Text>
                <Text color="claude">{clawd.legs}</Text>
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
