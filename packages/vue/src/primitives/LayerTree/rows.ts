import { computed, onScopeDispose, reactive, ref } from 'vue'

import type { Editor } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/scene-graph'

import { LAYER_OUTLINE_FIELDS } from '#vue/primitives/LayerTree/context'
import type { LayerNode } from '#vue/primitives/LayerTree/context'
import {
  buildLayerTreeModel,
  patchLayerNode,
  visibleLayerRows
} from '#vue/primitives/LayerTree/model'

const PATCHABLE_NODE_KEYS = new Set<keyof SceneNode>([
  'name',
  'type',
  'layoutMode',
  'visible',
  'locked',
  'variableModes',
  'isMask',
  'fills',
  'strokes',
  ...LAYER_OUTLINE_FIELDS
])

export function useLayerTreeRows(editor: Editor) {
  const items = ref<LayerNode[]>([])
  const expanded = ref<string[]>([])
  const treeVersion = ref(0)
  const visibleRows = computed(() => visibleLayerRows(items.value, new Set(expanded.value)))
  let nodesById = new Map<string, LayerNode>()

  let rebuildPending = false
  let rebuildToken = 0

  function rebuildTree() {
    rebuildPending = false
    rebuildToken++
    const model = buildLayerTreeModel(editor.graph, editor.state.currentPageId)
    items.value = model.items
    nodesById = model.byId
    expanded.value = expanded.value.filter((id) => nodesById.has(id))
    treeVersion.value++
  }

  function scheduleTreeRebuild() {
    if (rebuildPending) return
    rebuildPending = true
    const token = ++rebuildToken
    queueMicrotask(() => {
      if (!rebuildPending || token !== rebuildToken) return
      rebuildTree()
    })
  }

  function patchTreeNode(id: string, changes: Partial<SceneNode>) {
    // A layout mode turns a layer's rows between front-most first and flow order.
    const reordersRows = 'layoutMode' in changes && !!nodesById.get(id)?.children?.length
    if ('childIds' in changes || 'parentId' in changes || reordersRows) {
      rebuildTree()
      return
    }
    if (
      !(Object.keys(changes) as (keyof SceneNode)[]).some((key) => PATCHABLE_NODE_KEYS.has(key))
    ) {
      return
    }
    const target = nodesById.get(id)
    const source = editor.graph.getNode(id)
    // The index holds the plain rows; writing through their reactive proxy updates every view of
    // them, including values a row derives and caches, such as its variable mode tags.
    if (target && source) patchLayerNode(reactive(target), source)
  }

  function expandNode(id: string) {
    if (!expanded.value.includes(id)) expanded.value = [...expanded.value, id]
  }

  function collapseNode(id: string) {
    expanded.value = expanded.value.filter((expandedId) => expandedId !== id)
  }

  function expandSelectionAncestors(ids: readonly string[]) {
    const next = new Set(expanded.value)
    for (const id of ids) {
      let node = editor.graph.getNode(id)
      while (node?.parentId && node.parentId !== editor.state.currentPageId) {
        next.add(node.parentId)
        node = editor.graph.getNode(node.parentId)
      }
    }
    if (next.size !== expanded.value.length) expanded.value = [...next]
  }

  function childrenOf(node: LayerNode) {
    return node.children
  }

  rebuildTree()

  const unsubscribe = [
    editor.onEditorEvent('graph:replaced', rebuildTree),
    editor.onEditorEvent('page:changed', rebuildTree),
    editor.onEditorEvent('node:created', scheduleTreeRebuild),
    editor.onEditorEvent('node:deleted', scheduleTreeRebuild),
    editor.onEditorEvent('node:reparented', scheduleTreeRebuild),
    editor.onEditorEvent('node:reordered', scheduleTreeRebuild),
    editor.onEditorEvent('node:updated', patchTreeNode)
  ]

  onScopeDispose(() => {
    for (const stop of unsubscribe) stop()
  })

  return {
    items,
    expanded,
    treeVersion,
    visibleRows,
    childrenOf,
    expandNode,
    collapseNode,
    expandSelectionAncestors
  }
}
