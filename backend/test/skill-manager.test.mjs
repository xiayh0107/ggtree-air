import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bundledSkillPath, installBundledSkill, listBundledSkills } from '../src/skill-manager.mjs'

test('runtime bundles and installs the canonical agent-agnostic skill', async () => {
  assert.deepEqual(listBundledSkills().map((skill) => skill.name), ['ggtree-phylo'])
  assert.match(bundledSkillPath(), /skills[/\\]ggtree-phylo$/)
  const target = await mkdtemp(path.join(os.tmpdir(), 'ggtree-air-skills-'))
  try {
    const installed = await installBundledSkill('ggtree-phylo', { target })
    const content = await readFile(path.join(installed.destination, 'SKILL.md'), 'utf8')
    assert.match(content, /actions next/)
    assert.match(content, /artifacts commit/)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})
