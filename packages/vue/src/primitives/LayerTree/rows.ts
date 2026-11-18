import { computed, onScopeDispose, reactive, ref, watch } from 'vue'

import type { Editor } from '@open-pencil/core'
import type { SceneNode } from '@open-pencil/scene-graph'

import { LAYER_OUTLINE_FIELDS } from '#vue/primitives/LayerTree/context'
import type { LayerNode } from '#vue/primitives/LayerTree/context'
import {
  createLayerTreeModel,
  listsChildren,
  patchLayerNode,
  visibleLayerRows
} from '#vue/primitives/LayerTree/model'
import type { LazyLayerTreeModel } from '#vue/primitives/LayerTree/model'

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
  let model: LazyLayerTreeModel = createLayerTreeModel(editor.graph, editor.state.currentPageId)
  const items = ref<LayerNode[]>(model.items)
  const expanded = ref<string[]>([])
  const treeVersion = ref(0)
  const hasChildren = (node: LayerNode) => model.hasChildren(node)
  const visibleRows = computed(() =>
    visibleLayerRows(items.value, new Set(expanded.value), hasChildren)
  )

  let rebuildPending = false
  let rebuildToken = 0

  function buildExpandedRows(ids: readonly string[]) {
    const expandedIds = new Set(ids)
    model.buildExpanded((id) => expandedIds.has(id))
  }

  function isOnCurrentPage(id: string) {
    const pageId = editor.state.currentPageId
    let node = editor.graph.getNode(id)
    while (node?.parentId) {
      if (node.parentId === pageId) {
        return true
      }
      node = editor.graph.getNode(node.parentId)
    }
    return false
  }

  function rebuildTree() {
    rebuildPending = false
    rebuildToken++
    model = createLayerTreeModel(editor.graph, editor.state.currentPageId)
    items.value = model.items
    expanded.value = expanded.value.filter(isOnCurrentPage)
    treeVersion.value++
  }

  function scheduleTreeRebuild() {
    if (rebuildPending) {
      return
    }
    rebuildPending = true
    const token = ++rebuildToken
    queueMicrotask(() => {
      if (!rebuildPending || token !== rebuildToken) {
        return
      }
      rebuildTree()
    })
  }

  function holdsRows(id: string | null | undefined) {
    return !!id && (id === editor.state.currentPageId || model.byId.has(id))
  }

  function togglesChildren(row: LayerNode) {
    const node = editor.graph.getNode(row.id)
    return !!node && listsChildren(editor.graph, node) !== model.hasChildren(row)
  }

  function changesListedChildren(id: string) {
    if (id === editor.state.currentPageId) {
      return true
    }
    const row = model.byId.get(id)
    return !!row && (!!row.children || togglesChildren(row))
  }

  function onNodeCreated(node: SceneNode) {
    const parent = node.parentId ? model.byId.get(node.parentId) : undefined
    const joinsUnbuiltRows = !!parent && !parent.children && model.hasChildren(parent)
    if (holdsRows(node.parentId) && !joinsUnbuiltRows) {
      scheduleTreeRebuild()
    }
  }

  function onNodeDeleted(_id: string, parentId: string | null | undefined) {
    if (holdsRows(parentId)) {
      scheduleTreeRebuild()
    }
  }

  function onNodeReparented(_id: string, oldParentId: string | null, newParentId: string) {
    if (holdsRows(oldParentId) || holdsRows(newParentId)) {
      scheduleTreeRebuild()
    }
  }

  function onNodeReordered(
    _id: string,
    parentId: string,
    _index: number,
    previousParentId?: string | null
  ) {
    if (holdsRows(parentId) || holdsRows(previousParentId)) {
      scheduleTreeRebuild()
    }
  }

  function patchTreeNode(id: string, changes: Partial<SceneNode>) {
    // A layout mode turns a layer's rows between front-most first and flow order.
    const reordersRows = 'layoutMode' in changes && !!model.byId.get(id)?.children?.length
    const restructures = 'childIds' in changes && changesListedChildren(id)
    const movesListedRow =
      'parentId' in changes && (model.byId.has(id) || holdsRows(changes.parentId))
    if (movesListedRow || restructures || reordersRows) {
      scheduleTreeRebuild()
      return
    }
    if (
      !(Object.keys(changes) as (keyof SceneNode)[]).some((key) => PATCHABLE_NODE_KEYS.has(key))
    ) {
      return
    }
    const target = model.byId.get(id)
    const source = editor.graph.getNode(id)
    // The index holds the plain rows; writing through their reactive proxy updates every view of
    // them, including values a row derives and caches, such as its variable mode tags.
    if (target && source) {
      patchLayerNode(reactive(target), source)
    }
  }

  function expandNode(id: string) {
    if (!expanded.value.includes(id)) {
      expanded.value = [...expanded.value, id]
    }
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
    if (next.size !== expanded.value.length) {
      expanded.value = [...next]
    }
  }

  function childrenOf(node: LayerNode): LayerNode[] | undefined {
    if (node.children) {
      return node.children
    }
    return model.hasChildren(node) ? [] : undefined
  }

  watch(expanded, buildExpandedRows, { flush: 'sync' })

  const unsubscribe = [
    editor.onEditorEvent('graph:replaced', rebuildTree),
    editor.onEditorEvent('page:changed', rebuildTree),
    editor.onEditorEvent('node:created', onNodeCreated),
    editor.onEditorEvent('node:deleted', onNodeDeleted),
    editor.onEditorEvent('node:reparented', onNodeReparented),
    editor.onEditorEvent('node:reordered', onNodeReordered),
    editor.onEditorEvent('node:updated', patchTreeNode)
  ]

  onScopeDispose(() => {
    for (const stop of unsubscribe) {
      stop()
    }
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
