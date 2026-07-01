declare module '@3d-dice/dice-box-threejs' {
  type DiceBoxConfig = {
    assetPath?: string
    sounds?: boolean
    volume?: number
    shadows?: boolean
    theme_surface?: string
    theme_colorset?: string
    theme_material?: string
    theme_customColorset?: unknown
    gravity_multiplier?: number
    light_intensity?: number
    baseScale?: number
    strength?: number
    onRollComplete?: (results: unknown) => void
  }

  export default class DiceBox {
    constructor(selector: string, config?: DiceBoxConfig)
    initialize(): Promise<void>
    init?: () => Promise<void>
    roll(notation: string): Promise<unknown>
    clearDice(): void
  }
}
