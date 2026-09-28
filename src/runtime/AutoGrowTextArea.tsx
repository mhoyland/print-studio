import { React } from 'jimu-core'
import { TextArea, type TextAreaProps } from 'jimu-ui'

// A TextArea that grows with its text: one line high when short, up to `maxLines` lines as text wraps
// or new lines are added, then scrolls. Used for the runtime text inputs (editable title, notes...),
// so long text is readable without the box pushing the Print button off the panel.

const MIN_HEIGHT = 34 // one line, the height these inputs had before
const DEFAULT_MAX_LINES = 3

interface AutoGrowTextAreaProps extends Omit<TextAreaProps, 'height'> {
  maxLines?: number
}

const AutoGrowTextArea = (props: AutoGrowTextAreaProps): React.ReactElement => {
  const { maxLines = DEFAULT_MAX_LINES, ...textAreaProps } = props
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const [height, setHeight] = React.useState(MIN_HEIGHT)

  const measure = React.useCallback((): void => {
    const element = ref.current
    if (!element) return
    const style = window.getComputedStyle(element)
    const fontSize = parseFloat(style.fontSize) || 14
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.5 // 'normal' parses as NaN
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
    const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    // Collapse the box for a moment to read how tall its content is (scrollHeight includes padding,
    // not border). A height the viewer set by dragging the resize handle is an inline style: it is put
    // back afterwards and, being inline, keeps winning over the height set here.
    const draggedHeight = element.style.height
    element.style.height = '0px'
    const contentHeight = element.scrollHeight + border
    element.style.height = draggedHeight
    const maxHeight = Math.ceil(lineHeight * maxLines + padding + border)
    setHeight(Math.max(MIN_HEIGHT, Math.min(maxHeight, Math.ceil(contentHeight))))
  }, [maxLines])

  // Re-measure whenever the text changes, before paint so the box never flickers.
  React.useLayoutEffect(measure, [measure, textAreaProps.value])

  // Wrapping depends on the width, so also re-measure when the panel is resized.
  React.useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    let lastWidth = element.clientWidth
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === lastWidth) return
      lastWidth = element.clientWidth
      measure()
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [measure])

  return <TextArea {...textAreaProps} ref={ref as unknown as React.Ref<HTMLInputElement>} height={height} />
}

export default AutoGrowTextArea
