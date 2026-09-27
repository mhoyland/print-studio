import { React } from 'jimu-core'

// Marks the one meaningful, consistent boundary every properties panel shares — where content/data
// fields end and styling begins (see ContainerStyleFields, and the extra Data → Table/Card style split
// in AttributeTableProps/PopupProps) — rather than being sprinkled before every subsection label, which
// would read as busy on the shorter panels (North Arrow, Scale Bar) that only have one or two sections.
const SectionDivider = (): React.ReactElement => (
  <div style={{ borderTop: '1px solid var(--sys-color-divider-primary)', margin: '12px 0' }} />
)

export default SectionDivider
