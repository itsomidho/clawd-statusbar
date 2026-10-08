export type Part = { kind: string; text: string }
// The egg Clawd holds up as a turn ends: done (✓) or cut short (x), and how set.
export type Served = { mark: string; yolk: string }

declare module 'claude-code' {
  interface PluginState {
    'clawd-statusbar': {
      groups: Part[][]
      // The mascot's animation frame, and whether it has its eyes shut.
      tick: number
      isBlinking: boolean
      served: Served | null
    }
  }
}
