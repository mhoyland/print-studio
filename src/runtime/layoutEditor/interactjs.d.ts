// interactjs ships type declarations only for its bare package specifier ('interactjs'), and those
// declarations reference an internal sub-package (@interactjs/interactjs) that isn't published/installed
// separately — resolving them fails. Importing via this exact JS subpath (which webpack already resolves
// to at runtime via the package's "main" field) sidesteps the broken types entirely, and this file
// provides a minimal, hand-verified declaration for just the API surface this widget uses (cross-checked
// against the separately-installed @interactjs/types package, which is intact).
declare module 'interactjs/dist/interact.min.js' {
  export interface FullRect {
    top: number
    left: number
    bottom: number
    right: number
    width: number
    height: number
  }

  export interface InteractEvent {
    target: HTMLElement
    dx: number
    dy: number
    rect: FullRect
    deltaRect?: FullRect
  }

  export interface RestrictModifier {
    // opaque — only ever passed through to Interactable.draggable/resizable's `modifiers` array
  }

  export interface ModifiersStatic {
    restrictRect: (options: { restriction: string }) => RestrictModifier
    restrictEdges: (options: { outer: string }) => RestrictModifier
    restrictSize: (options: { min?: { width: number; height: number } }) => RestrictModifier
  }

  export interface DraggableOptions {
    listeners?: {
      start?: (event: InteractEvent) => void
      move?: (event: InteractEvent) => void
      end?: (event: InteractEvent) => void
    }
    modifiers?: RestrictModifier[]
  }

  export interface ResizableOptions {
    edges?: { top?: boolean; left?: boolean; bottom?: boolean; right?: boolean }
    margin?: number
    listeners?: {
      start?: (event: InteractEvent) => void
      move?: (event: InteractEvent) => void
      end?: (event: InteractEvent) => void
    }
    modifiers?: RestrictModifier[]
  }

  export interface Interactable {
    draggable: (options: DraggableOptions) => Interactable
    resizable: (options: ResizableOptions) => Interactable
    unset: () => void
  }

  export interface InteractStatic {
    (target: Element): Interactable
    modifiers: ModifiersStatic
  }

  const interact: InteractStatic
  export default interact
}
