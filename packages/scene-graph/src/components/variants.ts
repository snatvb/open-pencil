import type { SceneGraph } from '../index'
import { instanceMainComponent } from '../instances/main-component'
import type { ComponentPropertyDefinition, SceneNode } from '../types'

/** Variants in reading order on the canvas: top to bottom, then left to right, then by name. */
export function compareCanvasPosition(a: SceneNode, b: SceneNode): number {
  return a.y - b.y || a.x - b.x || a.name.localeCompare(b.name)
}

/**
 * A component set's default variant, the one an instance starts as: the variant in its
 * top-left corner, as Figma defines it.
 */
export function defaultVariant(graph: SceneGraph, set: SceneNode): SceneNode | undefined {
  return variantsInReadingOrder(graph, set)[0]
}

function variantsInReadingOrder(graph: SceneGraph, set: SceneNode): SceneNode[] {
  return graph
    .getChildren(set.id)
    .filter((child) => child.type === 'COMPONENT')
    .sort(compareCanvasPosition)
}

/**
 * The value a variant property starts at: its recorded default when that is one of its options,
 * or else the default variant's, since a document may leave the recorded default empty.
 */
export function variantDefaultValue(
  graph: SceneGraph,
  set: SceneNode,
  property: { name: string; defaultValue: string; variantOptions?: string[] }
): string {
  if (property.variantOptions?.includes(property.defaultValue)) return property.defaultValue
  return defaultVariant(graph, set)?.componentPropertyValues[property.name] ?? property.defaultValue
}

/**
 * The variant with every property at its default value: the recorded defaults when they name a
 * variant, else the default variant, as a document that leaves them out draws it.
 */
export function restingVariant(graph: SceneGraph, set: SceneNode): SceneNode | undefined {
  const properties = set.componentPropertyDefinitions.filter(
    (definition) => definition.type === 'VARIANT'
  )
  const values = properties.map(
    (property) => [property.name, variantDefaultValue(graph, set, property)] as const
  )
  return (
    graph
      .getChildren(set.id)
      .find(
        (child) =>
          child.type === 'COMPONENT' &&
          values.every(([name, value]) => child.componentPropertyValues[name] === value)
      ) ?? defaultVariant(graph, set)
  )
}

export type VariantLookup = (
  set: SceneNode,
  values: Readonly<Record<string, string>>
) => SceneNode | undefined

interface IndexedVariants {
  propertyNames: string[]
  byValues: Map<string, SceneNode>
}

function variantValuesKey(
  propertyNames: readonly string[],
  values: Readonly<Partial<Record<string, string>>>
): string | undefined {
  const ordered = propertyNames.map((name) => values[name])
  return ordered.every((value) => value !== undefined) ? JSON.stringify(ordered) : undefined
}

function indexVariants(graph: SceneGraph, set: SceneNode): IndexedVariants {
  const propertyNames = set.componentPropertyDefinitions
    .filter((definition) => definition.type === 'VARIANT')
    .map((definition) => definition.name)
  const byValues = new Map<string, SceneNode>()
  for (const variant of variantsInReadingOrder(graph, set)) {
    const key = variantValuesKey(propertyNames, variant.componentPropertyValues)
    if (key !== undefined && !byValues.has(key)) {
      byValues.set(key, variant)
    }
  }
  return { propertyNames, byValues }
}

export interface InstanceVariant {
  component: SceneNode
  set: SceneNode
}

export function instanceVariant(
  graph: SceneGraph,
  instance: SceneNode
): InstanceVariant | undefined {
  const component = instanceMainComponent(graph, instance)
  const set = component?.parentId ? graph.getNode(component.parentId) : undefined
  return component && set?.type === 'COMPONENT_SET' ? { component, set } : undefined
}

export function variantPropertyDefinition(
  set: SceneNode,
  key: string
): ComponentPropertyDefinition | undefined {
  const definitions = set.componentPropertyDefinitions
  return (
    definitions.find((definition) => definition.type === 'VARIANT' && definition.id === key) ??
    definitions.find((definition) => definition.type === 'VARIANT' && definition.name === key)
  )
}

export function createVariantLookup(graph: SceneGraph): VariantLookup {
  const sets = new Map<string, IndexedVariants>()
  return (set, values) => {
    let indexed = sets.get(set.id)
    if (!indexed) {
      indexed = indexVariants(graph, set)
      sets.set(set.id, indexed)
    }
    const key = variantValuesKey(indexed.propertyNames, values)
    return key === undefined ? undefined : indexed.byValues.get(key)
  }
}
