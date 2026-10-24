import { expect, test } from 'bun:test'

import { createDefaultNode } from '@open-pencil/scene-graph'

import { pastedReferences } from '#core/editor/clipboard/paste/references'

test('a stale override key that matches an id the paste made gives way to the copied layer', () => {
  const instance = createDefaultNode(() => 'copied-instance', 'INSTANCE')
  instance.instanceOverrides.descendants.set('copied-layer', new Map([['visible', false]]))
  instance.instanceOverrides.descendants.set('pasted-layer', new Map([['opacity', 0.5]]))
  const copiedIds = new Map([
    ['copied-instance', 'pasted-instance'],
    ['copied-layer', 'pasted-layer']
  ])

  const { instanceOverrides } = pastedReferences(instance, copiedIds)

  expect([...(instanceOverrides?.descendants ?? [])]).toEqual([
    ['pasted-layer', new Map([['visible', false]])]
  ])
})
