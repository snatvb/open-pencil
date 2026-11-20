<script setup lang="ts">
import { TreeRoot } from 'reka-ui'
import { computed, nextTick, onScopeDispose, ref } from 'vue'

import { useEditor } from '#vue/editor/context'
import { provideLayerTree } from '#vue/primitives/LayerTree/context'
import type {
  LayerNode,
  LayerSelectionMode,
  LayerTreeVirtualizer
} from '#vue/primitives/LayerTree/context'
import { layerSelectionForTarget } from '#vue/primitives/LayerTree/model'
import { useLayerTreeRows } from '#vue/primitives/LayerTree/rows'
import { useLayerDrag } from '#vue/primitives/LayerTree/useLayerDrag'

const { indentPerLevel = 16 } = defineProps<{
  indentPerLevel?: number
}>()

const emit = defineEmits<{
  select: [id: string, additive: boolean]
  toggleExpand: [id: string]
  toggleVisibility: [id: string]
  toggleLock: [id: string]
  rename: [id: string, name: string]
}>()

const editor = useEditor()
const {
  items,
  expanded,
  treeVersion,
  visibleRows,
  childrenOf,
  expandNode,
  collapseNode,
  expandSelectionAncestors
} = useLayerTreeRows(editor)
const selectedIds = computed(() => editor.state.selectedIds)
const focused = ref(false)
let virtualizer: LayerTreeVirtualizer | null = null
let selectionAnchorId: string | null = null
let applyingSelection = false

const { draggingId, instruction, instructionTargetId, setupItem } = useLayerDrag(
  editor,
  indentPerLevel,
  expandNode
)

const rowRefs = new Map<string, HTMLElement>()

function setRowRef(id: string, el: HTMLElement | null) {
  if (el) rowRefs.set(id, el)
  else rowRefs.delete(id)
}

function scrollToNode(id: string) {
  void nextTick(() => {
    const index = visibleRows.value.findIndex((row) => row.node.id === id)
    if (index !== -1 && virtualizer) {
      virtualizer.scrollToIndex(index, { align: 'auto' })
      return
    }
    rowRefs.get(id)?.scrollIntoView({ block: 'nearest' })
  })
}

function onSelectionChanged(ids: string[]) {
  expandSelectionAncestors(ids)
  if (applyingSelection) return
  const visibleIds = new Set(visibleRows.value.map((row) => row.node.id))
  selectionAnchorId = ids.find((id) => visibleIds.has(id)) ?? null
  if (selectionAnchorId) scrollToNode(selectionAnchorId)
}

const stopSelectionSync = editor.onEditorEvent('selection:changed', onSelectionChanged)
onScopeDispose(stopSelectionSync)

function select(id: string, selection: boolean | LayerSelectionMode) {
  const mode = typeof selection === 'boolean' ? { additive: selection, range: false } : selection
  emit('select', id, mode.additive)
  const visibleIds = visibleRows.value.map((row) => row.node.id)
  const next = layerSelectionForTarget(
    visibleIds,
    editor.state.selectedIds,
    selectionAnchorId,
    id,
    mode
  )
  if (!mode.range) selectionAnchorId = id
  applyingSelection = true
  try {
    // Adding a layer goes through the editor, which drops its selected ancestors and descendants.
    if (mode.additive && !mode.range) editor.select([id], true)
    else editor.select([...next])
  } finally {
    applyingSelection = false
  }
  // A layer picked here leaves canvas clicks as a click on it there would, as in Figma.
  if (!mode.additive && !mode.range) editor.enterContainerOf(id)
  scrollToNode(id)
}

function toggleExpand(id: string) {
  emit('toggleExpand', id)
  if (expanded.value.includes(id)) collapseNode(id)
  else expandNode(id)
}

function getKey(node: LayerNode) {
  return node.id
}

function setVirtualizer(next: LayerTreeVirtualizer) {
  virtualizer = next
}

const actions = {
  select,
  toggleExpand,
  setFocused: (value: boolean) => {
    focused.value = value
  },
  setVirtualizer
}

/** The rows as listed, top to bottom, for a consumer that sizes or measures them. */
defineExpose({ visibleRows })

provideLayerTree({
  editor,
  items,
  expanded,
  visibleRows,
  treeVersion,
  selectedIds,
  focused,
  indentPerLevel,
  draggingId,
  instruction,
  instructionTargetId,
  setupDrag: setupItem,
  select,
  toggleExpand,
  setFocused: actions.setFocused,
  setVirtualizer,
  toggleVisibility: (id: string) => {
    emit('toggleVisibility', id)
    editor.toggleNodeVisibility(id)
  },
  toggleLock: (id: string) => {
    emit('toggleLock', id)
    editor.toggleNodeLock(id)
  },
  rename: (id: string, name: string) => {
    emit('rename', id, name)
    editor.renameNode(id, name)
  },
  setRowRef
})
</script>

<template>
  <TreeRoot
    v-slot="{ flattenItems }"
    v-model:expanded="expanded"
    as="div"
    class="flex min-h-0 flex-1 flex-col overflow-hidden"
    :items="items"
    :get-key="getKey"
    :get-children="childrenOf"
  >
    <slot
      :items="items"
      :flatten-items="flattenItems"
      :visible-rows="visibleRows"
      :expanded="expanded"
      :tree-version="treeVersion"
      :selected-ids="selectedIds"
      :focused="focused"
      :dragging-id="draggingId"
      :instruction="instruction"
      :instruction-target-id="instructionTargetId"
      :actions="actions"
    />
  </TreeRoot>
</template>
