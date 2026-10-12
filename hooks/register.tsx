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
// Clawd's own seven cells and the pan's three, a space between.
const MASCOT_WIDTH = 11
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

// Clawd in two rows: his face drawn on his orange body, a paw each side (down
// at his middle, or up beside his face) and two stubby legs that step.
const LEGS = ['▜▀▀▀▛', '▀▜▀▛▀']
const FACE_COLOR = 'black'
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

// One frame of a loop, `every` ticks to a frame.
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
  const ms = tick * TICK_MS
  return YOLKS.find(([from]) => ms >= from)![1]
}

type Arm = 'down' | 'up'

// His face, five cells: eyes either side of his mouth, shut while he blinks.
// `glance` looks left or right by moving it a cell.
export function face(isBlinking: boolean, eyes = '•', mouth = 'ω', glance: -1 | 0 | 1 = 0) {
  const e = isBlinking ? '-' : eyes
  const look = `${e}${mouth}${e}`
  if (glance === -1) return `${look}  `
  if (glance === 1) return `  ${look}`
  return ` ${look} `
}

// His two rows: a paw, his face and a paw, then his paws' lower halves around
// his legs. A raised paw is drawn up beside his face.
export function figure(look: string, left: Arm, right: Arm, isStepping = false) {
  const paws = { left: left === 'up' ? '\\' : ' ', right: right === 'up' ? '/' : ' ' }
  const body = `${left === 'up' ? ' ' : '▀'}${LEGS[isStepping ? 1 : 0]}${right === 'up' ? ' ' : '▀'}`

  return { ...paws, face: look, head: `${paws.left}${look}${paws.right}`, body }
}

export function mascot(state: {
  isWorking: boolean; tick: number; isBlinking: boolean; served: Served | null; doing?: Doing
}) {
  const { isWorking, tick, isBlinking, served, doing } = state
  const smile = face(isBlinking)
  if (isWorking) {
    // Surprised as the egg drops in.
    if (tick < CRACK_TICKS) return { ...figure(face(isBlinking, '•', 'o'), 'down', 'up'), steam: ' o ', mark: 'claude', pan: PAN }
    const pan = `\\${yolk(tick)}/`
    switch (doing?.activity) {
      // Mulling it over, eyes small: thought dots rise from the pan.
      case 'thinking':
        return { ...figure(face(isBlinking, '·'), 'down', 'down'), steam: frame(tick, 3, ['   ', '·  ', '·· ', '···']), mark: 'claude', pan }
      // The recipe held up and read across.
      case 'reading':
        return { ...figure(smile, 'down', 'up'), steam: frame(tick, 3, ['≡  ', ' ≡ ', '  ≡', ' ≡ ']), mark: 'suggestion', pan }
      // Running on the spot by a shell prompt, its cursor blinking.
      case 'running':
        return {
          ...figure(' >ω< ', 'up', 'down', frame(tick, 2, [false, true])),
          steam: frame(tick, 3, ['>_ ', '>  ']), mark: 'success', pan,
        }
      case 'browsing':
        return { ...figure(smile, 'down', 'up'), steam: ` ${frame(tick, 2, GLOBE)} `, mark: 'ide', pan }
      // Tapping his feet and glancing about while other cooks work, how many
      // beside the spinner.
      case 'delegating':
      case 'waiting': {
        const glance = frame(tick, 6, [0, -1, 0, 1] as const)
        return {
          ...figure(face(isBlinking, '•', 'ω', glance), 'down', 'down', frame(tick, 3, [false, true])),
          steam: `${frame(tick, 1, SPIN)}${count(doing.agents)}`, mark: 'merged', pan,
        }
      }
      // Both paws up: he needs an answer.
      case 'asking':
        return { ...figure(face(isBlinking, '•', 'o'), 'up', 'up'), steam: frame(tick, 3, [' ! ', '   ']), mark: 'warning', pan }
    }
    // One paw up, then the other: the flip.
    const isLeft = Math.floor(tick / 2) % 2 === 0

    return { ...figure(smile, isLeft ? 'up' : 'down', isLeft ? 'down' : 'up'), steam: SIZZLE[tick % SIZZLE.length]!, mark: 'claude', pan }
  }

  // Beaming with the egg held up, or sorry it was cut short.
  if (served !== null) {
    const isDone = served.mark === '✓'
    const look = isDone ? face(false, '^') : face(isBlinking, ';')
    return {
      ...figure(look, 'down', isDone ? 'up' : 'down'),
      steam: ` ${served.mark} `, mark: isDone ? 'success' : 'error', pan: `\\${served.yolk}/`,
    }
  }

  return { ...figure(smile, 'down', 'down'), steam: '   ', mark: 'claude', pan: PAN }
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
let shown = JSON.stringify(IDLE)

function tickOn($: EngineInterface) {
  isAnimating = true
  animation = $.clock.every(TICK_MS, () => void update($, tick, n => (n ?? 0) + 1).catch(() => {}))
}

// A fresh egg each turn: the count starts over and the last one is cleared.
async function animate($: EngineInterface) {
  animation?.cancel()
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
    await show($)
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
    await animate($)
    await publish($)
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
    await countAgents($).catch(() => publish($))
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
    const hasCaption = hasMascot && columns >= CAPTION_MIN_COLUMNS
    const room = width - FRAME - (hasMascot ? MASCOT_WIDTH + GAP : 0) - (hasCaption ? CAPTION_WIDTH + GAP : 0)
    const rows = groups.map(group => fit(group, room)).filter(row => row.length > 0)
    if (rows.length === 0) return engine

    const { Box, Text } = $.ui.resolve(e)
    const doing = await read($, busy)
    const isWorking = e.props.isWorking || doing.isBusy
    const clawd = hasMascot
      ? mascot({
          isWorking,
          tick: await read($, tick),
          isBlinking: await read($, blinking),
          served: await read($, plated),
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
                <Text color="claude">{clawd.left}</Text>
                <Text color={FACE_COLOR} backgroundColor="claude">{clawd.face}</Text>
                <Text color="claude">{clawd.right}</Text>
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
