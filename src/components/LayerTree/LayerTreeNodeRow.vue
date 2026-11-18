<script setup lang="ts">
import { useStore } from '@nanostores/vue'
import { tv } from 'tailwind-variants'
import { computed } from 'vue'

import { appliedVariableModes } from '@open-pencil/vue/controls/variable-modes'
import { locale, useVariableMessages } from '@open-pencil/vue/i18n'
import type { LayerNode } from '@open-pencil/vue/primitives/LayerTree'

import { useEditorStore } from '@/app/editor/active-store'
import type { LayerIssueMark as LayerIssueMarkData } from '@/app/editor/design-check/layers'
import LayerIssueMark from '@/components/design-check/LayerIssueMark.vue'
import { COMPONENT_TYPES, nodeIcon } from '@/components/icons'
import Tip from '@/components/ui/overlay/Tip.vue'
import layerTreeTheme from '@/theme/layer-tree'

import LayerTreeActions from './LayerTreeActions.vue'
import LayerTreeDisclosure from './LayerTreeDisclosure.vue'
import LayerTreeDropIndicator from './LayerTreeDropIndicator.vue'
import LayerTreeRowShell from './LayerTreeRowShell.vue'
import type { LayerTreeChrome, LayerTreeItemActions } from './types'
import { useLayerTreeUI } from './ui'

const { node, level, hasChildren, selected, padLeft, expanded, actions, chrome, issue } =
  defineProps<{
    node: LayerNode
    level: number
    hasChildren: boolean
    selected: boolean
    padLeft: string
    expanded: boolean
    actions: LayerTreeItemActions
    chrome: LayerTreeChrome
    /** Design issues on the layer, or inside it, shown while it is collapsed. */
    issue?: LayerIssueMarkData | null
  }>()

const emit = defineEmits<{
  renameStart: [id: string, name: string]
}>()

const ui = useLayerTreeUI()
const store = useEditorStore()
const variables = useVariableMessages()
const language = useStore(locale)
const appliedModes = computed(() => {
  const { variableModes } = node
  if (!variableModes) {
    return []
  }
  void store.state.sceneVersion
  return appliedVariableModes(store.graph, variableModes, variables.value.numberedCollection)
})
const firstMode = computed(() => appliedModes.value[0])
const moreModes = computed(() => appliedModes.value.length - 1)
const modesLabel = computed(() => {
  const entries = appliedModes.value.map((applied) => variables.value.appliedMode(applied))
  return new Intl.ListFormat(language.value, { type: 'conjunction' }).format(entries)
})
const layerTree = tv(layerTreeTheme)
const styles = computed(() =>
  layerTree({
    expanded,
    actionsVisible: node.locked || !node.visible,
    selected,
    focused: chrome.focused,
    dragging: chrome.draggingId === node.id,
    visible: node.visible,
    component: COMPONENT_TYPES.has(node.type),
    slot: node.slot,
    severalModes: moreModes.value > 0,
    childDropTarget:
      chrome.instructionTargetId === node.id && chrome.instruction?.type === 'make-child'
  })
)
</script>

<template>
  <LayerTreeRowShell
    :pad-left="padLeft"
    data-test-id="layers-item"
    data-slot="row"
    :data-selected="selected || undefined"
    :data-focused="chrome.focused || undefined"
    :data-dragging="chrome.draggingId === node.id || undefined"
    :data-hidden="!node.visible || undefined"
    :data-drop-position="
      chrome.instructionTargetId === node.id && chrome.instruction?.type === 'make-child'
        ? 'child'
        : undefined
    "
    :class="styles.row({ class: ui?.row })"
    @dblclick="emit('renameStart', node.id, node.name)"
  >
    <LayerTreeDisclosure
      :expanded="expanded"
      :label="node.name"
      :ui="{
        disclosure: styles.disclosure({ class: ui?.disclosure }),
        placeholder: styles.disclosurePlaceholder({ class: ui?.disclosurePlaceholder })
      }"
      :visible="hasChildren"
      @toggle="actions.toggleExpand"
    />

    <component :is="nodeIcon(node)" data-slot="icon" :class="styles.icon({ class: ui?.icon })" />
    <span data-slot="label" :class="styles.label({ class: ui?.label })">
      <span data-slot="name" :class="styles.name()">{{ node.name }}</span>
      <Tip v-if="firstMode" :label="modesLabel" as-child>
        <span data-slot="variable-mode" :class="styles.modeBadge()">
          <span aria-hidden="true" data-slot="variable-mode-name" :class="styles.modeName()">{{
            firstMode.mode
          }}</span>
          <template v-if="moreModes > 0">
            <span aria-hidden="true" data-slot="variable-mode-more" :class="styles.moreModes()">
              +{{ moreModes }}
            </span>
            <span aria-hidden="true" data-slot="variable-mode-count" :class="styles.modeCount()">
              {{ appliedModes.length }}
            </span>
          </template>
          <span class="sr-only">{{ modesLabel }}</span>
        </span>
      </Tip>
    </span>
    <LayerIssueMark v-if="issue && (issue.own || !expanded)" :mark="issue" />

    <LayerTreeActions
      :node="node"
      :ui="{
        actions: styles.actions({ class: ui?.actions }),
        action: styles.action({ class: ui?.action }),
        lockIcon: layerTree({ actionActive: node.locked }).actionIcon({ class: ui?.actionIcon }),
        visibilityIcon: layerTree({ actionActive: !node.visible }).actionIcon({
          class: ui?.actionIcon
        })
      }"
      @toggle-lock="actions.toggleLock"
      @toggle-visibility="actions.toggleVisibility"
    />

    <LayerTreeDropIndicator
      :active="chrome.instructionTargetId === node.id"
      :instruction="chrome.instruction"
      :level="level"
      :indent="chrome.indent"
    />
  </LayerTreeRowShell>
</template>
