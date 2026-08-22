import { describe, it, expect } from 'vitest'
import * as mcx from '@mbler/mcx-core'
import { MCXVirtualCode } from '../src/plugin/code'

function makeSnapshot(text: string) {
  return {
    getText: (a: number, b: number) => text.slice(a, b),
    getLength: () => text.length,
  }
}

describe('MCXVirtualCode for <Component> files', () => {
  const blocksSource = `<Component>
  <blocks>
    <block id="redstone_cutblock.json">cutBlock</block>
  </blocks>
</Component>
<script lang="ts">
import { BlockComponent } from "@mbler/mcx-component";

export const cutBlock = new BlockComponent({
  format: "1.26.40",
  id: "redstoneplugin:cutblock",
});
</script>`

  const recipesSource = `<Component>
  <recipes>
    <recipe id="cutblock.json">cutBlockRecipe</recipe>
  </recipes>
</Component>
<script lang="ts">
import { RecipeComponent } from "@mbler/mcx-component";

export const cutBlockRecipe = new RecipeComponent({
  format: "1.17.0",
  id: "redstoneplugin:cutblock_recipe",
  type: "shaped",
});
</script>`

  it('parses component entries via compileMCXFn', () => {
    const cd = mcx.compiler.compileMCXFn(blocksSource) as any
    expect(Object.keys(cd.strLoc.Component)).toEqual([
      'blocks/redstone_cutblock.json',
    ])
  })

  it('parses the recipes group', () => {
    const cd = mcx.compiler.compileMCXFn(recipesSource) as any
    expect(Object.keys(cd.strLoc.Component)).toEqual([
      'recipes/cutblock.json',
    ])
  })

  it('exposes the script as a typescript embedded code (blocks)', () => {
    const vc = new MCXVirtualCode(makeSnapshot(blocksSource))
    const script = vc.embeddedCodes.find(c => c.id === 'script')
    expect(script).toBeDefined()
    expect(script!.languageId).toBe('typescript')
    const text = script!.snapshot.getText(0, script!.snapshot.getLength())
    expect(text).toContain('new BlockComponent')
    expect(text).not.toContain('<Component>')
  })

  it('exposes the script as a typescript embedded code (recipes)', () => {
    const vc = new MCXVirtualCode(makeSnapshot(recipesSource))
    const script = vc.embeddedCodes.find(c => c.id === 'script')
    expect(script).toBeDefined()
    expect(script!.languageId).toBe('typescript')
    const text = script!.snapshot.getText(0, script!.snapshot.getLength())
    expect(text).toContain('new RecipeComponent')
  })
})
