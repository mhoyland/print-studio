import runtimeMessages from '../src/translations/default'
import settingMessages from '../src/setting/setting.messages'
import jimuCoreMessages from '../../../../dist/jimu-core/lib/translations/default'
import jimuUiMessages from '../../../../dist/jimu-ui/lib/translations/default'
import jimuForBuilderMessages from '../../../../dist/jimu-for-builder/lib/translations/default'

// Experience Builder's shared messages take precedence over a widget's own message with the same key,
// so a widget label under a shared key silently shows the framework's text instead (the Print button
// showed "Export" because of `export`). Keys that match a shared key must therefore have identical
// text; anything worded differently needs a Print Studio-specific key.
function clashes (widgetMessages: { [key: string]: string }, frameworkMessages: Array<{ [key: string]: string }>): string[] {
  return Object.entries(widgetMessages).flatMap(([key, text]) =>
    frameworkMessages
      .filter((messages) => key in messages && messages[key] !== text)
      .map((messages) => `${key}: "${text}" would show as "${messages[key]}"`)
  )
}

describe('translation keys', () => {
  it('runtime labels are not overridden by jimu-core or jimu-ui messages', () => {
    expect(clashes(runtimeMessages, [jimuCoreMessages, jimuUiMessages])).toEqual([])
  })

  it('setting labels are not overridden by jimu-core, jimu-ui or jimu-for-builder messages', () => {
    expect(clashes(settingMessages, [jimuCoreMessages, jimuUiMessages, jimuForBuilderMessages])).toEqual([])
  })
})
