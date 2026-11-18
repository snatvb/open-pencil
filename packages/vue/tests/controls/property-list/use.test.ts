import { afterEach, describe, expect, test } from 'bun:test'

import { defineComponent, h, reactive } from 'vue'

import { createDefaultEditorState, createEditor, type Editor } from '@open-pencil/core'
import { SceneGraph, type Effect } from '@open-pencil/scene-graph'
import { reconcileVariableBindings } from '@open-pencil/scene-graph/variables'
import { createTestRenderer, hostNode } from '@open-pencil/test-support/vue/renderer'
import { useEditorPropertyList } from '@open-pencil/vue/controls/property-list'

import { provideEditor } from '#vue/editor/context'

let editor: Editor
let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  editor.dispose()
})

const SHADOW: Effect = {
  type: 'DROP_SHADOW',
  color: { r: 0, g: 0, b: 0, a: 1 },
  offset: { x: 0, y: 0 },
  radius: 0,
  spread: 0,
  visible: true,
  blendMode: 'NORMAL',
  showShadowBehindNode: false
}

/** The Effects list of a selected layer with two shadows bound to Size: twice it, then once. */
function mountEffects() {
  const graph = new SceneGraph()
  graph.addCollection({
    id: 'theme',
    name: 'Theme',
    modes: [{ modeId: 'base', name: 'Base' }],
    defaultModeId: 'base',
    variableIds: []
  })
  graph.addVariable({
    id: 'size',
    name: 'Size',
    type: 'FLOAT',
    collectionId: 'theme',
    valuesByMode: { base: 4 },
    description: '',
    hiddenFromPublishing: false
  })
  editor = createEditor({
    graph,
    state: reactive(createDefaultEditorState(graph.getPages()[0].id))
  })
  const layer = graph.createNode('RECTANGLE', editor.state.currentPageId, {
    effects: [SHADOW, SHADOW],
    boundVariables: { 'effects/0/radius': 'size', 'effects/1/radius': 'size' },
    variableBindingScales: { 'effects/0/radius': 2 }
  })
  reconcileVariableBindings(graph)
  editor.select([layer.id])
  let list: ReturnType<typeof useEditorPropertyList<'effects'>> | undefined
  const Control = defineComponent({
    setup() {
      list = useEditorPropertyList('effects')
      return () => h('div')
    }
  })
  const app = createTestRenderer().createApp(
    defineComponent({
      setup() {
        provideEditor(editor)
        return () => h(Control)
      }
    })
  )
  app.mount(hostNode())
  unmount = () => app.unmount()
  if (!list) throw new Error('Expected the Effects list')
  const resolvedRadii = () => {
    reconcileVariableBindings(graph)
    return (graph.getNode(layer.id)?.effects ?? []).map((effect) => effect.radius)
  }
  return { list, resolvedRadii }
}

describe('the Effects list', () => {
  test('a removed shadow takes its binding constant with it', () => {
    const { list, resolvedRadii } = mountEffects()
    expect(resolvedRadii()).toEqual([8, 4])

    list.actions.remove(0)

    expect(resolvedRadii()).toEqual([4])
  })

  test('a moved shadow keeps its binding constant', () => {
    const { list, resolvedRadii } = mountEffects()

    list.actions.reorder(0, 1)

    expect(resolvedRadii()).toEqual([4, 8])
  })
})
