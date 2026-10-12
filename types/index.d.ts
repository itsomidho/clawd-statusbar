export type Part = { kind: string; text: string }
// The egg Clawd holds up as a turn ends: done (✓) or cut short (x), and how set.
export type Served = { mark: string; yolk: string }
// What Claude is busy with, as Clawd shows it: the kind of work (`thinking`,
// `reading`, `waiting` on background agents, ...), the tool it is in ("" when
// none), how many agents are running, and whether anything runs at all.
export type Doing = { activity: string; tool: string; agents: number; isBusy: boolean }

declare module 'claude-code' {
  interface PluginState {
    'clawd-statusbar': {
      groups: Part[][]
      // The mascot's animation frame, and whether it has its eyes shut.
      tick: number
      isBlinking: boolean
      served: Served | null
      doing: Doing
    }
  }
}
